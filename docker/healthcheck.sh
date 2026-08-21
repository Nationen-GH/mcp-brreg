#!/bin/sh
# Container health probe.
#
# Only the HTTP transports expose an endpoint to probe. A stdio container has no
# listener, so probing it would mark every correctly-running stdio container
# unhealthy; report healthy instead and let the client notice a dead pipe.
set -eu

# `sse` is a deprecated alias for `http` and still starts an HTTP listener, so
# it must probe like http rather than be treated as a listener-less transport.
case "${TRANSPORT:-stdio}" in
  http | sse) ;;
  *) exit 0 ;;
esac

exec bun -e '
const port = process.env.PORT || 3000;
const url = `http://127.0.0.1:${port}/health`;
try {
  const response = await fetch(url, { signal: AbortSignal.timeout(4000) });
  process.exit(response.ok ? 0 : 1);
} catch {
  process.exit(1);
}
'
