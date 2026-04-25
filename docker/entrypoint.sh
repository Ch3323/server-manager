#!/bin/sh
set -eu

if [ "${RUN_DB_MIGRATIONS:-true}" = "true" ]; then
  npx prisma migrate deploy
fi

exec node server.js
