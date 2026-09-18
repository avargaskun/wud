# Storage
  
If you want the state to persist after the container removal, you need to mount  ```/store``` as a volume.

### Tag cache

| Env var                 | Required       | Description                                            | Supported values | Default value when missing |
| ----------------------- |:--------------:| ------------------------------------------------------ | ---------------- | -------------------------- |
| `WUD_TAGCACHE_ENABLED`  | :white_circle: | Persist incremental tag-listing state across restarts  | `true`, `false`  | `false`                    |
| `WUD_TAGCACHE_PATH`     | :white_circle: | Directory holding the persisted tag lists              | any path         | `/tagcache`                |

The registries that support [incremental tag listing](/configuration/registries/?id=incremental-tag-listing) (GHCR and LSCR) remember the tag list from the previous cycle so that they only have to ask for the tags added since. That list lives in memory only, so every restart re-lists every tag of every watched repository.

Set `WUD_TAGCACHE_ENABLED` to `true` to keep it on disk as well; the remembered position then survives a restart.

- The cache is only used by registries that support incremental tag listing and have not opted out of it with `INCREMENTALTAGS`.
- It is a **separate** volume from `/store`, so it can live on throwaway storage.
- One small JSON file is written per image, and only when that image's tag list actually changed.
- Entries untouched for 90 days are pruned at startup.
- The directory, or any single file in it, is safe to delete — the tag cache repopulates itself after the next WUD restart (or, for a single file, as soon as that image's tag list next changes). Delete it while WUD is stopped if you want it rebuilt immediately.

### Examples

#### Persist the state

<!-- tabs:start -->
#### **Docker Compose**
```yaml
services:
  whatsupdocker:
    image: getwud/wud
    ...
    volumes:
      - /path-on-my-host:/store
```
#### **Docker**
```bash
docker run \
  -v /path-on-my-host:/store
  ...
  getwud/wud
```
<!-- tabs:end -->

#### Enable the tag cache

<!-- tabs:start -->
#### **Docker Compose**
```yaml
services:
  whatsupdocker:
    image: getwud/wud
    ...
    environment:
      - WUD_TAGCACHE_ENABLED=true
    volumes:
      - /path-on-my-host:/store
      - /other-path-on-my-host:/tagcache
```
#### **Docker**
```bash
docker run \
  -e WUD_TAGCACHE_ENABLED="true" \
  -v /path-on-my-host:/store \
  -v /other-path-on-my-host:/tagcache \
  ...
  getwud/wud
```
<!-- tabs:end -->
