#!/bin/sh
# Dokploy (et tout bind mount) crée /data en root. SQLite, lancé ensuite
# sous nextjs, renvoie alors SQLITE_CANTOPEN (14) en créant openkido.db.
set -e
if [ "$(id -u)" = "0" ]; then
  mkdir -p /data
  chown -R nextjs:nodejs /data
  exec su-exec nextjs:nodejs "$@"
fi
exec "$@"
