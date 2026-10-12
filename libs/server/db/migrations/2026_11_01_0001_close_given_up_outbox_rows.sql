-- Until now the worker gave a row up after 10 attempts and left it unprocessed for good. The worker
-- that ships with this migration retries 20 times, so every such row would be claimed again: a
-- password reset mail or a newsletter issue queued days or weeks ago would go out. This closes
-- them, with the error's class kept in last_error_code, before that worker starts; the nightly
-- cleanup removes them a week later. A cleanup row that was given up is closed too, and the worker
-- writes a fresh one when it starts.
UPDATE outbox_events SET processed_at = now() WHERE processed_at IS NULL AND attempt_count >= 10;
