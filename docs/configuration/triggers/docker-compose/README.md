# Docker-Compose
![logo](docker-compose.png)

The `dockercompose` trigger lets you update docker-compose.yml files & replace existing containers with their updated versions.

The trigger will:
- Update the related docker-compose.yml file
- Clone the existing container specification
- Pull the new image
- Stop the existing container (if it is running)
- Rename the existing container aside, to `<name>_wud_old_<id>`
- Create the new container
- Start the new container (if the previous one was running)
- Remove the renamed-aside container
- Remove the previous image (optionally)
- Bounce the dependent containers declared with the `wud.postupdate.restart` label (optionally)

### Which compose file is updated

The file is looked up in this order, and the **first** source that yields at least one path wins:

1. the container's `wud.compose.file` label;
2. the automatic `com.docker.compose.project.config_files` label;
3. the trigger's `FILE` variable.

Each source is read as a **comma-separated list**, because that is how Compose writes `com.docker.compose.project.config_files` for a project started with more than one file (`docker-compose.yml,docker-compose.override.yml`). Whitespace around each entry is trimmed, empty entries are dropped, and a relative path is resolved against WUD's working directory. `wud.compose.file` and the trigger's `FILE` variable accept a list too — for `FILE`, the trigger refuses to start unless at least one of the configured paths exists, and warns about each one that does not.

Every candidate is then validated independently: it must exist (as seen from **inside** the wud container) and it must declare a service matching the container. Of those that pass, the **last** one is the file that gets rewritten — later `-f` files win under Compose's own merge semantics, so rewriting an earlier file while a later one still pins the old tag would be a silent no-op on the next `docker compose up`.

A candidate whose YAML cannot be parsed is skipped with a warning and the remaining candidates are still tried; the run only fails if none of them resolves.

!> A path containing a literal comma is not supported — it is split at the comma like any other list.

### How the compose file is updated

A container is matched to a compose service by the service's **`image:` pin**: the pin and the container's current image reference must be equal once both are canonicalized, so `image: nginx:1.0` and `image: docker.io/library/nginx:1.0` both match the same Docker Hub container.

A pin also matches when it is that same reference **behind a pull-through mirror or registry-cache prefix**, as long as the first extra path segment looks like a registry host — it contains a dot or a port colon, or is exactly `localhost`. So `image: mirror.local/ghcr.io/user/app:1.0`, `image: mirror.local:5000/ghcr.io/user/app:1.0` and `image: harbor.local/proxy/ghcr.io/user/app:1.0` all match a container resolved to `ghcr.io/user/app:1.0`, and the rewrite keeps the prefix you wrote (`mirror.local/ghcr.io/user/app:1.1`). A plain namespace prefix is not a mirror: `image: myorg/ghcr.io/user/app:1.0` is still never matched. Only the file's pin may carry the extra prefix — the container's own reference is never treated as a superset of the pin.

When several services in the same file match, the automatic `com.docker.compose.service` label decides which one is updated — including when one service pins the image directly and another pins it behind a mirror. Without a usable label, a single exact pin wins over a mirror-prefixed one, and a mirror-prefixed pin is chosen on its own only when it is the file's only match. The label otherwise only disambiguates between services that already match by image: a label naming a service that is absent from the file, or that pins a different image, is ignored and the `image:` pin alone decides. The one exception is that single mirror-prefixed match — a label naming a different service that does exist in the file blocks it, and the file is left alone.

?> Docker Hub references are host-less once canonicalized (`user/app:1.0`), so for a **label-less** container running a Hub image, a registry-hosted pin with the identical path and tag (`image: ghcr.io/user/app:1.0`) counts as a mirror pin of it. That is the same shape that makes `image: mirror.local/library/nginx:1.25` match a container on `nginx:1.25`, so the two cannot be told apart from the text alone. Containers started by Compose always carry a `com.docker.compose.service` label, which settles it.

Only the matched service's `image:` **value** is rewritten, as a targeted replacement of that one scalar. Everything else in the file is preserved byte for byte: the registry prefix you wrote (`docker.io/library/nginx:1.0` becomes `docker.io/library/nginx:1.1`, not `nginx:1.1`), the quoting style, comments, indentation, key order, anchors, line endings and a leading BOM.

?> Only the tag part of the pin is substituted. A service pinned to the same image as another service is no longer co-updated.

### When the compose file is not updated

Some services cannot be rewritten safely. The container is still pulled and updated, but the file is left as-is and a warning is logged:

- several services match the container's image — sharing the same `image:` pin, or pinning it behind different mirror prefixes — and the container carries no usable `com.docker.compose.service` label;
- the service's image is an anchor definition (`image: &shared_img ghcr.io/acme/app:1.0`) — rewriting it would also bump every service aliasing it;
- the service's image is an alias (`image: *shared_img`).

Other service shapes are never matched to a container at all, so the container is not batchable through this trigger:

