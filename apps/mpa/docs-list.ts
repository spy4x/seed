// Seed's own site: see docs/start-a-product.md
/**
 * The guides this product's website publishes at `/docs/<slug>`, and the address its pointer lines
 * name. The only product-specific part of the docs: a product replaces this file with its own
 * guides and lists it in `.seed/skip` (`docs/start-a-product.md`). `docs-site.ts` renders them.
 *
 * @module
 */
import type { PublishedDocGroup } from "./docs-site.ts"
import adminModules from "../../docs/admin-modules.md" with { type: "text" }
import aggregateExtras from "../../docs/aggregate-extras.md" with { type: "text" }
import aggregateLifecycle from "../../docs/aggregate-lifecycle.md" with { type: "text" }
import aggregateOffline from "../../docs/aggregate-offline.md" with { type: "text" }
import aggregateRelations from "../../docs/aggregate-relations.md" with { type: "text" }
import aggregates from "../../docs/aggregates.md" with { type: "text" }
import aiAgents from "../../docs/ai-agents.md" with { type: "text" }
import apiErrors from "../../docs/api-errors.md" with { type: "text" }
import apps from "../../docs/apps.md" with { type: "text" }
import attachmentsAndPictures from "../../docs/attachments-and-pictures.md" with { type: "text" }
import backups from "../../docs/backups.md" with { type: "text" }
import billing from "../../docs/billing.md" with { type: "text" }
import billingLifecycle from "../../docs/billing-lifecycle.md" with { type: "text" }
import billingOperator from "../../docs/billing-operator.md" with { type: "text" }
import billingPlans from "../../docs/billing-plans.md" with { type: "text" }
import browserTests from "../../docs/browser-tests.md" with { type: "text" }
import capacity from "../../docs/capacity.md" with { type: "text" }
import catalog from "../../docs/catalog.md" with { type: "text" }
import certificates from "../../docs/certificates.md" with { type: "text" }
import dataExport from "../../docs/data-export.md" with { type: "text" }
import deploy from "../../docs/deploy.md" with { type: "text" }
import deployUpdates from "../../docs/deploy-updates.md" with { type: "text" }
import development from "../../docs/development.md" with { type: "text" }
import fileUploads from "../../docs/file-uploads.md" with { type: "text" }
import files from "../../docs/files.md" with { type: "text" }
import firstFeature from "../../docs/first-feature.md" with { type: "text" }
import getStarted from "../../docs/get-started.md" with { type: "text" }
import guests from "../../docs/guests.md" with { type: "text" }
import ids from "../../docs/ids.md" with { type: "text" }
import largeGroup from "../../docs/large-group.md" with { type: "text" }
import loadTests from "../../docs/load-tests.md" with { type: "text" }
import localStack from "../../docs/local-stack.md" with { type: "text" }
import offline from "../../docs/offline.md" with { type: "text" }
import offlineAppShell from "../../docs/offline-app-shell.md" with { type: "text" }
import offlineData from "../../docs/offline-data.md" with { type: "text" }
import offlineSignOut from "../../docs/offline-sign-out.md" with { type: "text" }
import offlineWrites from "../../docs/offline-writes.md" with { type: "text" }
import operatorAccess from "../../docs/operator-access.md" with { type: "text" }
import products from "../../docs/products.md" with { type: "text" }
import releases from "../../docs/releases.md" with { type: "text" }
import restore from "../../docs/restore.md" with { type: "text" }
import securityHeaders from "../../docs/security-headers.md" with { type: "text" }
import settings from "../../docs/settings.md" with { type: "text" }
import severalProjects from "../../docs/several-projects.md" with { type: "text" }
import signInProviders from "../../docs/sign-in-providers.md" with { type: "text" }
import startAProduct from "../../docs/start-a-product.md" with { type: "text" }
import telegram from "../../docs/telegram.md" with { type: "text" }

/** The address of the website the docs' own pointer lines name (`docs/*.md`, the README). */
export const DOCS_SITE_ORIGIN = `https://seedsaas.com`

/**
 * The guides the website publishes, in the groups and order of `docs/README.md`. Every other file
 * under `docs/` stays in the repository only: the handoff, the design and product documents, the
 * decisions, the once-per-server upgrade, the CI setup and the runtime policy. A file listed here
 * needs its import above, its line in `.dockerignore` and `infra/deploy/include.txt`, and the
 * pointer line at its top (`docs-site.test.ts` and `tests/dockerignore.test.ts` check all four).
 */
