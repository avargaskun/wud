# Docker
![logo](docker.png)

The `docker` trigger lets you replace existing containers with their updated versions.

The trigger will: 
- Clone the existing container specification
- Pull the new image
- Stop the existing container
- Remove the existing container
- Create the new container
- Start the new container (if the previous one was running)
- Remove the previous image (optionally)
- Bounce the dependent containers declared with the `wud.postupdate.restart` label (optionally)

### Post-update dependent restart

When the updated container carries the [`wud.postupdate.restart`](/configuration/watchers/?id=restart-dependent-containers-after-an-update) label, the trigger runs a post-update epilogue on the containers it names. This exists for containers sharing the updated container's network namespace (`network_mode: container:<x>` / `service:<x>`), which are left attached to a dead namespace after a recreate.

The epilogue only runs when the update itself succeeded, and never in dry-run mode.

**Health gate.** Before bouncing anything, WUD waits for the newly created container to be ready:
- if the image declares a `HEALTHCHECK`, until its health status is `healthy` (a status of `unhealthy` aborts immediately);
- otherwise, until the container is `running`.

If the gate fails or times out (`POSTUPDATETIMEOUT`, in milliseconds), all the dependents of that container are reported as `skipped` and left untouched. A container that was stopped before the update — and therefore not started by WUD after it — also skips its dependents.

**Restart vs recreate.** Each dependent is inspected and bounced with the least invasive method:
- **recreate** when its `NetworkMode` references the updated container (by full ID, short ID, or name). The container is recreated from its live configuration with `NetworkMode` re-pointed at the **new** container ID — a plain restart cannot work in this case (`cannot join network of a non running container`). The dependent gets a new ID.
- **restart** otherwise.

**Stopped dependents.** A stopped dependent that does *not* reference the updated container is reported `skipped` (`not running`) — WUD does not start containers you stopped. A stopped dependent whose `network_mode` references the updated container (by ID, short ID or name) is recreated but left stopped — an ID-referencing one could otherwise never be started again.

**Single hop.** The dependents' own `wud.postupdate.restart` labels are not followed. Dependents need not be watched by WUD, but must live on the same Docker host as the updated container. A name that does not resolve is reported `skipped` (`unresolved`).

Every dependent outcome (`bounced` / `skipped` / `failed`) is logged, exposed through the [`wud_postupdate_bounce_count`](/monitoring/) metric and returned in the [trigger API response body](/api/container/?id=run-a-trigger-on-the-container).

!> The health gate blocks the trigger run: a manual trigger HTTP call also waits through it (up to `POSTUPDATETIMEOUT` per gated container, sequentially within a batch). Reverse proxies with a short read timeout may cut the response while WUD keeps going server-side.

### Variables

| Env var                                              | Required       | Description                                                          | Supported values | Default value when missing |
| ---------------------------------------------------- |:--------------:|----------------------------------------------------------------------| ---------------- | -------------------------- | 
| `WUD_TRIGGER_DOCKER_{trigger_name}_PRUNE`            | :white_circle: | If old image versions must be pruned                                 | `true`, `false`  | `false`                    |
| `WUD_TRIGGER_DOCKER_{trigger_name}_DRYRUN`           | :white_circle: | When enabled, only pull the new image ahead of time                  | `true`, `false`  | `false`                    |
| `WUD_TRIGGER_DOCKER_{trigger_name}_POSTUPDATETIMEOUT`| :white_circle: | Health gate timeout (in ms) before bouncing dependent containers     | Integer >= 0     | `300000`                   |

?> This trigger also supports the [common configuration variables](configuration/triggers/?id=common-trigger-configuration).

?> This trigger picks up the Docker configuration from the [configured Docker watchers](configuration/watchers/) so it can handle updates on Local **and** Remote Docker hosts. 

### Examples

<!-- tabs:start -->
#### **Docker Compose**
```yaml
services:
  whatsupdocker:
    image: getwud/wud
    ...
    environment:
      - WUD_TRIGGER_DOCKER_EXAMPLE_PRUNE=true
```
#### **Docker**
```bash
docker run \
  -e "WUD_TRIGGER_DOCKER_EXAMPLE_PRUNE=true" \
  ...
  getwud/wud
```
<!-- tabs:end -->
