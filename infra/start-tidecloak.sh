#!/usr/bin/env bash
# Local TideCloak for development (Raziel playbook: start-tidecloak-dev).
# tidecloak-dev talks to the production Tide network; do not add ORK/threshold env vars
# and do not append start-dev. admin/password is the dev-image default, localhost only.
set -e

if docker ps -a --format '{{.Names}}' | grep -qx countersign-tidecloak; then
  docker start countersign-tidecloak
else
  docker run -d --name countersign-tidecloak -p 8080:8080 \
    -e KC_BOOTSTRAP_ADMIN_USERNAME=admin \
    -e KC_BOOTSTRAP_ADMIN_PASSWORD=password \
    tideorg/tidecloak-dev:latest
fi

for i in $(seq 1 60); do
  curl -sf http://localhost:8080 > /dev/null 2>&1 && echo "TideCloak ready" && exit 0
  sleep 3
done
echo "TideCloak did not answer within 3 minutes" >&2
exit 1
