# Agent Mode

WUD supports a distributed deployment model called "Agent Mode".

## Architecture

- **Agent Node**: Runs near the Docker socket (or other container sources). It is responsible for **discovery** only. It does NOT check for updates against registries.
- **Controller Node**: The central instance. It manages its own local watchers AND connects to remote Agents. It receives container reports from Agents, performs **update checks** (Registry queries), and handles persistence, UI, and Notifications.

## Usage

### 1. Launching Agent

Start WUD with the `--agent` flag.

```bash
wud --agent
```

Or via Docker:

```bash
docker run -d \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -e WUD_SERVER_PORT=3000 \
  -e WUD_AGENT_SECRET=mysecret \
  -e WUD_WATCHER_LOCAL_SOCKET=/var/run/docker.sock \
  fmartinou/whats-up-docker --agent
```

**Required Configuration:**
- `WUD_AGENT_SECRET`: Shared secret for authentication.
- At least one Watcher configuration (e.g. `WUD_WATCHER_LOCAL_SOCKET`).

Registries and Triggers (except Docker/DockerCompose) are ignored in Agent mode.

### 2. Configuring Controller

On your main WUD instance (Controller), configure the connection to the Agent using environment variables.

Syntax: `WUD_AGENT_{NAME}_{PROP}`

Example:

```bash
WUD_AGENT_MAIN_HOST=http://192.168.1.50
WUD_AGENT_MAIN_PORT=3000
WUD_AGENT_MAIN_SECRET=mysecret
```

The Controller will connect to the Agent, retrieve containers, and perform update checks using its own configured Registries.

## Features supported

- **Remote Discovery**: Containers from Agents appear in the Controller UI.
- **Remote Triggers**: "Update" buttons for Docker/DockerCompose triggers will execute on the Agent node.
- **Unified UI**: Filter containers by Agent.

## Security

Communication between Controller and Agent is protected by:
- Shared Secret (`X-Wud-Agent-Secret` header).
- TLS (optional, configure `WUD_SERVER_TLS_*` on Agent and `WUD_AGENT_{NAME}_CERTFILE` on Controller).
