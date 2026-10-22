# The database: the stock Postgres image plus the old zone names that browsers still report, such as
# `Asia/Saigon`, `Asia/Calcutta` and `Europe/Kiev`. Debian 13 moved them to `tzdata-legacy`, and
# without it `AT TIME ZONE` refuses them, so every per-day count fails for those people. Compose
# passes POSTGRES_IMAGE (the `db` service in infra/compose/compose.shared.yml).
ARG POSTGRES_IMAGE=docker.io/library/postgres:18.6
FROM ${POSTGRES_IMAGE}
RUN export DEBIAN_FRONTEND=noninteractive \
  && apt-get update \
  && apt-get install -y --no-install-recommends tzdata-legacy \
  && rm -rf /var/lib/apt/lists/*
