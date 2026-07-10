#!/usr/bin/env sh
set -eu
install -d -o studio -g studio -m 0700 /data
exec su-exec studio uvicorn server:app --host 0.0.0.0 --port 8099 --no-access-log --no-proxy-headers
