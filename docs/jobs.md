# Background jobs

A job is work the server does outside a request: send an email, sync a count, clean up old rows.
Each run is a row in `outbox_events` with `aggregate_type = 'job'`, written in the same transaction
as the change that needs it, so a crash never loses one and a rollback never sends one. The worker
(`apps/worker`) claims rows whose time has come and runs their handler. Operators see every run in
the admin's Jobs module.

## Add a job

1. Write the handler in `libs/server/jobs/<name>.ts`. It gets the row's `aggregateId`, the id of
   the row it is about, and reads everything else from the database: a job row carries no payload.
   Export the kind as a constant, such as `INVOICE_MAIL_JOB = "billing.invoice-mail"`.
2. Add one `defineJob` to `JOBS` in `libs/server/jobs/registry.ts`:

   ```ts
   defineJob({
     kind: INVOICE_MAIL_JOB,
     label: `Invoice email`, // what the admin's Jobs module shows
     sendsMail: true, // the admin asks before running it again or now
     about: { userIn: `invoices` }, // optional: links the run to the person
     handler: (deps) => invoiceMailJob(deps),
   })
   ```

   `about` names a table whose `id` is the job's `aggregateId` and that has a `user_id` column, or
   `{ group: true }` when the `aggregateId` is a group's id. `cannotCancel` (why, and what to do
   instead) hides Cancel for a kind whose own page stops it. The worker refuses to start with two
   jobs of one kind or an invalid definition.
3. Queue it with `enqueueJob` where the change happens (below).
4. Test the handler next to it, and add the kind to `libs/server/jobs/registry.test.ts` if the test
   lists kinds.

## Queue a run

`enqueueJob(sql, kind, aboutId, when)` from `libs/server/jobs/jobs.ts` writes one row and returns
its id. Pass the transaction of the change:

```ts
await sql.begin(async (tx) => {
  await tx`INSERT INTO invoices (id, user_id) VALUES (${invoiceId}, ${userId})`
  await enqueueJob(tx, INVOICE_MAIL_JOB, invoiceId, { inMs: 0 }) // now
})
```

- **Now:** `{ inMs: 0 }`.
- **Later:** `{ inMs: 15 * 60_000 }`, or `{ at: new Date("2026-12-01T09:00:00Z") }` for a time.

## Repeat a job

Give the definition a `repeat`:

- `{ cron: "0 3 * * *" }` runs on a cron schedule in UTC: five fields (minute, hour, day of month,
  month, day of week) or an alias such as `@daily` (`@spy4x/time/cron`). `defineJob` refuses an
  expression it cannot read. The admin shows it in words, such as "Every day at 03:00 UTC".
- `{ everyMs: 60 * 60_000 }` runs every hour, the first run at once.

The worker writes the first run when it starts (`startRepeatingJobs`), once per kind: a cron job at
its next matching minute. After each run, whether it succeeded or was given up, it writes the next
one. So a repeating job has one waiting row at a time. The nightly cleanup (`outbox.cleanup`) runs
at `0 3 * * *`.

## Failures

A failed attempt is retried after 1 s, 2 s, 4 s and so on, up to 15 minutes. After 20 attempts,
about two and a half hours, the worker gives up: the row is closed and keeps the error's class, never
its message (`JOB_RETRY` in `libs/server/jobs/job-failures.ts`). The worker logs every failed
attempt and the last one as `abandoned`. A run whose worker died is taken again after its lease of
60 seconds.

The nightly cleanup removes finished rows after 7 days.

## In the admin

The Jobs module (`/jobs` on the admin host) lists every run with its state: Scheduled, Due now,
Running, Waiting to retry, Failed, Done or Cancelled. An operator can:

- **Run again** a failed run: its attempts start over. Refused when a newer run of the same job
  waits.
- **Run now** a run that waits: its time becomes now. On the Repeating tab, Run now on a repeating
  job moves its waiting run, or starts it again if it was cancelled; it never writes a second
  waiting run.
- **Cancel** a run that waits and is not running. A cancelled repeating job starts again the next
  time the worker starts. A kind with `cannotCancel` in the registry has no Cancel, and the API
  refuses it with that text: `blog.publish` is stopped by unscheduling the post on the Blog page.
  Run now on a `blog.publish` run before the post's time publishes nothing and queues the run
  for that time again ([blog.md](blog.md)).

Each action is guarded in SQL against a worker that takes the run at the same moment, and is
written to the audit log. Group changes (`note.created` and the like) are not jobs and are not
listed: replaying them out of order is unsafe.
