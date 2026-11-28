#!/bin/sh
# Roda o que o CI roda (formatação, clippy, testes). Testes de banco/Redis
# só com PC_TEST_DATABASE_URL / PC_TEST_REDIS_URL definidas.
set -e
cd "$(dirname "$0")"
cargo fmt --all --check
cargo clippy --all-targets -- -D warnings
status=0
cargo test || status=$?
# cada teste de banco cria um `pc_test_<uuid>`: apaga no fim (com `mysql`
# instalado), senão o disco enche depois de muitas rodadas
if [ -n "$PC_TEST_DATABASE_URL" ] && command -v mysql >/dev/null 2>&1; then
  u=$(echo "$PC_TEST_DATABASE_URL" | sed -E 's#mysql://([^:]+):([^@]*)@([^:/]+):?([0-9]*).*#\1 \2 \3 \4#')
  set -- $u
  mysql -u"$1" -p"$2" -h"$3" -P"${4:-3306}" -N -e "SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'pc\\_test\\_%'" 2>/dev/null \
    | while read -r d; do echo "DROP DATABASE \`$d\`;"; done \
    | mysql -u"$1" -p"$2" -h"$3" -P"${4:-3306}" 2>/dev/null || true
fi
exit $status
