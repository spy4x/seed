# The database: the stock Postgres image plus the old zone names that browsers still report, such as
# `Asia/Saigon`, `Asia/Calcutta` and `Europe/Kiev`. Debian 13 moved them to `tzdata-legacy`, and
# without them `AT TIME ZONE` refuses those names, so every per-day count fails for those people.
# The Alpine image of the same release has them; only the names Debian lacks are copied, so no
# build needs a Debian mirror (the demo server could not reach one). Compose passes POSTGRES_IMAGE
# (the `db` service in infra/compose/compose.shared.yml).
ARG POSTGRES_IMAGE=docker.io/library/postgres:18.6
FROM docker.io/library/postgres:18.6-alpine AS zones

FROM ${POSTGRES_IMAGE}
COPY --from=zones /usr/share/zoneinfo /tmp/zoneinfo
RUN cp -an --no-preserve=ownership /tmp/zoneinfo/. /usr/share/zoneinfo/ && rm -rf /tmp/zoneinfo
