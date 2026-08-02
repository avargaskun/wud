# Container API

This API allows to query the state of the watched containers.

## Update related fields

Every container returned by this API exposes the outcome of the last watch cycle through
four related fields.

| Field             | Description                                                                               |
| ----------------- | ----------------------------------------------------------------------------------------- |
| `updateAvailable` | `true` when at least one update was found for the container                               |
| `result`          | The **highest** available update (`tag`, `digest`, `created`, `link`)                     |
| `updateKind`      | A description of that **same highest** update                                             |
| `updates`         | The detail of every available update, split by kind (`major`, `minor`, `patch`, `digest`) |

?> `result`, `updateAvailable` and `updateKind` continue to describe the **single highest** available update. They are unchanged and remain the fields to read when you only care about "is there something newer?".

### `updateKind`

```json
"updateKind": {
  "kind": "tag",
  "localValue": "1.2.3",
  "remoteValue": "2.0.0",
  "semverDiff": "major"
}
```

| Field         | Description                                                                                                    |
| ------------- | -------------------------------------------------------------------------------------------------------------- |
| `kind`        | `tag` when a newer tag was found, `digest` when the digest behind the current tag changed, `unknown` otherwise |
| `localValue`  | The currently running tag (or digest when `kind` is `digest`)                                                  |
| `remoteValue` | The tag (or digest) of the highest available update                                                            |
| `semverDiff`  | `major`, `minor`, `patch`, `prerelease` or `unknown`                                                           |

### `updates`

`updates` reports **every** available update, one entry per update kind, instead of only the
highest one. It is a map keyed by `major`, `minor`, `patch` and `digest`.

```json
"updates": {
  "major": {
    "kind": "tag",
    "localValue": "1.2.3",
    "remoteValue": "2.0.0",
    "semverDiff": "major",
    "link": "https://github.com/acme/app/releases/tag/2.0.0"
  },
  "minor": null,
  "patch": {
    "kind": "tag",
    "localValue": "1.2.3",
    "remoteValue": "1.2.4",
    "semverDiff": "patch",
    "link": "https://github.com/acme/app/releases/tag/1.2.4"
  }
}
```

Each key has **three** possible states, and the difference matters:

| State                   | Meaning                                                                                                                                                     |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Key **absent**          | The update kind is structurally impossible for this container (e.g. no `patch` for a container running `:8`; no `digest` unless digest watching is enabled) |
| Key present, **`null`** | The update kind applies to this container, but nothing newer is available                                                                                   |
| Key present, **object** | An update of that kind is available                                                                                                                         |

?> `updates` itself being absent means the container has not been watched yet since WUD was upgraded.

Each populated entry is an object with the following fields.

| Field         | Description                                                                                                                                                                                                 |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kind`        | `tag` for the `major` / `minor` / `patch` entries, `digest` for the `digest` entry                                                                                                                          |
| `localValue`  | The currently running tag (the currently running digest for the `digest` entry)                                                                                                                             |
| `remoteValue` | The tag to update to (the new digest for the `digest` entry)                                                                                                                                                |
| `semverDiff`  | `major`, `minor`, `patch` or `prerelease` (absent for the `digest` entry)                                                                                                                                   |
| `created`     | The creation date of the remote image (only populated for the `digest` entry)                                                                                                                               |
| `link`        | The `wud.link.template` rendered for the tag this entry would deploy — `remoteValue` for the tag entries, the **currently running** tag for the `digest` entry (absent when no link template is configured) |

!> A `prerelease` update is reported in the **`patch`** entry, with `semverDiff` set to `prerelease`.

?> The `digest` entry always compares the digest of the **currently running** tag; it never mixes with the tag entries. See the `wud.watch.digest.semver` label in the [Watchers](/configuration/watchers/) documentation.

## Get all containers

This operation lets you get all the watched cainers.

```bash
curl http://wud:3000/api/containers

[
   {
  "id":"31a61a8305ef1fc9a71fa4f20a68d7ec88b28e32303bbc4a5f192e851165b816",
  "name":"homeassistant",
  "watcher":"local",
  "includeTags":"^\\d+\\.\\d+.\\d+$",
  "image":{
    "id":"sha256:d4a6fafb7d4da37495e5c9be3242590be24a87d7edcc4f79761098889c54fca6",
    "registry":{
      "url":"123456789.dkr.ecr.eu-west-1.amazonaws.com"
    },
    "name":"test",
    "tag":{
      "value":"2021.6.4",
      "semver":true
    },
    "digest":{
      "watch":false,
      "repo":"sha256:ca0edc3fb0b4647963629bdfccbb3ccfa352184b45a9b4145832000c2878dd72"
    },
    "architecture":"amd64",
    "os":"linux",
    "created":"2021-06-12T05:33:38.440Z"
  },
  "result":{
    "tag":"2021.6.5"
  },
  "updateAvailable": true
}
]
```

## Watch all Containers

This operation triggers a manual watch on all containers.

```bash
curl -X POST http://wud:3000/api/containers/watch

