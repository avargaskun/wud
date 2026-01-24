#!/bin/bash

echo "🧹 Cleaning up test containers..."

# Stop and remove test containers
docker rm -f ecr_sub_sub_test ghcr_radarr gitlab_test hub_homeassistant_202161 hub_homeassistant_latest hub_nginx_120 hub_nginx_latest hub_traefik_245 lscr_radarr trueforge_radarr quay_prometheus wud wud-agent wud-controller wud-dind remote_nginx_update remote_nginx_latest 2>/dev/null || true

# Remove network
docker network rm wud-e2e-net 2>/dev/null || true

echo "✅ Test containers cleaned up"
