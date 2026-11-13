// Seed's own site: see docs/start-a-product.md
import { REPOSITORY_URL } from "./brand.ts"
import { DOCS_PATH, isPublishedDoc } from "./docs-site.ts"

/** How much of an item Seed already does. */
export enum Coverage {
  /** Seed ships the code or the steps. */
  Full = 1,
  /** Seed ships a part; the item's `left` line says what is yours. */
  Partial = 2,
}

/** Where Seed shows that it covers an item. */
export interface SeedCover {
  coverage: Coverage
  /**
   * What proves it, with an optional `#fragment`: a file of this repository (`docs/backups.md`,
   * `apps/api/middlewares/auth-rate-limits.ts`), or a page of the website (`/features/sign-in`).
   */
  path: string
  /** The proof's name, as its accessible name says it: a doc's `#` heading, a file's path. */
  title: string
  /** The catalog key of one short line on what is left to the reader. Required for `Partial`. */
  left?: string
}

/** An official text an item points to, instead of paraphrasing the law. */
export interface OfficialSource {
  /** The catalog key of the source's name. */
  name: string
  url: string
}

/** One check a reader ticks. */
export interface ChecklistItem {
  /**
   * `<section>-<item>`, in English in every language: the checkbox's id, its anchor and what the
   * browser stores. Never rename one; an item that changes keeps its old id.
   */
  id: string
  /** The catalog key of the title: an imperative sentence that names its own subject. */
  title: string
  /** The catalog key of the one sentence on why it matters. */
  why: string
  seed?: SeedCover
  source?: OfficialSource
}

/** One section of the list, with its own heading and count. */
export interface ChecklistSection {
  id: string
  /** The catalog key of its heading. */
  title: string
  items: readonly ChecklistItem[]
}

const GDPR: OfficialSource = {
  name: `LaunchChecklistSource.gdpr`,
  url: `https://eur-lex.europa.eu/eli/reg/2016/679/oj`,
}
const EPRIVACY: OfficialSource = {
  name: `LaunchChecklistSource.eprivacy`,
  url: `https://eur-lex.europa.eu/eli/dir/2002/58/oj`,
}
const EU_VAT: OfficialSource = {
  name: `LaunchChecklistSource.vat`,
  url: `https://vat-one-stop-shop.ec.europa.eu/index_en`,
}

/**
 * The checklist, in the order a reader works through it. The words live in `i18n/site/`, so every
 * language has exactly these items; `launch-checklist.test.ts` holds each language, each id and
 * each cited proof to this list.
 */