[{
  "id":"31a61a8305ef1fc9a71fa4f20a68d7ec88b28e32303bbc4a5f192e851165b816",
  "name":"homeassistant",
  "watcher":"local",
  "includeTags":"^\\d+\\.\\d+.\\d+$",
  "image":{
    "id":"sha256:d4a6fafb7d4da37495e5c9be3242590be24a87d7edcc4f79761098889c54fca6",
    "registry":{
      "url":"123456789.dkr.ecr.eu-west-1.amazonaws.com"
    },
    "name":"test",
    "tag":{
      "value":"2021.6.4",
      "semver":true
    },
    "digest":{
      "watch":false,
      "repo":"sha256:ca0edc3fb0b4647963629bdfccbb3ccfa352184b45a9b4145832000c2878dd72"
    },
    "architecture":"amd64",
    "os":"linux",
    "created":"2021-06-12T05:33:38.440Z"
  },
  "result":{
    "tag":"2021.6.5"
  },
  "updateAvailable": true
}]
```

## Get a Container by id

This operation lets you get a container by id.

```bash
curl http://wud:3000/api/containers/31a61a8305ef1fc9a71fa4f20a68d7ec88b28e32303bbc4a5f192e851165b816

{
  "id":"31a61a8305ef1fc9a71fa4f20a68d7ec88b28e32303bbc4a5f192e851165b816",
  "name":"homeassistant",
  "watcher":"local",
  "includeTags":"^\\d+\\.\\d+.\\d+$",
  "image":{
    "id":"sha256:d4a6fafb7d4da37495e5c9be3242590be24a87d7edcc4f79761098889c54fca6",
    "registry":{
      "url":"123456789.dkr.ecr.eu-west-1.amazonaws.com"
    },
    "name":"test",
    "tag":{
      "value":"2021.6.4",
      "semver":true
    },
    "digest":{
      "watch":false,
      "repo":"sha256:ca0edc3fb0b4647963629bdfccbb3ccfa352184b45a9b4145832000c2878dd72"
    },
    "architecture":"amd64",
    "os":"linux",
    "created":"2021-06-12T05:33:38.440Z"
  },
  "result":{
    "tag":"2021.6.5"
  },
  "updateAvailable": true
}
```

## Get all triggers associated to the container

This operation lets you get the list of the containers associated to the container.

```bash
curl http://wud:3000/api/containers/31a61a8305ef1fc9a71fa4f20a68d7ec88b28e32303bbc4a5f192e851165b816/triggers

[
  {
    "id": "ntfy.one",
    "type": "ntfy",
    "name": "one",
    "configuration": {
      "topic": "235ef38e-f1db-414a-964f-ce3f2cc8094d",
      "url": "https://ntfy.sh",
      "threshold": "major",
      "mode": "simple",
      "once": true,
      "simpletitle": "New ${kind} found for container ${name}",
      "simplebody": "Container ${container.name} running with ${container.updateKind.kind} ${container.updateKind.localValue} can be updated to ${container.updateKind.kind} ${container.updateKind.remoteValue}${container.result && container.result.link ? "\\n" + container.result.link : ""}",
      "batchtitle": "${containers.length} updates available",
    }
  }
]
```

## Watch a Container

This operation triggers a manual watch on a container.

```bash
curl -X POST http://wud:3000/api/containers/ca0edc3fb0b4647963629bdfccbb3ccfa352184b45a9b4145832000c2878dd72/watch

{
  "id":"31a61a8305ef1fc9a71fa4f20a68d7ec88b28e32303bbc4a5f192e851165b816",
  "name":"homeassistant",
  "watcher":"local",
  "includeTags":"^\\d+\\.\\d+.\\d+$",
  "image":{
    "id":"sha256:d4a6fafb7d4da37495e5c9be3242590be24a87d7edcc4f79761098889c54fca6",
    "registry":{
      "url":"123456789.dkr.ecr.eu-west-1.amazonaws.com"
    },
    "name":"test",
    "tag":{
      "value":"2021.6.4",
      "semver":true
    },
    "digest":{
      "watch":false,
      "repo":"sha256:ca0edc3fb0b4647963629bdfccbb3ccfa352184b45a9b4145832000c2878dd72"
    },
    "architecture":"amd64",
    "os":"linux",
    "created":"2021-06-12T05:33:38.440Z"
  },
  "result":{
    "tag":"2021.6.5"
  },
  "updateAvailable": true
}
```

## Run a trigger on the container

This operation lets you manually run a trigger on the container.

```bash
curl -X POST http://wud:3000/api/containers/31a61a8305ef1fc9a71fa4f20a68d7ec88b28e32303bbc4a5f192e851165b816/triggers/ntfy/one
```

The request body is optional. When omitted (as above), the trigger runs against the
container's **highest** pending update, as always.

To run the trigger against a _specific_ pending update instead, pass a `bucket` field in a
JSON body:

```bash
curl -X POST http://wud:3000/api/containers/<id>/triggers/ntfy/one \
  -H 'Content-Type: application/json' \
  -d '{ "bucket": "patch" }'
