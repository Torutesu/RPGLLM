#!/usr/bin/env bash
# Local Postgres 16 for dev/test. Runs as the `postgres` OS user.
set -euo pipefail
PGBIN=/usr/lib/postgresql/16/bin
PGDATA=/home/user/pgdata
PGRUN=/home/user/pgrun
PSQL="psql -h 127.0.0.1 -U postgres"
case "${1:-}" in
  start)
    if ! $PSQL -c 'select 1' >/dev/null 2>&1; then
      mkdir -p $PGDATA $PGRUN; chown postgres $PGDATA $PGRUN
      [ -f $PGDATA/PG_VERSION ] || su postgres -c "$PGBIN/initdb -D $PGDATA -U postgres --auth=trust" >/dev/null
      su postgres -c "$PGBIN/pg_ctl -D $PGDATA -o '-p 5432 -k $PGRUN -c listen_addresses=127.0.0.1' -l $PGDATA/pg.log start" >/dev/null
      sleep 2
    fi
    for db in rpgllm rpgllm_test; do $PSQL -tc "select 1 from pg_database where datname='$db'" | grep -q 1 || $PSQL -c "create database $db" >/dev/null; done
    echo "postgres ready (rpgllm, rpgllm_test)";;
  stop) su postgres -c "$PGBIN/pg_ctl -D $PGDATA stop" ;;
  # Agent F: DROP ... WITH (FORCE) (PG13+) — an idle API/vitest connection used to make the E2E
  # globalSetup fail with "database is being accessed by other users". The API opens a pooled
  # connection as soon as /v1/health probes the database.
  reset) $PSQL -c "drop database if exists rpgllm_test with (force)" >/dev/null; $PSQL -c "create database rpgllm_test" >/dev/null; echo "rpgllm_test reset";;
  *) echo "usage: db.sh start|stop|reset"; exit 1;;
esac
