-- #695: a paid plan may bill monthly or yearly. `billing_period` is how often the price the
-- provider last reported bills (1 month, 2 year), so the screens say "a year" and the operator
-- area counts a yearly price as its twelfth. `NULL` when that price is in no plan. Every
-- subscription stored before this bills the only price there was, a monthly one.
ALTER TABLE subscriptions ADD COLUMN billing_period INT2;
UPDATE subscriptions SET billing_period = 1 WHERE plan_id IS NOT NULL;
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_billing_period_check
    CHECK (billing_period IN (1, 2));
COMMENT ON COLUMN subscriptions.billing_period IS '1=month, 2=year';
