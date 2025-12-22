#!/bin/bash
set -e

# Kill any existing processes
pkill -f "node app/index.js" || true

# Start Agent
export WUD_AGENT_ENABLED=true
export WUD_AGENT_SECRET=supersecret
export WUD_SERVER_PORT=3001
export WUD_LOG_LEVEL=debug
# Use Mock watcher to avoid Docker socket issues
export WUD_WATCHER_AGENT_TYPE=mock
export WUD_WATCHER_AGENT_CRON="*/10 * * * * *"

echo "Starting Agent..."
node app/index.js > agent.log 2>&1 &
AGENT_PID=$!

# Start Controller
export WUD_AGENT_ENABLED=false
export WUD_SERVER_PORT=3000
export WUD_LOG_LEVEL=debug
export WUD_AGENT_MYAGENT_HOST=localhost
export WUD_AGENT_MYAGENT_PORT=3001
export WUD_AGENT_MYAGENT_SECRET=supersecret
unset WUD_WATCHER_AGENT_TYPE

echo "Starting Controller..."
node app/index.js > controller.log 2>&1 &
CONTROLLER_PID=$!

# Wait for startup
echo "Waiting for services to start..."
sleep 15

# Check if processes are still running
if ! kill -0 $AGENT_PID > /dev/null 2>&1; then
    echo "Agent failed to start. Check agent.log:"
    cat agent.log
    kill $CONTROLLER_PID || true
    exit 1
fi

if ! kill -0 $CONTROLLER_PID > /dev/null 2>&1; then
    echo "Controller failed to start. Check controller.log:"
    cat controller.log
    kill $AGENT_PID || true
    exit 1
fi

# Query Controller API to see if Agent is registered/healthy
echo "Querying Controller API for Agents..."
RESPONSE=$(curl -s http://localhost:3000/api/agents)
echo "Response: $RESPONSE"

if [[ $RESPONSE == *"myagent"* ]] && [[ $RESPONSE == *"connected"* ]]; then
    echo "SUCCESS: Agent 'myagent' found and connected in Controller API."
else
    echo "FAILURE: Agent 'myagent' not found or not connected."
    echo "Agent Log:"
    cat agent.log
    echo "Controller Log:"
    cat controller.log
    kill $AGENT_PID $CONTROLLER_PID
    exit 1
fi

# Cleanup
kill $AGENT_PID $CONTROLLER_PID
echo "Integration test passed."
