#!/bin/bash

set -e

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

# Set CI=true to enable retries and parallel worker limits in Playwright
# export CI=true

echo "🧪 Running UI integration tests..."

# Cleanup any existing containers
"$SCRIPT_DIR/cleanup-test-containers.sh"

# Start WUD (Mixed E2E Mode) - This handles setup of containers (Host + Dind)
"$SCRIPT_DIR/start-wud.sh"

# Wait for WUD to be responsive
echo "⏳ Waiting for WUD to be responsive..."
for i in {1..30}; do
  if curl -s http://localhost:3000 > /dev/null; then
    echo "✅ WUD is up!"
    break
  fi
  echo "zzz..."
  sleep 2
done

# Install dependencies for UI tests
echo "📦 Installing UI test dependencies..."
(cd "$SCRIPT_DIR/../ui-e2e" && npm install)

# Install Playwright browsers
echo "🌐 Installing Playwright browsers..."
(cd "$SCRIPT_DIR/../ui-e2e" && npx playwright install)

# Run Playwright tests
echo "🏃 Running Playwright tests..."
(cd "$SCRIPT_DIR/../ui-e2e" && npm test)

echo "✅ UI integration tests completed!"

# Cleanup (Optional - comment out if you want to inspect after success)
# "$SCRIPT_DIR/cleanup-test-containers.sh"