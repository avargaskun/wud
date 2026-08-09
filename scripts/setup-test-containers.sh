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
    $DOCKER_CMD pull ghcr.io/stefanprodan/podinfo:6.0.0
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

    # Dedicated, name-findable remote containers for the batch trigger e2e (agent path)
    $DOCKER_CMD run -d --name zz_batch_remote_1 \
        --label 'wud.watch=true' \
        --label 'wud.tag.include=^6\.0\.0$' \
        ghcr.io/stefanprodan/podinfo:5.0.0
    $DOCKER_CMD run -d --name zz_batch_remote_2 \
        --label 'wud.watch=true' \
        --label 'wud.tag.include=^6\.0\.0$' \
        ghcr.io/stefanprodan/podinfo:5.0.0

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
    $DOCKER_CMD run -d --name ghcr_podinfo_autotest \
        --label 'wud.watch=true' \
        --label 'wud.tag.include=^6\.0\.0$' \
        --label 'wud.trigger.mock.example.auto=false' \
        ghcr.io/stefanprodan/podinfo:5.0.0
    $DOCKER_CMD run -d --name ghcr_podinfo_latest --label 'wud.watch=true' --label 'wud.watch.digest=true' --label 'wud.tag.include=^latest$' --label 'wud.display.icon=https://img.icons8.com/?size=100&id=118497&format=png&color=000000' ghcr.io/stefanprodan/podinfo:latest

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

    # BATCH (dedicated, name-findable local containers for the batch trigger e2e)
    echo "Pulling batch test images ..."
    $DOCKER_CMD run -d --name zz_batch_local_1 --label 'wud.watch=true' --label 'wud.tag.include=^6\.0\.0$' ghcr.io/stefanprodan/podinfo:5.0.0
    $DOCKER_CMD run -d --name zz_batch_local_2 --label 'wud.watch=true' --label 'wud.tag.include=^6\.0\.0$' ghcr.io/stefanprodan/podinfo:5.0.0

    # MULTI-VERSION (per-kind update buckets)
    # No pull needed: podinfo:6.0.0 is already pulled above.
    echo "Starting multi-version test containers ..."
    $DOCKER_CMD run -d --name zz_mv_buckets \
        --label 'wud.watch=true' \
        --label 'wud.tag.include=^6\.\d+\.\d+$' \
        ghcr.io/stefanprodan/podinfo:6.0.0
    $DOCKER_CMD run -d --name zz_mv_semver_digest \
        --label 'wud.watch=true' \
        --label 'wud.watch.digest.semver=true' \
        --label 'wud.tag.include=^999\.\d+\.\d+$' \
        ghcr.io/stefanprodan/podinfo:6.0.0

    # DIGEST-ONLY THRESHOLD: digest threshold must not suppress major/minor/patch reporting
    $DOCKER_CMD run -d --name zz_digest_threshold \
        --label 'wud.watch=true' \
        --label 'wud.tag.include=^6\.\d+\.\d+$' \
        --label 'wud.trigger.include=docker.update:digest' \
        ghcr.io/stefanprodan/podinfo:6.0.0

    # BUCKET-TARGETED TRIGGER (issue #18): patch + minor populated, major exactly null
    echo "Starting bucket trigger test containers ..."
    $DOCKER_CMD run -d --name zz_bucket_batch_1 --label 'wud.watch=true' --label 'wud.tag.include=^6\.\d+\.\d+$' ghcr.io/stefanprodan/podinfo:6.0.0
    $DOCKER_CMD run -d --name zz_bucket_batch_2 --label 'wud.watch=true' --label 'wud.tag.include=^6\.\d+\.\d+$' ghcr.io/stefanprodan/podinfo:6.0.0
    $DOCKER_CMD run -d --name zz_bucket_single --label 'wud.watch=true' --label 'wud.tag.include=^6\.\d+\.\d+$' ghcr.io/stefanprodan/podinfo:6.0.0

    # UNRESOLVABLE COMPOSE FILE (issue #23)
    echo "Starting unresolvable compose test container ..."
    $DOCKER_CMD run -d --name zz_compose_unresolvable \
        --label 'wud.watch=true' \
        --label 'wud.tag.include=^6\.\d+\.\d+$' \
        --label 'wud.compose.file=/compose/does-not-exist.yml' \
        ghcr.io/stefanprodan/podinfo:6.0.0

    # MIRROR-PREFIXED COMPOSE PIN (issue #25)
    # The compose file also holds an exact upstream pin, so com.docker.compose.service is
    # load-bearing: without it resolution would pick the bystander.
    echo "Starting mirror-prefixed compose test container ..."
    $DOCKER_CMD run -d --name zz_mirror_app \
        --label 'wud.watch=true' \
        --label 'wud.tag.include=^6\.0\.0$' \
        --label 'wud.compose.file=/compose/mirror.yml' \
        --label 'com.docker.compose.service=zz_mirror_app' \
        ghcr.io/stefanprodan/podinfo:5.0.0

    # POST-UPDATE DEPENDENT RESTART (issue #19)
    echo "Starting post-update restart test containers ..."
    $DOCKER_CMD run -d --name zz_postupdate_main \
        --label 'wud.watch=true' \
        --label 'wud.tag.include=^6\..*$' \
        --label 'wud.postupdate.restart=zz_postupdate_sidecar,zz_postupdate_ghost' \
        ghcr.io/stefanprodan/podinfo:5.0.0
    # Sidecar shares main's netns: override ports or both podinfos collide on 9898/9999
    $DOCKER_CMD run -d --name zz_postupdate_sidecar \
        --network container:zz_postupdate_main \
        --label 'wud.watch=true' \
        --label 'wud.tag.include=^5\.0\.0$' \
        ghcr.io/stefanprodan/podinfo:5.0.0 ./podinfo --port=9899 --grpc-port=9998
    $DOCKER_CMD run -d --name zz_postupdate_batch_a \
        --label 'wud.watch=true' \
        --label 'wud.tag.include=^6\.0\.0$' \
        --label 'wud.postupdate.restart=zz_postupdate_batch_b,zz_postupdate_sidecar' \
        ghcr.io/stefanprodan/podinfo:5.0.0
    $DOCKER_CMD run -d --name zz_postupdate_batch_b \
        --label 'wud.watch=true' \
        --label 'wud.tag.include=^6\.0\.0$' \
        ghcr.io/stefanprodan/podinfo:5.0.0

    # ATOMIC SWAP (issue #39): the victim's --volumes-from donor is removed straight after, so
    # recreating the victim fails at create and the swap must roll it back.
    echo "Starting atomic swap test containers ..."
    $DOCKER_CMD run -d --name zz_atomic_donor -v /data ghcr.io/stefanprodan/podinfo:5.0.0
    $DOCKER_CMD run -d --name zz_atomic_victim \
        --volumes-from zz_atomic_donor \
        --label 'wud.watch=true' \
        --label 'wud.tag.include=^6\.0\.0$' \
        ghcr.io/stefanprodan/podinfo:5.0.0
    $DOCKER_CMD rm -f zz_atomic_donor

    echo "✅ Test containers started (25 containers)"
    $DOCKER_CMD ps --format "table {{.Names}}	{{.Image}}	{{.Status}}" | grep -E "(ecr_|ghcr_|gitlab_|hub_|lscr_|quay_|trueforge_|zz_atomic_|zz_batch_|zz_bucket_|zz_compose_|zz_mirror_|zz_mv_|zz_postupdate_)"
fi

