# Agent Mode Design

## Architecture

The Agent Mode allows running WUD in a distributed manner.
- **Agent Node**: Runs near the Docker socket (or other container sources). It is responsible for **discovery** only. It does NOT check for updates against registries. It does NOT persist state to disk.
- **Controller Node**: The central instance. It manages its own local watchers AND connects to remote Agents. It receives container reports from Agents, performs **update checks** (Registry queries), and handles persistence, UI, and Notifications.

```mermaid
graph TD
    subgraph Agent Node
        A[Agent Watcher (Docker)] -->|Discovery| B(In-Memory Store)
        B -->|SSE Push| C[Agent API]
    end
    subgraph Controller Node
        D[Agent Client Manager] -->|Connect & Listen| C
        D -->|Update Local Store| E(Main Store)
        F[Local Watcher] -->|Discovery| E
        E -->|Check Updates| G[Registry Service]
        E --> H[Web UI]
        E --> I[Triggers]
    end
```

## Configuration

### Agent Configuration
Run with `--agent` flag.

**Environment Variables:**
- `WUD_AGENT_SECRET`: Secret token for authentication (Required).
- `WUD_AGENT_SECRET_FILE`: Path to secret token file.
- `WUD_SERVER_PORT`: Port to listen on (default 3000).
- `WUD_SERVER_TLS_*`: TLS configuration (same as current).
- `WUD_WATCHER_{name}_*`: Watcher configuration (must have at least one).
- `WUD_LOG_LEVEL`: Log level.

*Registries, Triggers, and Authentication (for UI) are ignored in Agent mode.*

### Controller Configuration
Configured via `WUD_AGENT_{name}_*` variables.

- `WUD_AGENT_{name}_SECRET`: Secret to connect to Agent (Required).
- `WUD_AGENT_{name}_SECRET_FILE`: File path for secret.
- `WUD_AGENT_{name}_HOST`: Hostname/IP of the Agent.
- `WUD_AGENT_{name}_PORT`: Port of the Agent (default 3000).
- `WUD_AGENT_{name}_CAFILE`, `CERTFILE`, `KEYFILE`: TLS certs for client connection.

## Communication Protocol

The Controller acts as the client, establishing connection to the Agent.

### Authentication
All requests from Controller to Agent must include:
`X-Wud-Agent-Secret: <SECRET>`

### 1. Handshake (Snapshot)
**Request:** `GET /api/containers`
**Response:** JSON array of current containers discovered by the Agent.
**Purpose:** Initial state synchronization. Triggered by Controller upon receiving `wud:ack` via SSE.

### 2. Real-time Updates (SSE)
**Request:** `GET /api/events`
**Headers:** `Accept: text/event-stream`
**Protocol:**
SSE events are sent as a single JSON blob containing both type and data.
Format: `data: { "type": "...", "data": ... }`
**Event Types:**
- `wud:ack`: Sent immediately on connection. Payload `{ version: string }`.
- `wud:container-added`: Payload `Container` object.
- `wud:container-updated`: Payload `Container` object.
- `wud:container-removed`: Payload `{ id: string }`.

### 3. Remote Triggers
**Request:** `POST /api/containers/:id/triggers/:type/:name`
**Purpose:** Controller instructs Agent to execute a trigger (e.g. Docker Compose update) locally on the Agent.

## Data Model Changes

### Container
Add field:
```typescript
agent?: string; // Name of the agent. Undefined/Null if local.
```

### Watcher
Add field:
```typescript
agent?: string; // Name of the agent. Undefined/Null if local.
```

## Component Changes

### 1. Store (`app/store`)
- **Agent Mode**: Must use an in-memory database (LokiJS without persistence/autosave).
- **Controller Mode**: Continues to use persistent file storage.

### 2. Watchers (`app/watchers/providers/docker/Docker.ts`)
- Refactor `watch()` method.
- Introduce `discoveryOnly` mode.
- If `discoveryOnly` is true:
    - `getContainers()` is called.
    - `findNewVersion()` (Registry check) is SKIPPED.
    - `result` object in Container is left empty or minimal.

### 3. Agent Server (`app/agent/AgentServer.ts`)
- New component.
- Starts Express app with specific Agent endpoints.
- Uses `app/event` to subscribe to local watcher events and push them to SSE clients.

### 4. Agent Client (`app/agent/AgentClient.ts`)
- New component on Controller.
- Manages connection to one specific Agent.
- Performs Handshake.
- Maintains SSE connection (robust reconnect logic with error handling).
- On event, normalizes container data (adds `agent` field) and updates the **Main Store**.
- **Crucial**: When receiving a container from Agent, the Controller must trigger an "Update Check" (Registry lookup) because the Agent didn't do it.
- The Controller must also call `normalizeContainer` on incoming containers to resolve the Registry provider (since the Agent doesn't know about registries).

### 5. Registry Logic
- The Controller needs a way to "hydrate" a container with registry info when it comes from an Agent.
- Current logic is tied to `Watcher.watch()`. We might need a `Registry.checkUpdate(container)` function that can be called independently.

## Frontend Changes
- **Configuration**: Add "Agents" section.
- **Containers**:
    - Filter by Agent.
    - Show "Agent: {name}" in details.
- **Watchers**: Show which Agent a watcher belongs to.

## Security
- Agent endpoints protected by Secret.
- HTTPS supported.