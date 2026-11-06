-- #839: Seed posts a live post to a channel by itself when the channel's `auto_post` is on (Dev.to,
-- Telegram, Mastodon, Bluesky, Hashnode and LinkedIn can). Every Dev.to channel, the one #840's
-- migration made included, was automatic before the switch existed, so it starts on for them. The
-- column and the Dev.to switch are written together, once: a second run changes nothing, and never
-- turns back on a Dev.to channel the operator switched off.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'blog_channels'
            AND column_name = 'auto_post'
    ) THEN
        ALTER TABLE blog_channels ADD COLUMN auto_post BOOLEAN DEFAULT false NOT NULL;
        UPDATE blog_channels SET auto_post = true WHERE kind = 'devto';
    END IF;
END
$$;

-- When an automatic post to a channel without a way to look a post up (Telegram, LinkedIn) was
-- started, or one with a lookup (Bluesky, Hashnode) failed in a way that may have posted. While it
-- is set, the job never posts that row blindly again: it looks the copy up, or leaves the row to the
-- operator. "Try again" on the checklist clears it.
ALTER TABLE blog_post_shares ADD COLUMN IF NOT EXISTS post_attempted_at TIMESTAMPTZ;
