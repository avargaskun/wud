#!/bin/bash

set -e

MODE=${1:-full}
TARGET_HOST=${TARGET_DOCKER_HOST:-""}

DOCKER_CMD="docker"
if [ ! -z "$TARGET_HOST" ]; then
    echo "🔧 Using remote docker host: $TARGET_HOST"
    DOCKER_CMD="docker -H $TARGET_HOST"
fi

echo "🐳 Setting up test containers (Mode: $MODE)..."

if [ "$MODE" == "minimal" ]; then
    # Minimal setup for Agent
    echo "   Running minimal setup..."
    
    $DOCKER_CMD pull nginx:1.10-alpine
    $DOCKER_CMD pull nginx:latest
    
    # Run containers
    # Update available (nginx 1.10)
    $DOCKER_CMD run -d --name remote_nginx_update \
        --label 'wud.watch=true' \
        --label 'wud.tag.include=^\d+\.\d+-alpine$' \
        nginx:1.10-alpine
        
    # Latest (Up to date)
    $DOCKER_CMD run -d --name remote_nginx_latest \
        --label 'wud.watch=true' \
        --label 'wud.tag.include=^latest$' \
        nginx:latest

else
    # Full setup (Host/Controller)
    echo "   Running full setup..."
    
    # Login to private registries (if credentials available)
    if [ ! -z "$GITLAB_TOKEN" ]; then
      $DOCKER_CMD login registry.gitlab.com -u "$GITLAB_USERNAME" -p "$GITLAB_TOKEN"
    fi

    # Pull nginx as a test image
    $DOCKER_CMD pull nginx:1.10-alpine
    $DOCKER_CMD pull nginx:1.20-alpine

    # Tag nginx 1.10 as latest to simulate an update_available
    $DOCKER_CMD tag nginx:1.10-alpine nginx:latest

    # Tag nginx as if it was coming from private registries
    $DOCKER_CMD tag nginx:1.10-alpine fmartinou/test:1.0.0
    $DOCKER_CMD tag nginx:1.10-alpine 229211676173.dkr.ecr.eu-west-1.amazonaws.com/test:1.0.0
    $DOCKER_CMD tag nginx:1.10-alpine 229211676173.dkr.ecr.eu-west-1.amazonaws.com/sub/test:1.0.0
    $DOCKER_CMD tag nginx:1.10-alpine 229211676173.dkr.ecr.eu-west-1.amazonaws.com/sub/sub/test:1.0.0

    # Pull homeassistant
    $DOCKER_CMD pull homeassistant/home-assistant
    $DOCKER_CMD pull homeassistant/home-assistant:2021.6.1

    # Pull traefik
    $DOCKER_CMD pull traefik:2.4.5

    echo "✅ Docker images pulled and tagged"

    # Run containers for tests
    echo "🚀 Starting test containers..."

    # ECR
    $DOCKER_CMD run -d --name ecr_sub_sub_test --label 'wud.watch=true' 229211676173.dkr.ecr.eu-west-1.amazonaws.com/sub/sub/test:1.0.0

    # GHCR
    $DOCKER_CMD run -d --name ghcr_radarr --label 'wud.watch=true' --label 'wud.tag.include=^\d+\.\d+\.\d+\.\d+-ls\d+$' ghcr.io/linuxserver/radarr:5.14.0.9383-ls245

    # GITLAB
    $DOCKER_CMD run -d --name gitlab_test --label 'wud.watch=true' --label 'wud.tag.include=^v16\.[01]\.0$' registry.gitlab.com/gitlab-org/gitlab-runner:v16.0.0

    # HUB
    $DOCKER_CMD run -d --name hub_homeassistant_202161 --label 'wud.watch=true' --label 'wud.tag.include=^\d+\.\d+.\d+$' --label 'wud.link.template=https://github.com/home-assistant/core/releases/tag/${major}.${minor}.${patch}' homeassistant/home-assistant:2021.6.1
    $DOCKER_CMD run -d --name hub_homeassistant_latest --label 'wud.watch=true' --label 'wud.watch.digest=true' --label 'wud.tag.include=^latest$' homeassistant/home-assistant
    $DOCKER_CMD run -d --name hub_nginx_120 --label 'wud.watch=true' --label 'wud.tag.include=^\d+\.\d+-alpine$' nginx:1.20-alpine
    $DOCKER_CMD run -d --name hub_nginx_latest --label 'wud.watch=true' --label 'wud.watch.digest=true' --label 'wud.tag.include=^latest$' nginx
    $DOCKER_CMD run -d --name hub_traefik_245 --label 'wud.watch=true' --label 'wud.tag.include=^\d+\.\d+.\d+$' traefik:2.4.5

    # LSCR
    $DOCKER_CMD run -d --name lscr_radarr --label 'wud.watch=true' --label 'wud.tag.include=^\d+\.\d+\.\d+\.\d+-ls\d+$' lscr.io/linuxserver/radarr:5.14.0.9383-ls245

    # TrueForge
    $DOCKER_CMD run -d --name trueforge_radarr --label 'wud.watch=true' --label 'wud.tag.include=^v\d+\.\d+\.\d+$' --memory 512m --tmpfs /config oci.trueforge.org/containerforge/radarr:6.0.4

    # QUAY
    $DOCKER_CMD run -d --name quay_prometheus --label 'wud.watch=true' --label 'wud.tag.include=^v\d+\.\d+\.\d+$' --user root --tmpfs /prometheus:rw,mode=777 quay.io/prometheus/prometheus:v2.52.0

    echo "✅ Test containers started (10 containers)"
    $DOCKER_CMD ps --format "table {{.Names}}	{{.Image}}	{{.Status}}" | grep -E "(ecr_|ghcr_|gitlab_|hub_|lscr_|quay_|trueforge_)"
fi

