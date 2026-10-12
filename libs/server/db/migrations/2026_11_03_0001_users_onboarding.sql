-- #298: the first-steps checklist and the tour in the SPA. Both answers belong to the person, not
-- to a device, so they are kept here and follow the person to every device.
--
-- `onboarding_dismissed_at`: when the person closed the checklist; `NULL` while it still shows.
-- `onboarding_tour_seen_at`: when the person finished or skipped the tour; `NULL` while it is
-- still offered. Each is written once and never cleared.
--
-- Safe on a table with rows: two nullable columns with no default change the catalogue only.
ALTER TABLE users
  ADD COLUMN onboarding_dismissed_at TIMESTAMPTZ,
  ADD COLUMN onboarding_tour_seen_at TIMESTAMPTZ;

-- The "invite someone" step asks whether the person ever made an invitation. Without this index
-- that read, and the cascade when a user is deleted, scan the whole table.
--
-- Safe on a table with rows: the build blocks writes to `group_invitations` (not reads) while it
-- runs, and the table holds one short row per invitation ever made.
CREATE INDEX idx_group_invitations_created_by ON group_invitations (created_by_user_id);
