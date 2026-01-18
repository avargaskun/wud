# Agent Mode Architecture

## Overview

WUD supports a distributed architecture where "Agent" instances monitor containers on remote systems and report to a central "Controller".

- **Controller**: The central WUD instance hosting the WebUI, managing Triggers (notifications), and performing Version Checks against Registries.
- **Agent**: A lightweight WUD instance running on a remote system. It monitors the local Docker socket (Discovery) and pushes container state to the Controller. It does **not** check registries. It can execute local triggers (e.g. updating docker-compose files) when instructed by the Controller.

## Architecture

### System Diagram

```mermaid
graph TD
    User[User / Browser] -- HTTP/HTTPS --> Controller

    subgraph Controller System
        Controller[WUD Controller]
        DB[(Store)]
        Reg[Registries]
        Trig[Triggers]
    end

    subgraph Remote System 1
        Agent1[WUD Agent 1]
        Docker1[Docker Socket]
    end

    subgraph Remote System 2
        Agent2[WUD Agent 2]
        Docker2[Docker Socket]
    end

    Controller -- SSE / API (Auth: Secret) --> Agent1
    Controller -- SSE / API (Auth: Secret) --> Agent2

    Agent1 -- Monitor --> Docker1
    Agent2 -- Monitor --> Docker2

    Controller -- Check Version --> Reg
    Controller -- Notify --> Trig
```

### Components

#### Agent
- **Mode**: Started with `--agent` flag.
- **Store**: Ephemeral (In-Memory), no persistence. Used for diffing state.
- **Watcher**: Runs in "Discovery Only" mode. Gets container info + image tags, but skips registry version checks.
- **Server**: Exposes API for Snapshot (`GET /api/containers`) and SSE (`GET /api/events`). Protected by `WUD_AGENT_SECRET`.
- **Triggers**: Can run local triggers (e.g. `DockerCompose`) when invoked by Controller via API.

#### Controller
- **Mode**: Default mode.
- **Agent Client**: Manages connections to Agents.
  - Handshake: Fetches full snapshot on connect.
  - Listen: Updates local store on SSE events from Agent.
- **Registry**: Performs version checks for both local and remote containers.
- **Store**: Stores all containers. Remote containers are marked with `agent` attribute.

### Sequence Diagram: Container Update

```mermaid
sequenceDiagram
    participant Docker as Docker (Remote)
    participant Agent as WUD Agent
    participant Controller as WUD Controller
    participant Registry as External Registry
    participant Trigger as Notification Trigger

    Docker->>Agent: Container Started / Event
    Agent->>Agent: Update Ephemeral Store
    Agent->>Controller: SSE: Container Updated (Image Info)
    Controller->>Controller: Update Store (Mark as Remote)

    loop Watch Interval (Controller)
        Controller->>Registry: Check Image Version
        Registry-->>Controller: New Version Available
        Controller->>Controller: Update Store (UpdateAvailable)
        Controller->>Trigger: Execute Trigger (e.g. Slack)
    end
```

### Configuration

#### Agent Configuration
- `WUD_AGENT_SECRET`: Shared secret.
- `WUD_WATCHER_{name}_*`: Watcher config (e.g. Docker socket).

#### Controller Configuration
- `WUD_AGENT_{name}_SECRET`: Secret to connect to Agent.
- `WUD_AGENT_{name}_HOST`: Hostname of Agent.
- `WUD_AGENT_{name}_PORT`: Port of Agent.
