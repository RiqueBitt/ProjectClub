#!/bin/sh
# Roda o que o CI roda (formatação, clippy, testes). Testes de banco/Redis
# só com PC_TEST_DATABASE_URL / PC_TEST_REDIS_URL definidas.
set -e
cd "$(dirname "$0")"
cargo fmt --all --check
cargo clippy --all-targets -- -D warnings
cargo test
