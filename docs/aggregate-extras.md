# Connect a feature to the app

> Also on the website: [seedsaas.com/docs/aggregate-extras](https://seedsaas.com/docs/aggregate-extras).

This page connects a feature to the rest of the app: group settings, the overview, the inbox, a
new account's first minutes and the public demo. Each section copies what notes or groups already
do.

You need:

- The aggregate built ([the aggregate reference](aggregates.md)).

## Add a setting to a group

A setting belongs to the group itself, such as its description, colour and emoji. It is not a new
aggregate: the group already has the table, the repository and the change event. Copy the details
command, `group.updateDetails`.

1. **Migration.** Add the column, with a default or a nullable type so existing rows stay valid.
   Add a `CHECK` for a limit the database can hold. Mirror it in `libs/server/db/schema.sql`.
2. **Domain.** Add the field to `Group` and `GroupSummary` in `libs/domain/groups/+lib.ts`. Write
   one parser per field that throws `GroupError` with `INVALID_REQUEST`. Settings that change
   together share one command, so one request is one audit row.
3. **Repository.** Add the column to the selects, `toGroup` and `toSummary`. The write locks the
   member's row and checks the role. It then calls `audit()` and `recordChange()` in the same
   transaction.
4. **Command and handler.** The handler judges the role again (`assertCanEditDetails`). Register
   the command in `apps/api/cqrs/+init.ts`, `apps/api/index.ts` and `realtimeHub.ts`.
5. **Transports.** Add the route (`PUT /api/groups/:groupId/details`) and the socket command, with
   the same bad-input and role tests as the other group commands.
6. **Screen.** Add the field to `libs/ui/group-editor-screen.tsx` and to the create request. A role
   that may not edit sees the value as text.

A setting that existing groups must have from the start, such as the time zone, has no default
state to show: the migration fills every row (the time zone takes the owner's), then sets
`NOT NULL`. A setting the client may leave out of the details request (the time zone again) keeps
older clients working: absent means unchanged.

A colour is a lower-case `#rrggbb`, checked with `isHexColor` from
`@spy4x/platform/universal/color`. Draw text on it with `readableTextColor`. New fields on
`GroupRow`, `PickerGroup` and the SPA's `GroupItem` are optional: the device may hold groups saved
before the field existed.

Other members need nothing new. `recordChange()` sends a hint to their sockets, and their pages
read the group again. `e2e/groups-details.e2e.ts` tests this with two pages.

## Add a widget to the overview

The group overview (`/overview/:groupId`) is a page of numbers and charts about the group over a
range of days. Each aggregate offers its own widgets. A widget that shows the group's own content
or figures (its spending, its revenue, an item, who did what) is `operatorView: "never"`: the admin
group page shows only the `"counts"` widgets.

1. **Definition.** Add the widget to the aggregate's list, as `NOTE_WIDGETS` in
   `libs/domain/notes/overview.ts` does. Its fields are in the table below. Choose `operatorView`:
   `"counts"` when it only counts things, `"never"` otherwise. For a `"never"` widget the admin
   group page draws no card and adds the line "Widgets that show this group's own figures are
   visible to its members only.", and its admin route answers 404 without reading anything.
2. **Query and handler.** Write one query class per widget and a handler, as
   `apps/api/features/notes/widgets.ts` does. The handler makes the list's membership check before
   it reads anything, so a stranger is told the group does not exist.
3. **Numbers.** Read them from a read-only repository over one group, as
   `libs/server/notes/note-overview.ts` does. Cut days at midnight in the zone the request names:
   the pages send the group's (`groupTimeZone(group)`), so every member sees the same days.
4. **Register.** Add the handler to `apps/api/cqrs/+init.ts` and the operation to `realtimeHub.ts`.
5. **Drawing.** Add a `WidgetView`, as `NOTE_WIDGET_VIEWS` in `libs/ui/note-widgets.tsx` does. A
   number takes `WidgetStat`; a chart takes `LineChart` with a one-sentence summary as its caption.
6. **Registry.** Add the list and the drawings to `OVERVIEW_WIDGETS` and `OVERVIEW_VIEWS` in
   `libs/ui/overview-widgets.ts`. The SPA and the admin group page both read it.
7. **Admin.** For a `"counts"` widget, add the list and the readers to `ADMIN_WIDGETS` in
   `apps/api/routes/admin/groups.ts`. Without them the admin card shows its error. A `"never"`
   widget needs nothing there.
8. **Tests.** Copy `widgets.test.ts`, `tests/integration/note-overview.integration.test.ts` and the
   drawing's case in `libs/ui/overview.test.tsx`. Include another group's rows that must not count.

| Field          | What it holds                                                                     |
| -------------- | --------------------------------------------------------------------------------- |
| `id`           | A stable name. A saved layout keeps it, so it never changes                       |
| `titleKey`     | The `app` catalog key of its name                                                 |
| `size`         | `stat` for a number, `full` for a chart                                           |
| `canView`      | Which roles see it                                                                |
| `operation`    | The operation that answers it                                                     |
| `operatorView` | `counts`: the admin group page shows it; `never`: only the group's members see it |

A number answers with `CountWidgetResult`, and a chart with `SeriesWidgetResult`, from
`@domain/groups`. Both carry the period before the range, or `null` when the group did not exist
for all of it. A person's saved layout gets the new widget at its end.

## Tell a person in their inbox

A change that a person should hear about, and did not make, writes a notification. Copy
`libs/server/groups/group-notifications.ts`.

1. **Same transaction.** Call `createNotification(tx, …)` from `@server/notifications` after the
   change, inside its transaction. The row then exists exactly when the change does.
2. **A kind.** Add it to `NotificationKind` in `libs/domain/notifications`. Its sentence goes in
   `notificationMessage`, with its key in every `i18n/app/*.ts`.
3. **A payload and a link.** The payload holds only the facts the sentence needs, never a note body
   or an address. The link is an in-app path; anything else is refused.
4. **A test.** Add one per writer to `tests/integration/notifications.integration.test.ts`.

Nothing else is needed. `createNotification` sends `user_notification` in the same transaction,
and the API turns it into a hint on the person's sockets. The inbox and Telegram say the same
sentence, in the person's language.

## Give a new account starter data

A new account should not open onto an empty app. Sign-up queues one worker job per account with
`tx.starterData.queue(user.id)`. The job, `starterDataJob` in `libs/server/jobs/starter-data.ts`,
creates one welcome note. Sign-up never waits for it and never fails because of it.

1. Add your data inside `starterDataJob`, after the welcome note. Use your repository's own create,
   with the person as the actor.
2. Make the write repeatable. Derive each row's id from the request id, or use
   `ON CONFLICT DO NOTHING`. The welcome note's id is the request's id, so a retry adds none.
3. Skip quietly when the group is gone: that means "nothing to seed", not a failure to retry.
4. Test a forced retry in `tests/integration/starter-data.integration.test.ts`: run the job twice,
   and count the rows.

The `starter_data_requests` row marks the job done, so a job that runs again does nothing. Every
list also needs a first-run empty state: `EmptyState`, with one action when there is something to
do ([UI layout](design/ui-layout.md)).

## Add a first step

A new account's home page shows a first-steps checklist and offers a short tour
(`libs/ui/onboarding-card.tsx`). Nothing ticks a step: each one is a fact your feature already
stores.

1. **The fact.** Add one `EXISTS (…)` to `readOnboarding` in `libs/server/auth/onboarding.ts`, and
   its name to `OnboardingSteps` in `libs/domain/identity/+lib.ts`. Count only what the person did
   themselves, and give the read an index.
2. **The step.** Add it to `onboardingSteps` in the card, with a link to the page that does it.
3. **The tests.** Add a step to `tests/integration/onboarding.integration.test.ts` and its title to
   `libs/ui/onboarding.test.tsx`.

To add a screen to the tour, add it to `tourSteps` with the selector of its control and its text
keys. Dismissing the card and finishing the tour are stored on the person's `users` row, so both
follow the person to every device.

## Show it in the public demo

A new aggregate adds fake rows to the demo in the same pull request ([demo.md](demo.md), "When the
database changes").

1. Add a few believable items per themed group to `apps/worker/demo/fake-data.ts`.
2. Write them in `apps/worker/demo/seed.ts`, through the aggregate's own repository.
3. Update the counts in `tests/integration/demo-seed.integration.test.ts`.

The nightly wipe empties the new table with no change.

## Next

- [Admin modules](admin-modules.md): the aggregate's admin counterpart.
- [Delete, move and export an aggregate](aggregate-lifecycle.md)