```

`bucket` is optional and must be one of `major`, `minor`, `patch` or `digest`. When present,
the trigger runs against that entry of the container's [`updates`](#updates) map instead of
the highest update. The request is rejected with a `400` if

- `bucket` is not one of `major`/`minor`/`patch`/`digest` — an explicit `null` is also
  rejected; omit the field entirely to target the highest update;
- the container has no populated update for that bucket — per the
  [three-state semantics](#updates) of the `updates` map, both an **absent** key and a
  **`null`** key mean "not populated" for this API.

### Response

On success the response is `200`. The body is `{}` for triggers that report nothing (all
notification triggers), and carries the outcome of the run for the `docker` and
`dockercompose` update triggers:

```json
{
  "members": [
    { "id": "31a61a8305ef1fc9a71fa4f20a68d7ec88b28e32303bbc4a5f192e851165b816", "name": "homeassistant", "status": "updated" }
  ],
  "dependents": [
    { "name": "qbittorrent", "host": "gluetun", "status": "bounced", "method": "recreate" },
    { "name": "qbittorrent-exporter", "host": "gluetun", "status": "skipped", "reason": "unresolved" }
  ]
}
```

`members` holds a single entry — the requested container — with the same fields as on the
[batch endpoint](#batch-response), and is the authoritative outcome of the run: a `200` whose
`members[0].status` is `updated` is what proves the container was actually updated. Both the
`docker` and the `dockercompose` update trigger report it, **except under dry-run**, where
nothing is applied and the body stays `{}` by design.

`dependents` reports one entry per container named by the updated container's
[`wud.postupdate.restart`](/configuration/watchers/?id=restart-dependent-containers-after-an-update)
label. It is absent when no such label is set.

| Field    | Description                                                                                                       |
| -------- | ------------------------------------------------------------------------------------------------------------------ |
| `name`   | The dependent container name, as written in the label                                                             |
| `host`   | The name of the updated container whose label named it                                                            |
| `status` | `bounced`, `skipped` or `failed`                                                                                  |
| `method` | `restart` or `recreate` — set when `status` is `bounced`                                                          |
| `reason` | Why it was skipped or failed (e.g. `unresolved`, `not running`, `self-reference`) — also set for a recreate that deliberately left the dependent stopped |

?> Dependents that were skipped or failed do **not** change the status code: the update
itself succeeded, so the response stays `200`. A failed update still returns `500`.

The request is rejected with a `400` when the trigger cannot act on the container at all —
e.g. a `dockercompose` container whose compose file cannot be resolved (no
`wud.compose.file` label and no `com.docker.compose.project.config_files` label, none of the
candidate files exists, or none of them declares a matching service). Nothing is applied and
the body names the reason, with the same keys as the
[batch endpoint](#batch-trigger-on-multiple-containers) plus a `details` array:

```json
{
  "error": "Container homeassistant cannot be updated by this trigger (none of its candidate compose files exist (/etc/my-services/docker-compose.yml))",
  "containers": ["31a61a8305ef1fc9a71fa4f20a68d7ec88b28e32303bbc4a5f192e851165b816"],
  "details": [
    {
      "id": "31a61a8305ef1fc9a71fa4f20a68d7ec88b28e32303bbc4a5f192e851165b816",
      "name": "homeassistant",
      "reason": "none of its candidate compose files exist (/etc/my-services/docker-compose.yml)"
    }
  ]
}
```

The response is `409` when the container is still in WUD's store but no longer exists in
Docker — it was removed between the last watch cycle and the trigger call:

```json
{
  "error": "Container homeassistant no longer exists",
  "containers": ["31a61a8305ef1fc9a71fa4f20a68d7ec88b28e32303bbc4a5f192e851165b816"]
}
```

?> `404` and `409` are not interchangeable: `404` means the id is unknown to **WUD**, while
`409` means WUD knows the container but **Docker** does not. A `409` clears itself on the
next watch cycle, which drops the container from the store.

!> With `wud.postupdate.restart` set, the call also blocks through the post-update health
gate (up to the trigger's `POSTUPDATETIMEOUT`, 5 minutes by default). Reverse proxies with a
short read timeout may cut the response while WUD keeps going server-side.

## Batch trigger on multiple containers

This operation runs a single trigger against **multiple** containers as one lockstep
operation. It is intended for groups of interdependent containers (e.g. `immich` +
`immich-machine-learning`) that must always run the same version: for the `docker` and
`dockercompose` update triggers, WUD pulls **all** the new images first and only swaps the
containers once every pull has succeeded. This removes the long (pull-time) mismatch window;
the containers are then recreated back-to-back, so only a brief recreate window (seconds)
remains rather than the minutes a slow pull would otherwise cause.

```bash
# Local trigger
curl -X POST http://wud:3000/api/containers/batch/triggers/docker/update \
  -H 'Content-Type: application/json' \
  -d '{ "containerIds": ["<id1>", "<id2>"], "bucket": "patch" }'