export const CHECKLIST: readonly ChecklistSection[] = [
  {
    id: `legal`,
    title: `LaunchChecklistSection.legal`,
    items: [
      {
        id: `legal-privacy-policy`,
        title: `LaunchChecklistItem.legalPrivacyPolicy`,
        why: `LaunchChecklistItem.legalPrivacyPolicyWhy`,
        seed: {
          coverage: Coverage.Partial,
          path: `apps/mpa/routes/[[lang]]/privacy.tsx`,
          title: `apps/mpa/routes/[[lang]]/privacy.tsx`,
          left: `LaunchChecklistItem.legalPrivacyPolicyLeft`,
        },
        source: GDPR,
      },
      {
        id: `legal-terms`,
        title: `LaunchChecklistItem.legalTerms`,
        why: `LaunchChecklistItem.legalTermsWhy`,
        seed: {
          coverage: Coverage.Partial,
          path: `apps/mpa/routes/[[lang]]/terms.tsx`,
          title: `apps/mpa/routes/[[lang]]/terms.tsx`,
          left: `LaunchChecklistItem.legalTermsLeft`,
        },
      },
      {
        id: `legal-cookie-banner`,
        title: `LaunchChecklistItem.legalCookieBanner`,
        why: `LaunchChecklistItem.legalCookieBannerWhy`,
        seed: { coverage: Coverage.Full, path: `docs/analytics.md`, title: `Website analytics` },
        source: EPRIVACY,
      },
      {
        id: `legal-data-export`,
        title: `LaunchChecklistItem.legalDataExport`,
        why: `LaunchChecklistItem.legalDataExportWhy`,
        seed: {
          coverage: Coverage.Full,
          path: `docs/data-export.md`,
          title: `A person's data export`,
        },
        source: GDPR,
      },
      {
        id: `legal-account-deletion`,
        title: `LaunchChecklistItem.legalAccountDeletion`,
        why: `LaunchChecklistItem.legalAccountDeletionWhy`,
        seed: {
          coverage: Coverage.Partial,
          path: `libs/server/jobs/account-deletion.ts`,
          title: `libs/server/jobs/account-deletion.ts`,
          left: `LaunchChecklistItem.legalAccountDeletionLeft`,
        },
        source: GDPR,
      },
      {
        id: `legal-processors`,
        title: `LaunchChecklistItem.legalProcessors`,
        why: `LaunchChecklistItem.legalProcessorsWhy`,
        source: GDPR,
      },
      {
        id: `legal-entity-contact`,
        title: `LaunchChecklistItem.legalEntityContact`,
        why: `LaunchChecklistItem.legalEntityContactWhy`,
      },
    ],
  },
  {
    id: `billing`,
    title: `LaunchChecklistSection.billing`,
    items: [
      {
        id: `billing-test-live`,
        title: `LaunchChecklistItem.billingTestLive`,
        why: `LaunchChecklistItem.billingTestLiveWhy`,
        seed: { coverage: Coverage.Full, path: `docs/billing.md`, title: `Set up billing` },
      },
      {
        id: `billing-pricing-matches`,
        title: `LaunchChecklistItem.billingPricingMatches`,
        why: `LaunchChecklistItem.billingPricingMatchesWhy`,
        seed: { coverage: Coverage.Full, path: `docs/billing-plans.md`, title: `Plans and limits` },
      },
      {
        id: `billing-failed-payments`,
        title: `LaunchChecklistItem.billingFailedPayments`,
        why: `LaunchChecklistItem.billingFailedPaymentsWhy`,
        seed: {
          coverage: Coverage.Full,
          path: `docs/billing-lifecycle.md#failed-payments`,
          title: `Trials, failed payments and cancelling`,
        },
      },
      {
        id: `billing-cancel-refund`,
        title: `LaunchChecklistItem.billingCancelRefund`,
        why: `LaunchChecklistItem.billingCancelRefundWhy`,
        seed: {
          coverage: Coverage.Full,
          path: `docs/billing-operator.md`,
          title: `Billing for operators`,
        },
      },
      {
        id: `billing-tax`,
        title: `LaunchChecklistItem.billingTax`,
        why: `LaunchChecklistItem.billingTaxWhy`,
        seed: {
          coverage: Coverage.Partial,
          path: `docs/billing.md`,
          title: `Set up billing`,
          left: `LaunchChecklistItem.billingTaxLeft`,
        },
        source: EU_VAT,
      },
      {
        id: `billing-receipts`,
        title: `LaunchChecklistItem.billingReceipts`,
        why: `LaunchChecklistItem.billingReceiptsWhy`,
      },
    ],
  },
  {
    id: `security`,
    title: `LaunchChecklistSection.security`,
    items: [
      {
        id: `security-https-hsts`,
        title: `LaunchChecklistItem.securityHttpsHsts`,
        why: `LaunchChecklistItem.securityHttpsHstsWhy`,
        seed: {
          coverage: Coverage.Full,
          path: `docs/certificates.md`,
          title: `HTTPS certificates`,
        },
      },
      {
        id: `security-headers-csp`,
        title: `LaunchChecklistItem.securityHeadersCsp`,
        why: `LaunchChecklistItem.securityHeadersCspWhy`,
        seed: {
          coverage: Coverage.Full,
          path: `docs/security-headers.md`,
          title: `Security headers`,
        },
      },
      {
        id: `security-two-factor-passkeys`,
        title: `LaunchChecklistItem.securityTwoFactorPasskeys`,
        why: `LaunchChecklistItem.securityTwoFactorPasskeysWhy`,
        seed: { coverage: Coverage.Full, path: `/features/sign-in`, title: `Sign-in` },
      },
      {
        id: `security-rate-limits`,
        title: `LaunchChecklistItem.securityRateLimits`,
        why: `LaunchChecklistItem.securityRateLimitsWhy`,
        seed: {
          coverage: Coverage.Full,
          path: `apps/api/middlewares/auth-rate-limits.ts`,
          title: `apps/api/middlewares/auth-rate-limits.ts`,
        },
      },
      {
        id: `security-secrets`,
        title: `LaunchChecklistItem.securitySecrets`,
        why: `LaunchChecklistItem.securitySecretsWhy`,
        seed: {
          coverage: Coverage.Partial,
          path: `docs/deploy.md`,
          title: `Deploy to a server`,
          left: `LaunchChecklistItem.securitySecretsLeft`,
        },
      },
      {
        id: `security-audit-log`,
        title: `LaunchChecklistItem.securityAuditLog`,
        why: `LaunchChecklistItem.securityAuditLogWhy`,
        seed: {
          coverage: Coverage.Full,
          path: `docs/operator-access.md`,
          title: `Give operators access`,
        },
      },
      {
        id: `security-dependencies`,
        title: `LaunchChecklistItem.securityDependencies`,
        why: `LaunchChecklistItem.securityDependenciesWhy`,
        seed: {
          coverage: Coverage.Partial,
          path: `docs/development.md`,
          title: `Every task`,
          left: `LaunchChecklistItem.securityDependenciesLeft`,
        },
      },
    ],
  },
  {
    id: `backups`,
    title: `LaunchChecklistSection.backups`,
    items: [
      {
        id: `backups-automated`,
        title: `LaunchChecklistItem.backupsAutomated`,
        why: `LaunchChecklistItem.backupsAutomatedWhy`,
        seed: {
          coverage: Coverage.Full,
          path: `docs/backups.md`,
          title: `Backups`,
          left: `LaunchChecklistItem.backupsAutomatedLeft`,
        },
      },
      {
        id: `backups-restore-tested`,
        title: `LaunchChecklistItem.backupsRestoreTested`,
        why: `LaunchChecklistItem.backupsRestoreTestedWhy`,
        seed: {
          coverage: Coverage.Full,
          path: `docs/restore.md#rehearse-a-restore`,
          title: `Restore from a backup`,
        },
      },
      {
        id: `backups-missing-alert`,
        title: `LaunchChecklistItem.backupsMissingAlert`,
        why: `LaunchChecklistItem.backupsMissingAlertWhy`,
        seed: { coverage: Coverage.Full, path: `docs/backups.md`, title: `Backups` },
      },
    ],
  },
  {
    id: `monitoring`,
    title: `LaunchChecklistSection.monitoring`,
    items: [
      {
        id: `monitoring-errors`,
        title: `LaunchChecklistItem.monitoringErrors`,
        why: `LaunchChecklistItem.monitoringErrorsWhy`,
        seed: {
          coverage: Coverage.Full,
          path: `docs/stack.md#error-tracking`,
          title: `Stack, infrastructure and deployment`,
        },
      },
      {
        id: `monitoring-alerts`,
        title: `LaunchChecklistItem.monitoringAlerts`,
        why: `LaunchChecklistItem.monitoringAlertsWhy`,
        seed: {
          coverage: Coverage.Full,
          path: `docs/stack.md#alerts`,
          title: `Stack, infrastructure and deployment`,
        },
      },
      {
        id: `monitoring-uptime-status`,
        title: `LaunchChecklistItem.monitoringUptimeStatus`,
        why: `LaunchChecklistItem.monitoringUptimeStatusWhy`,
      },
      {
        id: `monitoring-load-test`,
        title: `LaunchChecklistItem.monitoringLoadTest`,
        why: `LaunchChecklistItem.monitoringLoadTestWhy`,
        seed: { coverage: Coverage.Full, path: `docs/load-tests.md`, title: `Run the load tests` },
      },
    ],
  },
  {
    id: `email`,
    title: `LaunchChecklistSection.email`,
    items: [
      {
        id: `email-transactional`,
        title: `LaunchChecklistItem.emailTransactional`,
        why: `LaunchChecklistItem.emailTransactionalWhy`,
        seed: { coverage: Coverage.Full, path: `docs/settings.md#mail`, title: `Settings` },
      },
      {
        id: `email-domain-auth`,
        title: `LaunchChecklistItem.emailDomainAuth`,
        why: `LaunchChecklistItem.emailDomainAuthWhy`,
      },
      {
        id: `email-reply-sender`,
        title: `LaunchChecklistItem.emailReplySender`,
        why: `LaunchChecklistItem.emailReplySenderWhy`,
        seed: {
          coverage: Coverage.Partial,
          path: `docs/settings.md#mail`,
          title: `Settings`,
          left: `LaunchChecklistItem.emailReplySenderLeft`,
        },
      },
      {
        id: `email-newsletter`,
        title: `LaunchChecklistItem.emailNewsletter`,
        why: `LaunchChecklistItem.emailNewsletterWhy`,
        seed: {
          coverage: Coverage.Full,
          path: `docs/architecture.md#mail-subscriptions`,
          title: `Architecture`,
        },
      },
    ],
  },
  {
    id: `search`,
    title: `LaunchChecklistSection.search`,
    items: [
      {
        id: `search-basics`,
        title: `LaunchChecklistItem.searchBasics`,
        why: `LaunchChecklistItem.searchBasicsWhy`,
        seed: {
          coverage: Coverage.Full,
          path: `docs/apps.md#the-spa-and-the-mpa`,
          title: `The three apps`,
        },
      },
      {
        id: `search-hreflang`,
        title: `LaunchChecklistItem.searchHreflang`,
        why: `LaunchChecklistItem.searchHreflangWhy`,
        seed: { coverage: Coverage.Full, path: `apps/mpa/site.tsx`, title: `apps/mpa/site.tsx` },
      },
      {
        id: `search-lighthouse-console`,
        title: `LaunchChecklistItem.searchLighthouseConsole`,
        why: `LaunchChecklistItem.searchLighthouseConsoleWhy`,
        seed: {
          coverage: Coverage.Partial,
          path: `apps/mpa/lighthouse/lighthouserc.json`,
          title: `apps/mpa/lighthouse/lighthouserc.json`,
          left: `LaunchChecklistItem.searchLighthouseConsoleLeft`,
        },
      },
    ],
  },
  {
    id: `analytics`,
    title: `LaunchChecklistSection.analytics`,
    items: [
      {
        id: `analytics-goals`,
        title: `LaunchChecklistItem.analyticsGoals`,
        why: `LaunchChecklistItem.analyticsGoalsWhy`,
        seed: {
          coverage: Coverage.Partial,
          path: `docs/analytics.md`,
          title: `Website analytics`,
          left: `LaunchChecklistItem.analyticsGoalsLeft`,
        },
      },
    ],
  },
  {
    id: `support`,
    title: `LaunchChecklistSection.support`,
    items: [
      {
        id: `support-contact`,
        title: `LaunchChecklistItem.supportContact`,
        why: `LaunchChecklistItem.supportContactWhy`,
        seed: {
          coverage: Coverage.Partial,
          path: `docs/admin-modules.md`,
          title: `Admin modules`,
          left: `LaunchChecklistItem.supportContactLeft`,
        },
      },
      {
        id: `support-admin-lookup`,
        title: `LaunchChecklistItem.supportAdminLookup`,
        why: `LaunchChecklistItem.supportAdminLookupWhy`,
        seed: { coverage: Coverage.Full, path: `docs/admin-modules.md`, title: `Admin modules` },
      },
      {
        id: `support-error-pages`,
        title: `LaunchChecklistItem.supportErrorPages`,
        why: `LaunchChecklistItem.supportErrorPagesWhy`,
        seed: {
          coverage: Coverage.Full,
          path: `apps/mpa/error-page.tsx`,
          title: `apps/mpa/error-page.tsx`,
        },
      },
      {
        id: `support-deploy-rollback`,
        title: `LaunchChecklistItem.supportDeployRollback`,
        why: `LaunchChecklistItem.supportDeployRollbackWhy`,
        seed: {
          coverage: Coverage.Full,
          path: `docs/deploy-updates.md#roll-back`,
          title: `Deploy an update`,
        },
      },
    ],
  },
]

