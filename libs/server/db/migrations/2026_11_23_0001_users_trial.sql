-- #205: one billing trial per person, not per group. `trial_group_id` is the group a person's
-- trial went to: the first group whose checkout they opened with a trial. Later groups of theirs
-- check out without one; that group keeps it until it has a provider customer. `trial_used_at`
-- is when it was claimed, for the admin panel. No foreign key: deleting that group must not hand
-- the trial back.
ALTER TABLE users ADD COLUMN trial_group_id UUID;
ALTER TABLE users ADD COLUMN trial_used_at TIMESTAMPTZ;
