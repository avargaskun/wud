# Agent Mode Architecture

## Overview

WUD Agent Mode allows a central "Controller" instance to monitor and manage containers running on remote "Agent" instances. This is useful for monitoring containers on remote servers without exposing their Docker sockets directly to the network.

## Architecture

*   **Controller:** The central WUD instance. It runs the WebUI, performs version checks against registries, and triggers notifications. It connects to Agents via WebSocket (Socket.IO).
*   **Agent:** A lightweight WUD instance running on a remote server. It monitors local containers using its local Docker socket and pushes updates to the Controller. It does **not** perform version checks or run the WebUI.

### Communication Protocol

*   **Transport:** WebSocket (Socket.IO) over HTTP/HTTPS.
*   **Authentication:** Shared Secret (passed in `X-WUD-SECRET` header).
*   **Direction:** Controller initiates connection to Agent.
*   **Data Flow:**
    *   **Sync:** On connection, Agent sends full list of containers.
    *   **Update:** When Agent detects a container change (e.g., status change), it pushes the container payload to the Controller.
    *   **Control:** Controller can send commands to Agent (e.g., trigger update - *future*).

## Configuration

### Agent

The Agent is configured to run in "Agent Mode" and listen for connections.

```bash
WUD_AGENT_ENABLED=true
WUD_AGENT_SECRET=mysecret
WUD_SERVER_PORT=3001
```

It must have at least one watcher configured (usually `docker`):

```bash
WUD_WATCHER_DOCKER_SOCKET=/var/run/docker.sock
```

### Controller

The Controller is configured with endpoints for each Agent it should manage.

```bash
WUD_AGENT_MYREMOTE_HOST=192.168.1.50
WUD_AGENT_MYREMOTE_PORT=3001
WUD_AGENT_MYREMOTE_SECRET=mysecret
```

## Internal Flow

1.  **Agent Startup:**
    *   `app/agent/server.js` initializes a Socket.IO server attached to the HTTP server.
    *   It registers an event listener on `wud:container-report`.

2.  **Controller Startup:**
    *   `app/controller/manager.js` reads `WUD_AGENT_*` config.
    *   It initializes `AgentClient` instances for each configured agent.
    *   `AgentClient` connects to Agent URL.

3.  **Syncing:**
    *   On connect, Agent emits `sync` event with all containers from its store.
    *   Controller receives containers, tags them with `agent` name, and saves them to its local store.
    *   Controller performs version checks (using `ImageVersionService`) because the Agent does not check registries.

4.  **Updates:**
    *   Agent watcher (cron) detects container state.
    *   Agent emits `container-update`.
    *   Controller receives update, updates store, and re-checks version if needed.
