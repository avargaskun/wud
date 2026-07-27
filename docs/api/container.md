# Container API
This API allows to query the state of the watched containers.

## Update related fields

Every container returned by this API exposes the outcome of the last watch cycle through
four related fields.

| Field             | Description                                                                                          |
| ----------------- | ---------------------------------------------------------------------------------------------------- |
| `updateAvailable` | `true` when at least one update was found for the container                                          |
| `result`          | The **highest** available update (`tag`, `digest`, `created`, `link`)                                  |
| `updateKind`      | A description of that **same highest** update                                                         |
| `updates`         | The detail of every available update, split by kind (`major`, `minor`, `patch`, `digest`)             |

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

| Field        | Description                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------------- |
| `kind`       | `tag` when a newer tag was found, `digest` when the digest behind the current tag changed, `unknown` otherwise |
| `localValue` | The currently running tag (or digest when `kind` is `digest`)                                                  |
| `remoteValue`| The tag (or digest) of the highest available update                                                            |
| `semverDiff` | `major`, `minor`, `patch`, `prerelease` or `unknown`                                                            |

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

| State                    | Meaning                                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Key **absent**           | The update kind is structurally impossible for this container (e.g. no `patch` for a container running `:8`; no `digest` unless digest watching is enabled) |
| Key present, **`null`**  | The update kind applies to this container, but nothing newer is available                                                       |
| Key present, **object**  | An update of that kind is available                                                                                             |

?> `updates` itself being absent means the container has not been watched yet since WUD was upgraded.

Each populated entry is an object with the following fields.

| Field         | Description                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------------ |
| `kind`        | `tag` for the `major` / `minor` / `patch` entries, `digest` for the `digest` entry                            |
| `localValue`  | The currently running tag (the currently running digest for the `digest` entry)                               |
| `remoteValue` | The tag to update to (the new digest for the `digest` entry)                                                  |
| `semverDiff`  | `major`, `minor`, `patch` or `prerelease` (absent for the `digest` entry)                                     |
| `created`     | The creation date of the remote image (only populated for the `digest` entry)                                 |
| `link`        | The `wud.link.template` rendered for `remoteValue` (absent when no link template is configured)               |

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
  -d '{ "containerIds": ["<id1>", "<id2>"] }'

# Agent-scoped trigger
curl -X POST http://wud:3000/api/containers/batch/triggers/<agent>/docker/update \
  -H 'Content-Type: application/json' \
  -d '{ "containerIds": ["<id1>", "<id2>"] }'
```

The request body is `{ "containerIds": [...] }`. The batch is validated strictly and is
**all-or-nothing**: it is rejected before any Docker work begins if

- `containerIds` is missing, empty, or not an array (`400`);
- `containerIds` contains duplicates — the response lists the `duplicates` (`400`);
- the trigger does not exist (`404`);
- any container id is unknown — the response lists the `missing` ids (`404`);
- the containers do not all belong to the trigger's agent (`400`);
- the containers do not all share the same watcher (`400`);
- any container has no pending update (`400`);
- any container cannot be updated by this trigger as a batch — e.g. a `dockercompose`
  container that does not belong to a managed compose file — the response lists the
  offending `containers` (`400`).

On success the response is `200` with an empty body. If a pull fails mid-batch, no
container is swapped and the response is `500` (the whole group is left untouched).

## Delete a Container
This operation lets you delete a container by id.

```bash
curl -X DELETE http://wud:3000/api/containers/ca0edc3fb0b4647963629bdfccbb3ccfa352184b45a9b4145832000c2878dd72
```