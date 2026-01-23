#!/bin/bash

set -e

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

echo "🧪 Running AGENT MODE e2e test suite..."

# Cleanup any existing containers
"$SCRIPT_DIR/cleanup-test-containers.sh"

# Setup test containers
"$SCRIPT_DIR/setup-test-containers.sh"

# Start WUD in Agent Mode
"$SCRIPT_DIR/start-wud-agent-mode.sh"

# Run e2e tests
echo "🏃 Running cucumber tests (Agent Mode)..."
(cd "$SCRIPT_DIR/../e2e" && npx cucumber-js **/*.feature --tags @agent)

echo "✅ E2E Agent tests completed!"
