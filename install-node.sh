#!/bin/bash
# Backward-compat алиас для install.sh --mode=node.
# Рекомендуется использовать install.sh напрямую.
exec "$(dirname "$0")/install.sh" --mode=node "$@"