# Agent-scoped trigger
curl -X POST http://wud:3000/api/containers/batch/triggers/<agent>/docker/update \
  -H 'Content-Type: application/json' \
  -d '{ "containerIds": ["<id1>", "<id2>"], "bucket": "patch" }'
```

The request body is `{ "containerIds": [...] }`, plus an optional `bucket` field
(`major` | `minor` | `patch` | `digest`). When `bucket` is present, the single requested
bucket is applied to **every** member of the batch: each container is updated to its own
entry of that kind in its [`updates`](#updates) map, instead of its highest pending update.
When `bucket` is omitted, every container receives its highest pending update, as always.

The batch is validated strictly and is
**all-or-nothing**: it is rejected before any Docker work begins if

- `containerIds` is missing, empty, or not an array (`400`);
- `containerIds` contains duplicates — the response lists the `duplicates` (`400`);
- `bucket` is present but not one of `major`/`minor`/`patch`/`digest` — an explicit `null`
  is also rejected; omit the field entirely instead (`400`);
- the trigger does not exist (`404`);
- any container id is unknown — the response lists the `missing` ids (`404`);
- the containers do not all belong to the trigger's agent (`400`);
- the containers do not all share the same watcher (`400`);
- any container has no pending update (`400`);
- `bucket` is present and any container has no populated update of that kind (absent and
  `null` entries both count as "not populated") — the response lists the offending
  `containers` (`400`);
- any container cannot be updated by this trigger as a batch — e.g. a `dockercompose`
  container that does not belong to a managed compose file — the response lists the
  offending `containers`, plus a `details` array carrying `{ id, name, reason }` for each of
  them (`400`).

If a pull fails mid-batch, no container is swapped and the response is `500` (the whole
group is left untouched).

### Batch response

Once every image has been pulled, each member is swapped and the response reports the
outcome per member and per dependent:

```json
{
  "members": [
    { "id": "<id1>", "name": "immich", "status": "updated" },
    { "id": "<id2>", "name": "immich-machine-learning", "status": "failed", "error": "No such image" }
  ],
  "dependents": [
    { "name": "qbittorrent", "host": "gluetun", "status": "bounced", "method": "restart" }
  ]
}
```

| Field    | Description                                                              |
| -------- | -------------------------------------------------------------------------- |
| `id`     | The container id **before** the update                                   |
| `name`   | The container name                                                       |
| `status` | `updated` or `failed`                                                    |
| `error`  | The failure message — set when `status` is `failed`                      |
| `gone`   | `true` when the member failed because the container no longer exists in Docker — omitted otherwise |

`dependents` has the same shape as on the [single trigger endpoint](#response) and covers
every member's `wud.postupdate.restart` label. A dependent that is itself a member of the
batch is reported `skipped`, with reason `batch member, already updated` when its own
update succeeded or `batch member, update failed` when it did not.

The status code depends on the members:

- every member `updated` → `200` with the body above;
- at least one member `failed` → `500`, with the same `members` / `dependents` fields plus
  an `error` field set to `One or more batch members failed to update`. The members that
  did succeed **are** updated — the all-or-nothing guarantee covers the pull phase, not the
  swap phase — and the dependents of successfully updated members are still bounced. A
  member that no longer exists in Docker is reported here as `failed` with `gone: true`,
  rather than mapped onto the `409` the single endpoint returns — a batch-wide status code
  would lose the outcome of the other members.

?> Skipped or failed dependents alone do not make the batch fail; they are reported in the
`200` body.

!> When any member carries `wud.postupdate.restart`, the call also blocks through the
post-update health gate (up to the trigger's `POSTUPDATETIMEOUT` per gated member,
sequentially). Reverse proxies with a short read timeout may cut the response while WUD
keeps going server-side.

## Delete a Container

This operation lets you delete a container by id.

```bash
curl -X DELETE http://wud:3000/api/containers/ca0edc3fb0b4647963629bdfccbb3ccfa352184b45a9b4145832000c2878dd72
```
