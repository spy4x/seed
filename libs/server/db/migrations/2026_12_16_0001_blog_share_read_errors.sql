-- #838: the results job reads each posted copy's numbers. When a read fails, the share keeps why
-- (`read_error`) and when (`read_failed_at`), so the checklist says the numbers shown are older, and
-- the job waits as long as after a good read before it tries again. A good read clears both.
ALTER TABLE blog_post_shares ADD COLUMN IF NOT EXISTS read_error VARCHAR(500);
ALTER TABLE blog_post_shares ADD COLUMN IF NOT EXISTS read_failed_at TIMESTAMPTZ;
ALTER TABLE blog_post_shares DROP CONSTRAINT IF EXISTS blog_post_shares_read_error_check;
ALTER TABLE blog_post_shares ADD CONSTRAINT blog_post_shares_read_error_check
    CHECK ((read_error IS NULL) = (read_failed_at IS NULL));