- `${VAR}`-interpolated pins (`image: ghcr.io/acme/app:${APP_TAG}`);
- digest pins, including combined `repo:tag@sha256:...` pins;
- merge-inherited images (`<<: *base`);
- `build:`-only services (no `image:` key);
- untagged pins (`image: nginx`).

!> A trigger request that explicitly names such a container returns **HTTP 400**, on the single-container endpoint as well as the batch one. The same applies to a container whose compose file cannot be resolved at all — no label and no configured file, none of the candidate files exists, none of them parses, or none of them declares the container's image — and to a container that is not watched on the local host. Such a request used to answer `200` with an empty body while doing nothing; it now fails with the reason in the response body (see the [API documentation](/api/container/?id=response)).

?> The trigger API response reports the outcome per member: `fileUpdated: true` when the service's `image:` line was rewritten, `false` when the compose file could not be rewritten for that container, or when its `image:` line was reverted because the update failed. The field is omitted for digest updates, where no file change is expected because the tag does not change.

### When an update fails

The container swap itself is non-destructive and rolls back exactly as described for the [docker trigger](/configuration/triggers/docker/?id=when-an-update-fails): the existing container is renamed aside rather than removed, and it is renamed back and restarted if any step fails.

The compose file is rewritten **before** the swap, so a rolled-back container would otherwise be left running an image its own compose file no longer pins — and a service is matched to a container by that pin, so the container would silently stop resolving to its service and could never be retried. To prevent that, WUD reverts an `image:` line once every container pinned to it has failed to update. A line shared by a scaled service is kept bumped as long as at least one of its containers succeeded, and a file holding several services is reverted service by service.

The revert is skipped, with a warning, if the file no longer matches what WUD wrote — that is, if you or another tool edited it during the update. When `BACKUP` is enabled the `.back` file still holds the pre-update content and is left untouched.

### Post-update dependent restart

This trigger inherits the post-update epilogue of the [docker trigger](/configuration/triggers/docker/?id=post-update-dependent-restart): health gate, restart-vs-recreate decision, stopped-dependent handling and single-hop resolution are identical. The epilogue runs once, after every container of the batch has been swapped.

!> The docker-compose file is **not** rewritten for recreated dependents. A dependent recreated by WUD is cloned from its live configuration, so its on-disk `network_mode` definition may differ from the running one; Compose's own `service:<x>` form re-resolves by name on the next `docker compose up`.

!> The health gate blocks the trigger run: a manual trigger HTTP call also waits through it (up to `POSTUPDATETIMEOUT` per gated container, sequentially within a batch). Reverse proxies with a short read timeout may cut the response while WUD keeps going server-side.

### Variables

| Env var                                           | Required       | Description                                                    | Supported values | Default value when missing                                               |
| ------------------------------------------------- |:--------------:| -------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------ |
| `WUD_TRIGGER_DOCKERCOMPOSE_{trigger_name}_FILE`   | :white_circle: | The docker-compose.yml file location                           |                  | The value of the automatic com.docker.compose.project.config_files label |
| `WUD_TRIGGER_DOCKERCOMPOSE_{trigger_name}_BACKUP` | :white_circle: | Backup the docker-compose.yml file as `.back` before updating? | `true`, `false`  | `false`                                                                  |
| `WUD_TRIGGER_DOCKERCOMPOSE_{trigger_name}_PRUNE`  | :white_circle: | If the old image must be pruned after upgrade                  | `true`, `false`  | `false`                                                                  |
| `WUD_TRIGGER_DOCKERCOMPOSE_{trigger_name}_DRYRUN` | :white_circle: | When enabled, only pull the new image ahead of time            | `true`, `false`  | `false`                                                                  |
| `WUD_TRIGGER_DOCKERCOMPOSE_{trigger_name}_POSTUPDATETIMEOUT` | :white_circle: | Health gate timeout (in ms) before bouncing dependent containers | Integer >= 0 | `300000`                                                          |

?> This trigger also supports the [common configuration variables](configuration/triggers/?id=common-trigger-configuration). but only supports the `batch` mode.

!> This trigger will only work with locally watched containers.

!> Do not forget to mount the docker-compose.yml file in the wud container. If you're relying on the com.docker.compose.project.config_files label, you'll need to mount it so that the path insides the container matches your docker host.

### Examples

<!-- tabs:start -->
#### **Docker Compose**
```yaml
services:
  whatsupdocker:
    image: getwud/wud
    ...
    volumes:
    - /etc/my-services/docker-compose.yml:/wud/docker-compose.yml
    environment:
      - WUD_TRIGGER_DOCKERCOMPOSE_EXAMPLE_FILE=/wud/docker-compose.yml
```
#### **Docker**
```bash
docker run \
  -v /etc/my-services/docker-compose.yml:/wud/docker-compose.yml
  -e "WUD_TRIGGER_DOCKERCOMPOSE_EXAMPLE_FILE=/wud/docker-compose.yml" \
  ...
  getwud/wud
```
#### **Label**
```yaml
labels:
  wud.compose.file: "/my/path/docker-compose.yaml
```
<!-- tabs:end -->
