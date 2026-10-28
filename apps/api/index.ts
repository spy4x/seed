import { createApiApp } from "./app.ts"
import { db, listenSql, sql } from "@api/services/db.ts"
import { config } from "@api/services/config.ts"
import { log } from "@api/services/log.ts"
import { parseAuth, signIn } from "@api/services/auth.ts"
import { eventBus } from "@api/services/eventBus.ts"
import { getWebPush } from "@api/services/webPush.ts"
import { ONE_HOUR_IN_MILLISECONDS } from "@spy4x/platform/universal/time-constants"
import { startIntervalRunner } from "@spy4x/platform/server/interval-runner"
import { createAuthRoute } from "./routes/auth.ts"
import { createOAuthRoute } from "./routes/auth-oauth.ts"
import { createGuestRoute } from "./routes/auth-guest.ts"
import { GUEST_LIMITED_PATHS, refuseGuests } from "./middlewares/guest-limits.ts"
import { type GuestLimitedAction, GuestReminderKind } from "@domain/identity"
import { createPasskeyRoute } from "./routes/auth-passkeys.ts"
import { createPushNotificationRoute } from "./routes/pushNotification.ts"
import { createUsersRoute } from "./routes/users.ts"
import { wsRoute } from "./routes/ws.ts"
import { createNotificationsRoute } from "./routes/notifications.ts"
import { notificationCursor } from "./services/notification-cursor.ts"
import { createGroupActivityRoute } from "./routes/group-activity.ts"
import { createGroupsRoute } from "./routes/groups.ts"
import { createGroupFilesRoute } from "./routes/group-files.ts"
import { createGroupFileRateLimits } from "./features/groups/file-rate-limits.ts"
import { createNotesRoute } from "./routes/notes.ts"
import { createTagsRoute } from "./routes/tags.ts"
import { createApiTokensRoute } from "./routes/api-tokens.ts"
import { createDataExportRoute } from "./routes/data-export.ts"
import { createPictureRoute } from "./routes/pictures.ts"
import {
  latestDataExport,
  readyDataExportFile,
  requestDataExport,
} from "@server/auth/data-export.ts"
import { createAdminRoute } from "./routes/admin/+routes.ts"
import { adminModuleRoutes } from "./routes/admin/registry.ts"
import { createAdminOwnPreferencesRoute } from "./routes/admin/own-preferences.ts"
import { preferencesDefinition } from "@domain/identity"
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
import { createBillingRoute, createBillingTrialRoute } from "./routes/billing.ts"
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
  SIGN_IN_LINK_STORE,
  SIGN_UP_CODE_STORE,
  signInLinkBudgetKeys,
  signUpCodeBudgetKeys,
} from "./middlewares/auth-rate-limits.ts"
import { commandBus } from "./services/commandBus.ts"
import { queryBus } from "./services/queryBus.ts"
import { listenForInboxNews } from "./services/inbox-news.ts"
import { listenForPictureStates } from "@server/auth/picture-state.ts"
import { listenForGroupNews } from "./services/group-news.ts"
import { groupListCursor } from "./services/group-list-cursor.ts"
import { noteListCursor } from "./services/note-list-cursor.ts"
import { activityCursor } from "./services/activity-cursor.ts"
import { operations, realtime } from "./services/realtimeHub.ts"
import { toRequestError } from "./services/realtime.ts"
import { createCallRoute } from "./routes/call.ts"
import { createHealthRoute } from "./routes/health.ts"
import { isCacheConnected, kv } from "./services/cache.ts"
import { files } from "./services/files.ts"
import { createRedisRateLimitStore } from "@spy4x/server/kv"
import { enqueuePasswordResetMail } from "@server/jobs/password-reset-mail.ts"
import { enqueueSignInLinkMail } from "@server/jobs/sign-in-link-mail.ts"
import { enqueueEmailCodeMail } from "@server/jobs/email-code-mail.ts"
import { mailOffWarning, readMailSetup } from "@server/mail/mail.ts"
import { createSubscribersRoute } from "./routes/subscribers.ts"
import { createPublicBlogReads, createPublicBlogRoute } from "./routes/blog.ts"
import {
  createPublicContactLinksRead,
  createPublicContactLinksRoute,
} from "./routes/contact-links.ts"
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
import { systemEnv } from "@spy4x/server/config"
import { readTelegramSetup, telegramOffNote } from "@server/telegram/setup.ts"
import { createTelegramRoute, createTelegramWebhookRoute } from "./routes/telegram.ts"
import { createTelegramAccounts, createTelegramRuntime } from "./services/telegram.ts"
import { createTelegramProduct } from "./telegram/commands.ts"
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
  spa: config.spa,
  isProxyPeer: createProxyPeers({
    hosts: config.proxyHosts.length > 0 ? config.proxyHosts : DEFAULT_PROXY_HOSTS,
    onError: (host, error) => log(`error: could not look up the proxy ${host}`, error),
  }),
})

// Before every route: a guest (#224) needs a sign-in method before inviting, push, API tokens,
// uploads or checkout. The socket's `push.register` checks the same in `realtimeHub.ts`.
for (const [action, paths] of Object.entries(GUEST_LIMITED_PATHS)) {
  const remind = action === "invite"
    ? (userId: number) => signIn.guests.remind(userId, GuestReminderKind.Invite)
    : undefined
  app.on("POST", [...paths], refuseGuests(action as GuestLimitedAction, remind))
}

