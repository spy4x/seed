import { createApiApp } from "./app.ts"
import { db, sql } from "@api/services/db.ts"
import { config } from "@api/services/config.ts"
import { log } from "@api/services/log.ts"
import { parseAuth, signIn } from "@api/services/auth.ts"
import { eventBus } from "@api/services/eventBus.ts"
import { getWebPush } from "@api/services/webPush.ts"
import { ONE_HOUR_IN_MILLISECONDS } from "@spy4x/platform/universal/time-constants"
import { startIntervalRunner } from "@spy4x/platform/server/interval-runner"
import { createAuthRoute } from "./routes/auth.ts"
import { createOAuthRoute } from "./routes/auth-oauth.ts"
import { createPushNotificationRoute } from "./routes/pushNotification.ts"
import { createUsersRoute } from "./routes/users.ts"
import { wsRoute } from "./routes/ws.ts"
import { createNotificationsRoute } from "./routes/notifications.ts"
import { notificationCursor } from "./services/notification-cursor.ts"
import { createGroupActivityRoute } from "./routes/group-activity.ts"
import { createGroupsRoute } from "./routes/groups.ts"
import { createNotesRoute } from "./routes/notes.ts"
import { createTagsRoute } from "./routes/tags.ts"
import { createApiTokensRoute } from "./routes/api-tokens.ts"
import { createAdminRoute } from "./routes/admin/+routes.ts"
import { adminModuleRoutes } from "./routes/admin/registry.ts"
import { createTokenApiRoute } from "./routes/token-api.ts"
import { createApiTokens } from "./services/api-tokens.ts"
import { createTokenRateLimits } from "./middlewares/token-rate-limits.ts"
import { deriveSecret } from "@spy4x/platform/tokens"
import {
  createGroupInvitationsRoute,
  createInvitationsRoute,
  type InvitationsRouteDependencies,
} from "./routes/invitations.ts"
import { invitationRateLimits } from "./cqrs/invitation-dependencies.ts"
import { createBillingRoute } from "./routes/billing.ts"
import { createBillingWebhookRoute } from "./routes/billing-webhook.ts"
import { billingSetup } from "./services/billing.ts"
import { createMutationGuards } from "./middlewares/mutation-guards.ts"
import { createTotpFailures } from "./services/totp-failures.ts"
import { createEmailCodeFailures } from "./services/email-code-failures.ts"
import { createPasswordFailures, prunePasswordFailures } from "./services/password-failures.ts"
import {
  createAuthRateLimits,
  EMAIL_CODE_STORE,
  emailCodeBudgetKey,
} from "./middlewares/auth-rate-limits.ts"
import { commandBus } from "./services/commandBus.ts"
import { queryBus } from "./services/queryBus.ts"
import { listenForInboxNews } from "./services/inbox-news.ts"
import { listenForGroupNews } from "./services/group-news.ts"
import { groupListCursor } from "./services/group-list-cursor.ts"
import { noteListCursor } from "./services/note-list-cursor.ts"
import { activityCursor } from "./services/activity-cursor.ts"
import { operations, realtime } from "./services/realtimeHub.ts"
import { toRequestError } from "./services/realtime.ts"
import { createCallRoute } from "./routes/call.ts"
import { createHealthRoute } from "./routes/health.ts"
import { isCacheConnected, kv } from "./services/cache.ts"
import { createRedisRateLimitStore } from "@spy4x/server/kv"
import { enqueuePasswordResetMail } from "@server/jobs/password-reset-mail.ts"
import { enqueueEmailCodeMail } from "@server/jobs/email-code-mail.ts"
import { mailOffWarning, readMailSetup } from "@server/mail/mail.ts"
import { createSubscribersRoute } from "./routes/subscribers.ts"
import { createSubscriberRateLimits } from "./middlewares/subscriber-rate-limits.ts"
import { DEFAULT_PROXY_HOSTS } from "./middlewares/proxy-peer.ts"
import { createProxyPeers } from "@spy4x/server/http/trusted-proxy"
import {
  enqueueSubscriberMail,
  SUBSCRIBER_CONFIRM_MAIL_JOB,
  SUBSCRIBER_WELCOME_MAIL_JOB,
} from "@server/jobs/subscriber-mail.ts"
import {
  createRecipientLimitKey,
  readSiteUrl,
  readSubscribersSetup,
  subscribersOffWarning,
} from "@server/subscribers/subscribers.ts"
import { createPostgresSubscriberStore } from "@spy4x/server/subscribers/postgres"
import { createErrorReporter } from "@spy4x/platform"
import "./cqrs/+init.ts"

