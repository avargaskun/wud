# Docker
![logo](docker.png)

The `docker` trigger lets you replace existing containers with their updated versions.

The trigger will: 
- Clone the existing container specification
- Pull the new image
- Stop the existing container (if it is running)
- Rename the existing container aside, to `<name>_wud_old_<id>`
- Create the new container
- Start the new container (if the previous one was running)
- Remove the renamed-aside container
- Remove the previous image (optionally)
- Bounce the dependent containers declared with the `wud.postupdate.restart` label (optionally)

### When an update fails

Updates are non-destructive: once the trigger returns, the container is either running the new image or still running the old one.

That is the reason the existing container is *renamed* aside rather than removed — it is still there, intact, for as long as the swap is in flight. If any step of the swap fails, WUD walks back down the ladder it just climbed:

1. the replacement container, if one was created, is removed — the original name cannot be restored while the replacement holds it;
2. the renamed-aside container is renamed back to its original name;
3. it is started again, but only if it was running before the update.

Two shapes cannot be renamed aside: a container started with `--rm` (`AutoRemove`), which the daemon deletes the moment it stops, and a daemon or socket proxy that refuses the rename call — there, WUD falls back to the old remove-then-create order. On failure it first checks whether the original survived after all; if it did, it is simply started again. Only when it is genuinely gone does WUD recreate it from the specification it captured before the update, **with its original image**, and start it. That last rung re-issues the very call that just failed, which is why it is only ever reached when nothing cheaper is left.

The outcome is reported in the error message, which reaches you through `members[].error` in the [trigger API response body](/api/container/?id=run-a-trigger-on-the-container) and through the single-container endpoint's `500` body:

| Message | What it means |
| ------- | ------------- |
| `Update failed and the container was rolled back: <error>` | The original container is back under its own name, running as it was. |
| `Update failed; the container was restored but could not be started: <error>` | The original is back under its own name but stopped. Start it with `docker start <name>`. |
| `Update failed and the container could NOT be restored: <error> (rollback: <error>)` | The recovery itself failed — see below. |

An update that fails before anything was touched — a container that refuses to stop — is reported with the underlying Docker error alone and none of the wording above: there was nothing to roll back.

?> `members[].status` stays `updated` / `failed`; there is no extra field. The distinction lives in the message above and in the log level: a rolled-back update logs a **warning**, a failed recovery logs an **error**. An `error` line from this trigger means a service is actually down.

**Recovering from `could NOT be restored`.** In the most likely case the original container is alive and intact and merely still carries its aside name — it is the rename *back* that failed. Two commands put it right:

```bash
docker rename <name>_wud_old_<id> <name>
docker start <name>
```

`docker ps -a --filter name=_wud_old_` lists every container left in that state.

**Leftover `_wud_old_` containers.** If WUD is stopped or crashes in the middle of a swap, the renamed-aside container survives, stopped, under its `<name>_wud_old_<id>` name. It is harmless, but it inherits the original's `wud.*` labels, so it may appear once in the UI until you remove it by hand with `docker rm <name>_wud_old_<id>`. WUD never reaps these automatically.

**Compose files.** When a [dockercompose](/configuration/triggers/docker-compose/) update fails for *every* container pinned to an `image:` line, that line is put back to the version it pinned before the run, so the container keeps resolving to its service and the update can be retried. If the file changed on disk between the rewrite and the swap, the revert is skipped with a warning. Members whose line was reverted report `fileUpdated: false`.

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

A recreated dependent goes through the same rename-aside ladder as the updated container, so a recreate that fails rolls the dependent back and reports `failed` with a `recreate failed, dependent rolled back: <error>` reason. When the dependent is renamed back but will not start again, it reports `recreate failed; the dependent was restored but could not be started: <error>` — it exists under its own name, stopped, and only needs a `docker start <name>`. An `--rm` dependent is the one shape with no rollback: it cannot be renamed aside, and it cannot be recreated against its old namespace host because that host has already been replaced. That case reports `recreate failed and the dependent could NOT be restored: <error>` and logs an error.

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
| `WUD_TRIGGER_DOCKER_{trigger_name}_AUTOREMOVETIMEOUT`| :white_circle: | How long to wait (in ms) for an `--rm` container to disappear after being stopped | Integer | `10000`      |
| `WUD_TRIGGER_DOCKER_{trigger_name}_MULTINETWORKFALLBACK`| :white_circle: | Retry a multi-network create as a single create plus sequential network attaches | `true`, `false` | `true`   |

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