export const PUBLISHED_DOCS: readonly PublishedDocGroup[] = [
  {
    title: `Get started`,
    docs: [
      {
        file: `docs/get-started.md`,
        slug: `get-started`,
        text: getStarted,
        summary: `Run Seed on your machine in four commands.`,
      },
      {
        file: `docs/products.md`,
        slug: `products`,
        text: products,
        summary: `Start a product, take Seed's later changes, give back to Seed.`,
      },
      {
        file: `docs/start-a-product.md`,
        slug: `start-a-product`,
        text: startAProduct,
        summary: `What a new product deletes, replaces or sets.`,
      },
      {
        file: `docs/local-stack.md`,
        slug: `local-stack`,
        text: localStack,
        summary: `Run Seed on your machine with demo data, and reset it.`,
      },
      {
        file: `docs/first-feature.md`,
        slug: `first-feature`,
        text: firstFeature,
        summary: `A new kind of record, from the database to the screen.`,
      },
      {
        file: `docs/ai-agents.md`,
        slug: `ai-agents`,
        text: aiAgents,
        summary: `Have an AI agent create a product from Seed, add features and check its work.`,
      },
    ],
  },
  {
    title: `Guides`,
    docs: [
      {
        file: `docs/deploy.md`,
        slug: `deploy`,
        text: deploy,
        summary: `From a fresh server to a healthy deployment with HTTPS.`,
      },
      {
        file: `docs/deploy-updates.md`,
        slug: `deploy-updates`,
        text: deployUpdates,
        summary: `Every deploy after the first, and rolling back.`,
      },
      {
        file: `docs/certificates.md`,
        slug: `certificates`,
        text: certificates,
        summary: `How each host gets its certificate, and retrying one.`,
      },
      {
        file: `docs/operator-access.md`,
        slug: `operator-access`,
        text: operatorAccess,
        summary: `The first administrator, roles, and opening Grafana.`,
      },
      {
        file: `docs/several-projects.md`,
        slug: `several-projects`,
        text: severalProjects,
        summary: `Products that share one server and one Traefik.`,
      },
      {
        file: `docs/releases.md`,
        slug: `releases`,
        text: releases,
        summary: `A version tag publishes the images to Docker Hub.`,
      },
      {
        file: `docs/backups.md`,
        slug: `backups`,
        text: backups,
        summary: `Turn on the daily backup, and rehearse it.`,
      },
      {
        file: `docs/restore.md`,
        slug: `restore`,
        text: restore,
        summary: `Bring back the database, the files and the push keys.`,
      },
      {
        file: `docs/sign-in-providers.md`,
        slug: `sign-in-providers`,
        text: signInProviders,
        summary: `Registering the providers and what a person gets.`,
      },
      {
        file: `docs/guests.md`,
        slug: `guests`,
        text: guests,
        summary:
          `"Try it now" without signing up, keeping the account, the limits and the clean-up.`,
      },
      {
        file: `docs/billing.md`,
        slug: `billing`,
        text: billing,
        summary: `Paid plans through Stripe, test mode first, then live.`,
      },
      {
        file: `docs/billing-plans.md`,
        slug: `billing-plans`,
        text: billingPlans,
        summary: `Change a plan, add one, or add a limit a plan sells.`,
      },
      {
        file: `docs/billing-operator.md`,
        slug: `billing-operator`,
        text: billingOperator,
        summary: `The admin panel's Billing pages, transfers, and Stripe's dashboard.`,
      },
      {
        file: `docs/files.md`,
        slug: `files`,
        text: files,
        summary: `Garage or another S3 store, its settings and the upload budget.`,
      },
      {
        file: `docs/file-uploads.md`,
        slug: `file-uploads`,
        text: fileUploads,
        summary: `Upload and download files from a feature, and have photos made safe and small.`,
      },
      {
        file: `docs/data-export.md`,
        slug: `data-export`,
        text: dataExport,
        summary: `Download my data, what the ZIP holds and how it expires.`,
      },
      {
        file: `docs/catalog.md`,
        slug: `catalog`,
        text: catalog,
        summary: `A shop's items with photos, colours and sizes, edited in the admin panel.`,
      },
      {
        file: `docs/telegram.md`,
        slug: `telegram`,
        text: telegram,
        summary: `BotFather, the webhook, linking a chat, and adding a product's commands.`,
      },
      {
        file: `docs/offline.md`,
        slug: `offline`,
        text: offline,
        summary: `Turn the offline layer or the WebSocket module off, or remove them.`,
      },
      {
        file: `docs/aggregates.md`,
        slug: `aggregates`,
        text: aggregates,
        summary: `Every file of the notes aggregate, in order.`,
      },
      {
        file: `docs/aggregate-offline.md`,
        slug: `aggregate-offline`,
        text: aggregateOffline,
        summary: `Read, and write, an aggregate with no network.`,
      },
      {
        file: `docs/aggregate-relations.md`,
        slug: `aggregate-relations`,
        text: aggregateRelations,
        summary: `One aggregate naming another, with tags and notes as the example.`,
      },
      {
        file: `docs/aggregate-lifecycle.md`,
        slug: `aggregate-lifecycle`,
        text: aggregateLifecycle,
        summary: `Restore after delete, a move to another group, and the data export.`,
      },
      {
        file: `docs/aggregate-extras.md`,
        slug: `aggregate-extras`,
        text: aggregateExtras,
        summary: `Group settings, the overview, the inbox and the rest of the app.`,
      },
      {
        file: `docs/admin-modules.md`,
        slug: `admin-modules`,
        text: adminModules,
        summary: `The operator area as a list of modules, and how to add one.`,
      },
      {
        file: `docs/load-tests.md`,
        slug: `load-tests`,
        text: loadTests,
        summary: `Run the k6 scenarios and build a large test group.`,
      },
      {
        file: `docs/browser-tests.md`,
        slug: `browser-tests`,
        text: browserTests,
        summary: `The Playwright specs in e2e/, and which of them CI runs.`,
      },
    ],
  },
  {
    title: `Concepts`,
    docs: [
      {
        file: `docs/apps.md`,
        slug: `apps`,
        text: apps,
        summary: `The SPA, the admin app and the public website, and how to deploy each.`,
      },
      { file: `docs/ids.md`, slug: `ids`, text: ids, summary: `Every id is a UUID version 7.` },
      {
        file: `docs/capacity.md`,
        slug: `capacity`,
        text: capacity,
        summary: `How many users one server carries.`,
      },
      {
        file: `docs/billing-lifecycle.md`,
        slug: `billing-lifecycle`,
        text: billingLifecycle,
        summary: `A group's plan from checkout to cancellation, and its mails.`,
      },
      {
        file: `docs/offline-data.md`,
        slug: `offline-data`,
        text: offlineData,
        summary: `What the SPA keeps on the device and how it reads offline.`,
      },
      {
        file: `docs/offline-writes.md`,
        slug: `offline-writes`,
        text: offlineWrites,
        summary: `How a change made offline reaches the server, or is refused.`,
      },
      {
        file: `docs/offline-sign-out.md`,
        slug: `offline-sign-out`,
        text: offlineSignOut,
        summary: `What the SPA deletes, and keeps, when a person signs out.`,
      },
      {
        file: `docs/offline-app-shell.md`,
        slug: `offline-app-shell`,
        text: offlineAppShell,
        summary: `How the service worker starts the app with no network.`,
      },
      {
        file: `docs/attachments-and-pictures.md`,
        slug: `attachments-and-pictures`,
        text: attachmentsAndPictures,
        summary: `Files kept on a note, and a person's picture in place of their initials.`,
      },
      {
        file: `docs/large-group.md`,
        slug: `large-group`,
        text: largeGroup,
        summary: `How one group behaves from a thousand notes to a million.`,
      },
    ],
  },
  {
    title: `Reference`,
    docs: [
      {
        file: `docs/development.md`,
        slug: `development`,
        text: development,
        summary: `Every deno task, what it does and where it is explained.`,
      },
      {
        file: `docs/settings.md`,
        slug: `settings`,
        text: settings,
        summary: `Every variable of the env file.`,
      },
      {
        file: `docs/api-errors.md`,
        slug: `api-errors`,
        text: apiErrors,
        summary: `The one error body every failed API answer has.`,
      },
      {
        file: `docs/security-headers.md`,
        slug: `security-headers`,
        text: securityHeaders,
        summary: `The headers every answer of the API, SPA and MPA sends.`,
      },
    ],
  },
]