const REALTIME_REVALIDATE_INTERVAL_MS = 15_000

// The worker sends the mail; the API only says once, at start-up, when production has no SMTP.
const mailWarning = mailOffWarning(readMailSetup(Deno.env))
if (mailWarning) log(mailWarning)

// Without ERROR_REPORT_DSN the reporter is off and sends nothing.
const errorReporter = createErrorReporter({
  dsn: config.errorReportDsn,
  environment: config.env,
  // 100 an hour, not 100 for the life of the process, so a flood is capped and a later error still shows.
  maxPerSession: 100,
  windowMs: 60 * 60 * 1000,
})
// Every route stands behind the security headers, the base middleware and the page-user check
// (`./app.ts`).
const app = await createApiApp({
  write: log,
  skipLogPaths: ["/api/health"],
  parseAuth,
  reportError: (error, context) => void errorReporter.report(error, context),
  adminHost: config.adminDomain,
  isProxyPeer: createProxyPeers({
    hosts: config.proxyHosts.length > 0 ? config.proxyHosts : DEFAULT_PROXY_HOSTS,
    onError: (host, error) => log(`error: could not look up the proxy ${host}`, error),
  }),
})

app.route(
  "/health",
  createHealthRoute({
    isDbConnected: () => db.isConnected(),
    isCacheConnected,
  }),
)
// The browser sends the web app's origin; behind the TLS-terminating proxy the API sees `http://`.
const expectedOrigin = new URL(config.webAppUrl).origin
const mutationGuards = createMutationGuards(config.webAppUrl, config.adminAppUrl)
const emit = (event: Parameters<typeof eventBus.emit>[0]) => eventBus.emit(event)
// has some public routes and some more protected
const rateLimits = createAuthRateLimits({
  ...config.rateLimiter,
  store: (keyPrefix) => createRedisRateLimitStore(kv, { keyPrefix }),
  onStoreError: (error) => log("error: auth rate limit store failed and was let pass", error),
})
// Before the auth routes: their session middleware would answer for the public paths here too.
app.route(
  "/auth",
  createOAuthRoute({
    signIn,
    emit,
    mutationGuards,
    rateLimits,
    origin: config.webAppUrl,
    logError: (message, error) => log(message, error),
  }),
)
app.route(
  "/auth",
  createAuthRoute({
    signIn,
    emit,
    mutationGuards,
    rateLimits,
    totpFailures: createTotpFailures({ sql }),
    passwordFailures: createPasswordFailures({ sql }),
    requestPasswordReset: (email) => enqueuePasswordResetMail(sql, email),
    emailCodeFailures: createEmailCodeFailures({ sql }),
    requestEmailCode: (userId, email) => enqueueEmailCodeMail(sql, userId, email),
  }),
)
app.route(
  "/users",
  createUsersRoute({
    auth: signIn.auth,
    mutationGuards,
    getProfile: (query) => queryBus.execute(query),
    updateProfile: (command) => commandBus.execute(command),
  }),
)
const tokenRateLimits = createTokenRateLimits({
  ...config.rateLimiter,
  store: (keyPrefix) => createRedisRateLimitStore(kv, { keyPrefix }),
  onStoreError: (error) => log("error: API token rate limit store failed and was let pass", error),
})
// Personal API tokens (#167). The hash key comes from the pepper, so it needs no secret of its own;
// changing the pepper makes every token stop working, as it ends every password.
const apiTokens = createApiTokens({
  db,
  key: await deriveSecret(config.authPepper, "api-tokens"),
  checkPassword: async (tx, userId, password) =>
    (await signIn.hasPassword(userId, tx))
      ? await signIn.checkPassword(userId, password, tx)
      : null,
  mayAuditRefusal: tokenRateLimits.refusalAudit,
  logError: (message, error) => log(message, error),
})
app.route(
  "/tokens",
  createApiTokensRoute({
    auth: signIn.auth,
    mutationGuards,
    limit: rateLimits.normal,
    passwordLimit: rateLimits.strictByUser,
    tokens: apiTokens,
  }),
)
// The mail subscriptions' keys, read once for the public routes and the operator area.
const subscribersSetup = readSubscribersSetup(Deno.env, config.isDev ? "dev" : "prod")
const subscribersWarning = subscribersOffWarning(subscribersSetup)
if (subscribersWarning) log(subscribersWarning)
// The operator area (#146) and its modules (#424). The gate answers 404 to anyone below operator.
app.route(
  "/admin",
  createAdminRoute({
    auth: signIn.auth,
    mutationGuards,
    modules: adminModuleRoutes({
      db,
      sql,
      subscribers: subscribersSetup,
      siteUrl: readSiteUrl(Deno.env, config.isDev ? "dev" : "prod"),
      limit: rateLimits.normal,
      resetByAddress: rateLimits.resetByAddress,
      emit,
      now: () => new Date(),
      cursorSecret: config.authCookieSecret,
      cacheConnected: isCacheConnected,
      build: config.build,
      billing: billingSetup,
    }),
  }),
)
// The only routes that accept a token, and they accept nothing else.
app.route(
  "/v1",
  createTokenApiRoute({
    authenticate: (c, presented) => apiTokens.authenticate(c, presented),
    auditRefusal: (c, tokenId, reason) => apiTokens.auditRefusal(c, tokenId, reason),
    list: (query) => queryBus.execute(query),
    get: (query) => queryBus.execute(query),
    create: (command) => commandBus.execute(command),
    cursor: noteListCursor,
    limitByIp: tokenRateLimits.failuresByIp,
    limitByToken: tokenRateLimits.byToken,
  }),
)
// Awaited here so a missing VAPID keys file stops the API at start-up, not at the first push call.
const webPush = await getWebPush()
app.route(
  "/push",
  createPushNotificationRoute({
    auth: signIn.auth,
    mutationGuards,
    getPublicKey: () => webPush.getPublicKey(),
    register: (command) => commandBus.execute(command),
    remove: (command) => commandBus.execute(command),
    list: (query) => queryBus.execute(query),
  }),
)
app.route("/ws", wsRoute)
// The operations the socket serves, over plain HTTP: a page with no socket does the same work.
app.route("/call", createCallRoute({ operations, mapError: toRequestError, log, expectedOrigin }))
// Before "/groups": its authentication middleware would otherwise answer for these paths too.
app.route(
  "/groups/:groupId/notes",
  createNotesRoute({
    create: (command) => commandBus.execute(command),
    update: (command) => commandBus.execute(command),
    delete: (command) => commandBus.execute(command),
    restore: (command) => commandBus.execute(command),
    move: (command) => commandBus.execute(command),
    list: (query) => queryBus.execute(query),
    get: (query) => queryBus.execute(query),
    cursor: noteListCursor,
    expectedOrigin,
  }),
)
app.route(
  "/groups/:groupId/tags",
  createTagsRoute({ list: (query) => queryBus.execute(query) }),
)
// Before "/groups" too, for the same reason.
app.route(
  "/groups/:groupId/activity",
  createGroupActivityRoute({
    list: (query) => queryBus.execute(query),
    cursor: activityCursor,
  }),
)
app.route(
  "/notifications",
  createNotificationsRoute({
    list: (query) => queryBus.execute(query),
    unreadCount: (query) => queryBus.execute(query),
    markRead: (command) => commandBus.execute(command),
    markAllRead: (command) => commandBus.execute(command),
    cursor: notificationCursor,
    expectedOrigin,
  }),
)
const invitationRoutes: InvitationsRouteDependencies = {
  create: (command) => commandBus.execute(command),
  list: (query) => queryBus.execute(query),
  revoke: (command) => commandBus.execute(command),
  preview: (query) => queryBus.execute(query),
  mine: (query) => queryBus.execute(query),
  accept: (command) => commandBus.execute(command),
  decline: (command) => commandBus.execute(command),
  rateLimits: invitationRateLimits,
  expectedOrigin,
}
app.route("/groups/:groupId/invitations", createGroupInvitationsRoute(invitationRoutes))
app.route("/invitations", createInvitationsRoute(invitationRoutes))
app.route(
  "/groups/:groupId/billing",
  createBillingRoute({
    get: (query) => queryBus.execute(query),
    checkout: (command) => commandBus.execute(command),
    portal: (command) => commandBus.execute(command),
    expectedOrigin,
  }),
)
// No session and no origin check: the provider calls it, and its signature is the only proof.
app.route(
  "/webhooks/billing",
  createBillingWebhookRoute({
    provider: billingSetup.provider,
    applyEvent: (event) => db.billing.applyEvent(event),
    log,
  }),
)
app.route(
  "/groups",
  createGroupsRoute({
    create: (command) => commandBus.execute(command),
    list: (query) => queryBus.execute(query),
    get: (query) => queryBus.execute(query),
    select: (command) => commandBus.execute(command),
    selected: (query) => queryBus.execute(query),
    rename: (command) => commandBus.execute(command),
    updateDetails: (command) => commandBus.execute(command),
    delete: (command) => commandBus.execute(command),
    restore: (command) => commandBus.execute(command),
    deleted: (query) => queryBus.execute(query),
    members: (query) => queryBus.execute(query),
    setRole: (command) => commandBus.execute(command),
    removeMember: (command) => commandBus.execute(command),
    leave: (command) => commandBus.execute(command),
    transfer: (command) => commandBus.execute(command),
    moveAll: (command) => commandBus.execute(command),
    passwordLimit: rateLimits.strictByUser,
    cursor: groupListCursor,
    expectedOrigin,
  }),
)
// Visitors subscribe to mail. The worker signs and sends every mail; this checks the links.
app.route(
  "/subscribers",
  createSubscribersRoute({
    setup: subscribersSetup,
    store: (list) => createPostgresSubscriberStore(sql, { listId: list }),
    webAppUrl: config.webAppUrl,
    rateLimits: createSubscriberRateLimits({
      ...config.rateLimiter,
      store: (keyPrefix) => createRedisRateLimitStore(kv, { keyPrefix }),
      // Without a setup every subscriber route answers 503 before it spends a budget.
      recipientKey: subscribersSetup
        ? await createRecipientLimitKey(subscribersSetup)
        : () => Promise.reject(new Error("subscriptions are off")),
    }),
    requestConfirmMail: (list, email) =>
      enqueueSubscriberMail(sql, SUBSCRIBER_CONFIRM_MAIL_JOB, list, email),
    requestWelcomeMail: (list, email) =>
      enqueueSubscriberMail(sql, SUBSCRIBER_WELCOME_MAIL_JOB, list, email),
    log: console,
  }),
)
if (config.isDev) {
  const { createDevRoute } = await import("./routes/dev.ts")
  app.route(
    "/test",
    createDevRoute({
      isDev: config.isDev,
      db,
      sql,
      closeSockets: (userId) => realtime.closeUser(userId, "closed by a development script", 1012),
      forgetCodeBudget: async (email) =>
        await createRedisRateLimitStore(kv, { keyPrefix: EMAIL_CODE_STORE })
          .delete(await emailCodeBudgetKey(email)),
    }),
  )
}

// Group changes and access losses announced by Postgres become hints on the open sockets.
await listenForGroupNews(sql, realtime, log)
// A change to a person's inbox becomes a hint on their sockets; the page reads the count.
await listenForInboxNews(sql, realtime)
// Sockets whose session was signed out, expired or lost its second factor while open are closed
// within this interval; the per-request check already refuses their frames.
realtime.startRevalidation(REALTIME_REVALIDATE_INTERVAL_MS)

// Expired sessions are swept every hour by each API process. A repeating worker job would run it
// once for every instance instead.
const SESSION_EXPIRE_INTERVAL = ONE_HOUR_IN_MILLISECONDS
startIntervalRunner({
  task: () => signIn.expireSessions(),
  intervalMs: SESSION_EXPIRE_INTERVAL,
  onError: (error) => log(`error: session expiry failed, retrying next tick`, error),
})
// Every sign-in name a stranger types adds a row to the wrong-password counter; the ones that
// decide nothing any more go each hour.
startIntervalRunner({
  task: async () => void await prunePasswordFailures(sql),
  intervalMs: ONE_HOUR_IN_MILLISECONDS,
  onError: (error) => log(`error: pruning the wrong-password counter failed`, error),
})

export default app
