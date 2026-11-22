#!/usr/bin/env bash
set -e

# if the first argument starts with `-`, prepend `node dist/index`
if [ "${1#-}" != "$1" ]; then
  set -- node dist/index "$@"
fi

exec "$@"
