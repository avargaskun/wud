# Docker-Compose
![logo](docker-compose.png)

The `dockercompose` trigger lets you update docker-compose.yml files & replace existing containers with their updated versions.

The trigger will:
- Update the related docker-compose.yml file
- Clone the existing container specification
- Pull the new image
- Stop the existing container
- Remove the existing container
- Create the new container
- Start the new container (if the previous one was running)
- Remove the previous image (optionally)
- Bounce the dependent containers declared with the `wud.postupdate.restart` label (optionally)

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
