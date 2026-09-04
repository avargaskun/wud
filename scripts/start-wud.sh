#!/bin/bash

set -e

export DOCKER_BUILDKIT=0
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

echo "🚀 Starting WUD in MIXED MODE (Controller + Agent + Dind) for e2e tests..."

# 1. Network
docker network create wud-e2e-net 2>/dev/null || true

# 2. Dind
echo "🐳 Starting Dind..."
# We map internal 2375 to host 2376 so we can provision it from the host
docker run -d --privileged --name wud-dind --network wud-e2e-net -e DOCKER_TLS_CERTDIR="" -p 2376:2375 docker:dind

# 3. Wait for Dind
echo "⏳ Waiting for Dind..."
for i in {1..30}; do
  if docker -H tcp://localhost:2376 info > /dev/null 2>&1; then
    echo "✅ Dind is up!"
    break
  fi
  sleep 2
done

# 4. Setup Host (Local)
# unset DOCKER_HOST just in case
unset DOCKER_HOST
"$SCRIPT_DIR/setup-test-containers.sh" full

# 5. Setup Remote (Dind)
# We use the mapped port 2376 on localhost
export TARGET_DOCKER_HOST=tcp://localhost:2376
"$SCRIPT_DIR/setup-test-containers.sh" minimal
unset TARGET_DOCKER_HOST

# 5b. Compose stack for the dockercompose batch e2e. Run against a disposable copy — the
# trigger rewrites the compose file in place, so this keeps the committed fixture pristine.
echo "📦 Starting compose stack..."
cp "$SCRIPT_DIR/../test/compose-stack/docker-compose.yml" "$SCRIPT_DIR/../test/compose-stack/docker-compose.active.yml"
docker compose -f "$SCRIPT_DIR/../test/compose-stack/docker-compose.active.yml" up -d

# Mirror-prefixed pin fixture: never composed up (mirror.local is not pullable), only mounted
# so the trigger can rewrite it for the zz_mirror_app container started by docker run.
cp "$SCRIPT_DIR/../test/compose-stack/docker-compose.mirror.yml" "$SCRIPT_DIR/../test/compose-stack/docker-compose.mirror.active.yml"

docker build -t wud --build-arg WUD_VERSION=local "$SCRIPT_DIR/.."

# 6. Start Agent
echo "🤖 Starting WUD Agent..."
docker run -d \
  --name wud-agent \
  --network wud-e2e-net \
  --publish 3001:3000 \
  --env DOCKER_HOST=tcp://wud-dind:2375 \
  --env WUD_LOG_LEVEL=debug \
  --env WUD_AGENT_SECRET=testsecret \
  --env WUD_WATCHER_LOCAL_WATCHBYDEFAULT=true \
  --env WUD_TRIGGER_DOCKER_UPDATE_PRUNE=false \
  --env WUD_TRIGGER_DOCKER_UPDATE_AUTO=false \
  wud --agent

# 7. Start Controller
echo "🎮 Starting WUD Controller..."
docker run -d \
  --name wud-controller \
  --network wud-e2e-net \
  --publish 3000:3000 \
  --volume /var/run/docker.sock:/var/run/docker.sock \
  --volume "$SCRIPT_DIR/../test/compose-stack/docker-compose.active.yml:/compose/docker-compose.yml" \
  --volume "$SCRIPT_DIR/../test/compose-stack/docker-compose.mirror.active.yml:/compose/mirror.yml" \
  --env WUD_LOG_LEVEL=debug \
  --env WUD_WATCHER_DOCKER_LOCAL_ENABLE=true \
  --env WUD_WATCHER_LOCAL_WATCHBYDEFAULT=false \
  --env WUD_AGENT_REMOTE_HOST=wud-agent \
  --env WUD_AGENT_REMOTE_SECRET=testsecret \
  --env WUD_TRIGGER_DOCKER_UPDATE_AUTO=false \
  --env WUD_TRIGGER_DOCKERCOMPOSE_UPDATE_AUTO=false \
  --env WUD_TRIGGER_MOCK_EXAMPLE_MOCK=mock \
  --env WUD_REGISTRY_ECR_PRIVATE_ACCESSKEYID="${AWS_ACCESSKEY_ID:-dummy}" \
  --env WUD_REGISTRY_ECR_PRIVATE_SECRETACCESSKEY="${AWS_SECRET_ACCESSKEY:-dummy}" \
  --env WUD_REGISTRY_ECR_PRIVATE_REGION=${AWS_REGION:-eu-west-1} \
  --env WUD_REGISTRY_GITLAB_PRIVATE_TOKEN="${GITLAB_TOKEN:-dummy}" \
  --env WUD_REGISTRY_LSCR_PRIVATE_USERNAME="${GITHUB_USERNAME:-dummy}" \
  --env WUD_REGISTRY_LSCR_PRIVATE_TOKEN="${GITHUB_TOKEN:-dummy}" \
  --env WUD_REGISTRY_ACR_PRIVATE_CLIENTID="${ACR_CLIENT_ID:-89dcf54b-ef99-4dc1-bebb-8e0eacafdac8}" \
  --env WUD_REGISTRY_ACR_PRIVATE_CLIENTSECRET="${ACR_CLIENT_SECRET:-dummy}" \
  --env WUD_REGISTRY_TRUEFORGE_PRIVATE_USERNAME="${TRUEFORGE_USERNAME:-dummy}" \
  --env WUD_REGISTRY_TRUEFORGE_PRIVATE_TOKEN="${TRUEFORGE_TOKEN:-dummy}" \
  --env WUD_REGISTRY_GCR_PRIVATE_CLIENTEMAIL="${GCR_CLIENT_EMAIL:-gcr@wud-test.iam.gserviceaccount.com}" \
  --env WUD_REGISTRY_GCR_PRIVATE_PRIVATEKEY="${GCR_PRIVATE_KEY:------BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDZ\n-----END PRIVATE KEY-----}" \
  --env WUD_AUTH_BASIC_JOHN_USER="john" \
  --env WUD_AUTH_BASIC_JOHN_HASH='$apr1$8zDVtSAY$62WBh9DspNbUKMZXYRsjS/' \
  wud

echo "✅ WUD Agent started on http://localhost:3001"
echo "✅ WUD Controller started on http://localhost:3000"
echo "⏳ Waiting 20 seconds for WUD to sync..."
sleep 20
echo "🎯 Ready for e2e tests!"

