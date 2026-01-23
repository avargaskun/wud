#!/bin/bash

set -e

export DOCKER_BUILDKIT=0

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

echo "🚀 Starting WUD in AGENT MODE for local e2e tests..."

# Create network if not exists
docker network create wud-e2e-net 2>/dev/null || true

# Build ui
echo "🏗️ Building UI..."
(cd "$SCRIPT_DIR/../ui" && npm install && npm run build)

# Build wud docker image
docker build -t wud --build-arg WUD_VERSION=local "$SCRIPT_DIR/.."

# Cleanup potential previous run leftovers (just in case)
docker rm -f wud-agent wud-controller 2>/dev/null || true

echo "🤖 Starting WUD Agent..."
# Run wud agent
docker run -d \
  --name wud-agent \
  --network wud-e2e-net \
  --publish 3001:3000 \
  --volume /var/run/docker.sock:/var/run/docker.sock \
  --env WUD_LOG_LEVEL=debug \
  --env WUD_SERVER_PORT=3000 \
  --env WUD_AGENT_SECRET=testsecret \
  --env WUD_WATCHER_LOCAL_WATCHBYDEFAULT=true \
  --env WUD_REGISTRY_ECR_PRIVATE_ACCESSKEYID="${AWS_ACCESSKEY_ID:-dummy}" \
  --env WUD_REGISTRY_ECR_PRIVATE_SECRETACCESSKEY="${AWS_SECRET_ACCESSKEY:-dummy}" \
  --env WUD_REGISTRY_ECR_PRIVATE_REGION=eu-west-1 \
  --env WUD_REGISTRY_GHCR_PRIVATE_USERNAME="${GITHUB_USERNAME:-dummy}" \
  --env WUD_REGISTRY_GHCR_PRIVATE_TOKEN="${GITHUB_TOKEN:-dummy}" \
  --env WUD_REGISTRY_GITLAB_PRIVATE_TOKEN="${GITLAB_TOKEN:-dummy}" \
  --env WUD_REGISTRY_LSCR_PRIVATE_USERNAME="${GITHUB_USERNAME:-dummy}" \
  --env WUD_REGISTRY_LSCR_PRIVATE_TOKEN="${GITHUB_TOKEN:-dummy}" \
  --env WUD_REGISTRY_ACR_PRIVATE_CLIENTID="${ACR_CLIENT_ID:-89dcf54b-ef99-4dc1-bebb-8e0eacafdac8}" \
  --env WUD_REGISTRY_ACR_PRIVATE_CLIENTSECRET="${ACR_CLIENT_SECRET:-dummy}" \
  --env WUD_REGISTRY_TRUEFORGE_PRIVATE_USERNAME="${TRUEFORGE_USERNAME:-dummy}" \
  --env WUD_REGISTRY_TRUEFORGE_PRIVATE_TOKEN="${TRUEFORGE_TOKEN:-dummy}" \
  --env WUD_REGISTRY_GCR_PRIVATE_CLIENTEMAIL="gcr@wud-test.iam.gserviceaccount.com" \
  --env WUD_REGISTRY_GCR_PRIVATE_PRIVATEKEY="-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDZ
-----END PRIVATE KEY=-" \
  --env WUD_TRIGGER_DOCKER_UPDATE_PRUNE=false \
  --env WUD_TRIGGER_DOCKER_UPDATE_AUTO=false \
  wud --agent

echo "🎮 Starting WUD Controller..."
# Run wud controller
docker run -d \
  --name wud-controller \
  --network wud-e2e-net \
  --publish 3000:3000 \
  --env WUD_LOG_LEVEL=debug \
  --env WUD_WATCHER_DOCKER_LOCAL_ENABLE=false \
  --env WUD_AGENT_REMOTE_HOST=wud-agent \
  --env WUD_AGENT_REMOTE_SECRET=testsecret \
  --env WUD_AUTH_BASIC_JOHN_USER="john" \
  --env WUD_AUTH_BASIC_JOHN_HASH='$apr1$8zDVtSAY$62WBh9DspNbUKMZXYRsjS/' \
  wud

echo "✅ WUD Agent started on http://localhost:3001"
echo "✅ WUD Controller started on http://localhost:3000"
echo "⏳ Waiting 20 seconds for WUD to sync..."
sleep 20
echo "🎯 Ready for e2e tests!"
