# Agent API

The Agent exposes specific endpoints for the Controller to synchronize state and receive events. These are generally internal APIs used by the Controller but are documented here for reference or advanced debugging.

Authentication is required for all endpoints via the `X-Wud-Agent-Secret` header.

## Get State
Returns a snapshot of the Agent's current state (containers, watchers, triggers).

```bash
# Get Containers
curl -H "X-Wud-Agent-Secret: <SECRET>" http://agent:3000/api/containers

# Get Watchers
curl -H "X-Wud-Agent-Secret: <SECRET>" http://agent:3000/api/watchers

# Get Triggers
curl -H "X-Wud-Agent-Secret: <SECRET>" http://agent:3000/api/triggers
```

## Watch Resources
Trigger a manual watch on a specific watcher or container hosted by the Agent.

```bash
# Watch a specific watcher (discovery)
curl -X POST \
  -H "X-Wud-Agent-Secret: <SECRET>" \
  http://agent:3000/api/watchers/:type/:name

# Watch a specific container (discovery)
curl -X POST \
  -H "X-Wud-Agent-Secret: <SECRET>" \
  http://agent:3000/api/watchers/:type/:name/container/:id
```

## Delete a Container
Delete a container from the Agent's state.
> **Note**: This operation requires `WUD_SERVER_FEATURE_DELETE` to be enabled on the Agent.

```bash
curl -X DELETE \
  -H "X-Wud-Agent-Secret: <SECRET>" \
  http://agent:3000/api/containers/:id
```

## Real-time Events (SSE)
Subscribes to real-time updates from the Agent using Server-Sent Events (SSE).

The Agent pushes events when containers are added, updated, or removed.

### Endpoint
```bash
curl -N -H "X-Wud-Agent-Secret: <SECRET>" -H "Accept: text/event-stream" http://agent:3000/api/events
```

### Protocol
Events are sent as JSON objects with the following structure:
```json
data: {
  "type": "event_type",
  "data": { ...payload... }
}
```

### Supported Events

#### `wud:ack`
Sent immediately upon connection to confirm the handshake.
```json
{
  "type": "wud:ack",
  "data": {
    "version": "1.0.0"
  }
}
```

#### `wud:container-added`
Sent when a new container is discovered.
```json
{
  "type": "wud:container-added",
  "data": { ...container_object... }
}
```

#### `wud:container-updated`
Sent when an existing container is updated (e.g. status change, new image tag).
```json
{
  "type": "wud:container-updated",
  "data": { ...container_object... }
}
```

#### `wud:container-removed`
Sent when a container is removed (e.g. stopped and pruned).
```json
{
  "type": "wud:container-removed",
  "data": {
    "id": "container_id"
  }
}
```

## Execute Remote Trigger
Executes a specific trigger on the Agent (e.g., to update a container).

```bash
# Single container
curl -X POST \
  -H "X-Wud-Agent-Secret: <SECRET>" \
  -H "Content-Type: application/json" \
  -d '{ ...container_json... }' \
  http://agent:3000/api/triggers/:type/:name

# Batch (multiple containers, updated in lockstep)
curl -X POST \
  -H "X-Wud-Agent-Secret: <SECRET>" \
  -H "Content-Type: application/json" \
  -d '[ { ...container_json... }, { ...container_json... } ]' \
  http://agent:3000/api/triggers/:type/:name/batch
```

The batch endpoint takes an **array** of container views as its body (a non-array body is rejected with `400`); an unknown trigger returns `404`.

> **Note**: The bodies are container **views**, not raw containers: the Controller resolves the [`bucket`](/api/container/?id=run-a-trigger-on-the-container) selection before forwarding, so each view already carries the update the trigger must apply. The Agent runs them as-is and performs no bucket selection of its own.

### Response

Both endpoints respond `200` with the trigger run result whenever the local trigger resolved, and `500 { "error": ... }` when it threw. The single-container endpoint additionally answers `400` when the trigger cannot act on that container at all (body: `error`, `containers`, `details[]`) and `409` when the container no longer exists in Docker (body: `error`, `containers`), with the same bodies as the Container API.

```json
{
  "members": [
    { "id": "<id>", "name": "immich", "status": "updated" }
  ],
  "dependents": [
    { "name": "qbittorrent", "host": "gluetun", "status": "bounced", "method": "recreate" }
  ]
}
```

`members` carries one entry per container the update trigger acted on — a single entry for the single-container endpoint — and `dependents` is present only when a container carries the [`wud.postupdate.restart`](/configuration/watchers/?id=restart-dependent-containers-after-an-update) label; the body is `{}` when the trigger reports neither. See the [Container API](/api/container/?id=response) for the field semantics.

> **Note**: A batch where some members failed still responds `200` here — the partial-failure status policy (`500` with the same body) is applied by the Controller, not the Agent.