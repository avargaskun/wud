# Agent Mode

Agent Mode allows you to monitor containers across multiple servers from a single WUD dashboard ("Controller").

## Concept

Instead of running a full standalone WUD instance on every server, you run lightweight "Agents" on your remote nodes. These Agents monitor their local Docker containers and push information to a central "Controller".

The **Controller** is responsible for:
*   Checking container image versions against Registries (Docker Hub, etc.).
*   Running the WebUI dashboard.
*   Executing Triggers (Notifications).

The **Agent** is responsible for:
*   Monitoring the local Docker socket.
*   Pushing container state to the Controller.

## Configuration

### 1. Configure the Agent

On your remote server (e.g., `10.0.0.2`), start WUD in Agent Mode.

**Docker Compose:**

```yaml
services:
  wud-agent:
    image: fmartinou/whats-up-docker
    environment:
      - WUD_AGENT_ENABLED=true
      - WUD_AGENT_SECRET=supersecretpassword
      - WUD_SERVER_PORT=3001
      # Configure the local watcher
      - WUD_WATCHER_DOCKER_SOCKET=/var/run/docker.sock
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    ports:
      - "3001:3001"
```

### 2. Configure the Controller

On your main server (Controller), configure WUD to connect to the Agent.

**Docker Compose:**

```yaml
services:
  wud-controller:
    image: fmartinou/whats-up-docker
    environment:
      # Standard WUD configuration...

      # Define the Agent connection
      # Format: WUD_AGENT_{NAME}_{PROP}
      - WUD_AGENT_REMOTE1_HOST=10.0.0.2
      - WUD_AGENT_REMOTE1_PORT=3001
      - WUD_AGENT_REMOTE1_SECRET=supersecretpassword
    ports:
      - "3000:3000"
```

### 3. Verify

1.  Open the WUD WebUI on the Controller (http://localhost:3000).
2.  Navigate to the **Agents** tab. You should see `remote1` connected.
3.  Navigate to **Containers**. You will see containers from the remote agent listed (e.g., `my-container (remote1)`).

## Security

Communication between Controller and Agent uses a Shared Secret (`WUD_AGENT_SECRET`). Ensure this secret is strong and kept secure.

You can also configure TLS/SSL for the Agent server if exposing it over a public network, using standard WUD server TLS options (`WUD_SERVER_TLS_KEY`, etc.) on the Agent, and providing CA files on the Controller if needed.
