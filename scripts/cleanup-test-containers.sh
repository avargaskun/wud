#!/bin/bash

echo "🧹 Cleaning up test containers..."

# Stop and remove test containers
docker rm -f \
    ecr_sub_sub_test \
    ghcr_radarr gitlab_test \
    ghcr_podinfo_500 \
    ghcr_podinfo_autotest \
    ghcr_podinfo_latest \
    hub_homeassistant_202161 \
    hub_homeassistant_latest \
    hub_nginx_120 \
    hub_nginx_latest \
    hub_traefik_245 \
    lscr_radarr \
    trueforge_radarr \
    quay_prometheus \
    zz_batch_local_1 \
    zz_batch_local_2 \
    wud \
    wud-agent \
    wud-controller \
    wud-dind \
    remote_podinfo_update \
    remote_podinfo_latest \
    zz_batch_remote_1 \
    zz_batch_remote_2 \
    zz_batch_compose_1 \
    zz_batch_compose_2 2>/dev/null || true

# Tear down the compose stack and remove the disposable runtime copy
docker compose -f "$(dirname "$0")/../test/compose-stack/docker-compose.active.yml" down --remove-orphans 2>/dev/null || true
rm -f "$(dirname "$0")/../test/compose-stack/docker-compose.active.yml"

# Remove network
docker network rm wud-e2e-net 2>/dev/null || true

echo "✅ Test containers cleaned up"
