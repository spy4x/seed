# The backup container: the database's own Postgres image, so `pg_dump` and `pg_restore` are the
# server's version, plus the restic binary. Compose passes POSTGRES_IMAGE (the `backup` service in
# infra/compose/compose.shared.yml); tests/compose-exposure.test.ts holds it to the `db` image.
ARG POSTGRES_IMAGE=docker.io/library/postgres:18.6
FROM docker.io/restic/restic:0.18.1 AS restic

FROM ${POSTGRES_IMAGE}
COPY --from=restic /usr/bin/restic /usr/local/bin/restic
COPY --chmod=755 backup.sh /usr/local/bin/backup
# Nothing here needs root: the dump goes over the network. restic keeps its cache in the home, or
# in RESTIC_CACHE_DIR where Compose runs the service as another user (compose.shared.yml).
USER postgres
ENTRYPOINT ["backup"]
