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
    
    $DOCKER_CMD pull ghcr.io/stefanprodan/podinfo:5.0.0
    $DOCKER_CMD pull ghcr.io/stefanprodan/podinfo:latest
    
    # Run containers
    # Update available (podinfo 5.0.0 -> 6.0.0)
    $DOCKER_CMD run -d --name remote_podinfo_update \
        --label 'wud.watch=true' \
        --label 'wud.tag.include=^6\.0\.0$' \
        ghcr.io/stefanprodan/podinfo:5.0.0
        
    # Latest (Up to date)
    $DOCKER_CMD run -d --name remote_podinfo_latest \
        --label 'wud.watch=true' \
        --label 'wud.tag.include=^latest$' \
        ghcr.io/stefanprodan/podinfo:latest

else
    # Full setup (Host/Controller)
    echo "   Running full setup..."
    
    # Login to private registries (if credentials available)
    if [ ! -z "$GITLAB_TOKEN" ]; then
      $DOCKER_CMD login registry.gitlab.com -u "$GITLAB_USERNAME" -p "$GITLAB_TOKEN"
    fi

    # Pull podinfo as a test image
    $DOCKER_CMD pull ghcr.io/stefanprodan/podinfo:5.0.0
    $DOCKER_CMD pull ghcr.io/stefanprodan/podinfo:6.0.0

    # Tag podinfo 5.0.0 as latest to simulate an update_available (digest mismatch)
    $DOCKER_CMD tag ghcr.io/stefanprodan/podinfo:5.0.0 ghcr.io/stefanprodan/podinfo:latest

    # Tag podinfo as if it was coming from private registries
    ECR_TARGET=${ECR_REGISTRY_URL:-"229211676173.dkr.ecr.eu-west-1.amazonaws.com"}/${ECR_IMAGE_NAME:-"sub/sub/test"}:1.0.0
    if [ -z "$ECR_REGISTRY_URL" ]; then
        $DOCKER_CMD tag ghcr.io/stefanprodan/podinfo:5.0.0 fmartinou/test:1.0.0
        $DOCKER_CMD tag ghcr.io/stefanprodan/podinfo:5.0.0 229211676173.dkr.ecr.eu-west-1.amazonaws.com/test:1.0.0
        $DOCKER_CMD tag ghcr.io/stefanprodan/podinfo:5.0.0 229211676173.dkr.ecr.eu-west-1.amazonaws.com/sub/test:1.0.0
        $DOCKER_CMD tag ghcr.io/stefanprodan/podinfo:5.0.0 229211676173.dkr.ecr.eu-west-1.amazonaws.com/sub/sub/test:1.0.0
    else
        $DOCKER_CMD pull $ECR_TARGET
    fi

    # Pull homeassistant
    $DOCKER_CMD pull homeassistant/home-assistant
    $DOCKER_CMD pull homeassistant/home-assistant:2021.6.1

    echo "✅ Docker images pulled and tagged"

    # Run containers for tests
    echo "🚀 Starting test containers..."

    # ECR
    echo "Pulling ECR test image $ECR_TARGET ..."
    $DOCKER_CMD run -d --name ecr_sub_sub_test --label 'wud.watch=true' $ECR_TARGET

    # GHCR
    echo "Pulling GHCR test images ..."
    $DOCKER_CMD run -d --name ghcr_radarr --label 'wud.watch=true' --label 'wud.tag.include=^\d+\.\d+\.\d+\.\d+-ls\d+$' ghcr.io/linuxserver/radarr:5.14.0.9383-ls245
    $DOCKER_CMD run -d --name ghcr_podinfo_500 --label 'wud.watch=true' --label 'wud.tag.include=^6\.0\.0$' ghcr.io/stefanprodan/podinfo:5.0.0
    $DOCKER_CMD run -d --name ghcr_podinfo_latest --label 'wud.watch=true' --label 'wud.watch.digest=true' --label 'wud.tag.include=^latest$' ghcr.io/stefanprodan/podinfo:latest

    # GITLAB
    echo "Pulling Gitlab test images ..."
    $DOCKER_CMD run -d --name gitlab_test --label 'wud.watch=true' --label 'wud.tag.include=^v16\.[01]\.0$' registry.gitlab.com/gitlab-org/gitlab-runner:v16.0.0

    # HUB
    echo "Pulling DockerHub test images ..."
    $DOCKER_CMD run -d --name hub_homeassistant_202161 --label 'wud.watch=true' --label 'wud.tag.include=^\d+\.\d+.\d+$' --label 'wud.link.template=https://github.com/home-assistant/core/releases/tag/${major}.${minor}.${patch}' homeassistant/home-assistant:2021.6.1

    # LSCR
    echo "Pulling LSCR test images ..."
    $DOCKER_CMD run -d --name lscr_radarr --label 'wud.watch=true' --label 'wud.tag.include=^\d+\.\d+\.\d+\.\d+-ls\d+$' lscr.io/linuxserver/radarr:5.14.0.9383-ls245

    # TrueForge
    echo "Pulling TrueForge test images ..."
    $DOCKER_CMD run -d --name trueforge_radarr --label 'wud.watch=true' --label 'wud.tag.include=^v\d+\.\d+\.\d+$' --memory 512m --tmpfs /config oci.trueforge.org/containerforge/radarr:6.0.4

    # QUAY
    echo "Pulling Quay test images ..."
    $DOCKER_CMD run -d --name quay_prometheus --label 'wud.watch=true' --label 'wud.tag.include=^v\d+\.\d+\.\d+$' --user root --tmpfs /prometheus:rw,mode=777 quay.io/prometheus/prometheus:v2.52.0

    echo "✅ Test containers started (9 containers)"
    $DOCKER_CMD ps --format "table {{.Names}}	{{.Image}}	{{.Status}}" | grep -E "(ecr_|ghcr_|gitlab_|hub_|lscr_|quay_|trueforge_)"
fi