app.route(
  "/health",
  createHealthRoute({
    isDbConnected: () => db.isConnected(),
    isCacheConnected,
    isFileStoreReachable: files.isReachable,
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
app.route("/auth", createPasskeyRoute({ signIn, mutationGuards, rateLimits }))
app.route("/auth", createGuestRoute({ signIn, mutationGuards, rateLimits }))
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
    requestSignInLink: (email, next, requestedBy) =>
      enqueueSignInLinkMail(sql, email, next, requestedBy),
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
      ? await signIn.verifyPassword(userId, password, tx)
      : null,
  countPasswordCheck: signIn.countPasswordCheck,
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
// A person's copy of their data (#229): asked for here, built by the worker, kept in the file store.
app.route(
  "/account/data-export",
  createDataExportRoute({
    auth: signIn.auth,
    mutationGuards,
    limit: rateLimits.normal,
    latest: (userId) => latestDataExport(sql, userId),
    request: (userId) => requestDataExport(sql, userId),
    readyFile: (userId) => readyDataExportFile(sql, userId),
    signDownload: files.signDownload,
  }),
)
app.route(
  "/pictures",
  createPictureRoute({
    auth: signIn.auth,
    limit: rateLimits.normal,
    readable: (pictureId, viewerId) => db.pictures.readable(pictureId, viewerId),
    signDownload: files.signDownload,
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
      fileStoreReachable: files.isReachable,
      readFile: files.read,
      build: config.build,
      billing: billingSetup,
    }).concat(
      createAdminOwnPreferencesRoute({
        limit: rateLimits.normal,
        read: async (userId) =>
          preferencesDefinition.resolve(await db.preferences.store.read(String(userId))),
      }),
    ),
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
    create: async (command) => {
      const created = await commandBus.execute(command)
      await signIn.guests.remind(command.data.actor.userId, GuestReminderKind.FirstNote)
      return created
    },
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
app.route("/billing/trial", createBillingTrialRoute({ trial: (query) => queryBus.execute(query) }))
// No session and no origin check: the provider calls it, and its signature is the only proof.
app.route(
  "/webhooks/billing",
  createBillingWebhookRoute({
    provider: billingSetup.provider,
    applyEvent: (event) => db.billing.applyEvent(event),
    log,
  }),
)
// The Telegram bot (#269, docs/telegram.md): off without TELEGRAM_BOT_TOKEN, and then nothing here
// calls Telegram. A setting that cannot work stops the API now, not at the first message.
const telegramSetup = readTelegramSetup(systemEnv, config.isDev ? "dev" : "prod")
const telegramNote = telegramOffNote(telegramSetup)
if (telegramNote) log(telegramNote)
const telegram = telegramSetup
  ? createTelegramRuntime({
    setup: telegramSetup,
    db,
    store: kv,
    webAppUrl: config.webAppUrl,
    product: createTelegramProduct({ queryBus }),
    log,
  })
  : null
app.route(
  "/telegram",
  createTelegramRoute({
    auth: signIn.auth,
    mutationGuards,
    limit: rateLimits.normal,
    codeLimit: rateLimits.strictByUser,
    telegram: createTelegramAccounts({ db, botUsername: telegramSetup?.username ?? null }),
  }),
)
// No session and no origin check: Telegram calls it, and its secret header is the only proof.
app.route("/webhooks/telegram", createTelegramWebhookRoute(telegram?.webhook ?? null))
// Fail-open: a Telegram that is down never holds the API back. Polling runs until the process ends.
if (telegram) {
  telegram.start(new AbortController().signal).catch((error) =>
    log("error: the Telegram bot did not start", error)
  )
}
// Before the groups route: it shares `/groups`, and its own routes match none of these paths.
app.route(
  "/groups",
  createGroupFilesRoute({
    exportGroup: (command) => commandBus.execute(command),
    check: (query) => queryBus.execute(query),
    importGroup: (command) => commandBus.execute(command),
    rateLimits: createGroupFileRateLimits({
      store: (keyPrefix) => createRedisRateLimitStore(kv, { keyPrefix }),
    }),
    expectedOrigin,
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
// The public website reads the blog's live posts; drafts and scheduled posts are never answered.
app.route("/blog", createPublicBlogRoute(createPublicBlogReads(sql)))
// The public website names the contact links in its footer and its structured data.
app.route("/contact-links", createPublicContactLinksRoute(createPublicContactLinksRead(sql)))
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
      forgetCodeBudget: async (email, client) => {
        await createRedisRateLimitStore(kv, { keyPrefix: EMAIL_CODE_STORE })
          .delete(await emailCodeBudgetKey(email))
        const signUp = createRedisRateLimitStore(kv, { keyPrefix: SIGN_UP_CODE_STORE })
        const keys = await signUpCodeBudgetKeys(email, client)
        await signUp.delete(keys.address)
        await signUp.delete(keys.client)
        const links = createRedisRateLimitStore(kv, { keyPrefix: SIGN_IN_LINK_STORE })
        const linkKeys = await signInLinkBudgetKeys(email, client)
        await links.delete(linkKeys.address)
        await links.delete(linkKeys.client)
      },
    }),
  )
}

// Group changes and access losses announced by Postgres become hints on the open sockets.
await listenForGroupNews(listenSql, realtime, log)
// A change to a person's inbox becomes a hint on their sockets; the page reads the count.
await listenForInboxNews(listenSql, realtime)
// A picture the worker made ready or refused (#464) becomes a hint; the page reads the profile.
await listenForPictureStates(listenSql, (userId) => realtime.notifyUserChange(userId))
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