/** Every item, in page order. */
export const CHECKLIST_ITEMS: readonly ChecklistItem[] = CHECKLIST.flatMap(({ items }) => items)

/**
 * The counts the page's title, lead and closing block say: items, sections, and the items Seed
 * covers in full. Computed, so a new item can never leave a sentence wrong.
 */
export const CHECKLIST_COUNTS = {
  items: CHECKLIST_ITEMS.length,
  sections: CHECKLIST.length,
  covered: CHECKLIST_ITEMS.filter(({ seed }) => seed?.coverage === Coverage.Full).length,
} as const

/** The browser's storage key for the ticks: the same in every language. */
export const CHECKLIST_STORAGE_KEY = `seed.launch-checklist.v1`

/** The page's path in the default language. */
export const CHECKLIST_PATH = `/saas-launch-checklist`

/**
 * Where a proof opens, and its short form for print: a published guide on this website, a page of
 * the website, or any other file on GitHub.
 *
 * @param path The proof's {@link SeedCover.path}.
 * @param localize Puts the page's language in front of a website path.
 * @param host The website's host, such as `seedsaas.com`, for the short form.
 */
export function proofLink(
  path: string,
  localize: (path: string) => string,
  host: string,
): { href: string; short: string } {
  const [file, fragment] = path.split(`#`)
  const hash = fragment ? `#${fragment}` : ``
  const slug = file.match(/^docs\/([a-z0-9-]+)\.md$/)?.[1]
  const site = file.startsWith(`/`) ? file : slug && isPublishedDoc(slug) && `${DOCS_PATH}/${slug}`
  if (site) return { href: `${localize(site)}${hash}`, short: `${host}${site}` }
  const github = `${REPOSITORY_URL}/blob/main/`
  return {
    href: `${github}${encodeURI(file)}${hash}`,
    short: `${github.replace(`https://`, ``)}${file}`,
  }
}
