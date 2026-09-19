# LSCR (LinuxServer Container Registry)
![logo](linuxserver.png)

The `lscr` registry lets you configure [LSCR](https://fleet.linuxserver.io/) integration.

### Variables

| Env var                                      |   Required    | Description     | Supported values                         | Default value when missing |
|----------------------------------------------|:-------------:|-----------------|------------------------------------------|----------------------------|
| `WUD_REGISTRY_LSCR_{REGISTRY_NAME}_USERNAME` | :red_circle:  | Github username |                                          |                            |
| `WUD_REGISTRY_LSCR_{REGISTRY_NAME}_TOKEN`    | :red_circle:  | Github token    | Github password or Github Personal Token |                            |
| `WUD_REGISTRY_LSCR_{REGISTRY_NAME}_INCREMENTALTAGS` | :white_circle: | Fetch only tags pushed since the last cycle instead of re-listing the whole repository | `true`, `false` | `true` |

### Incremental tag listing

LSCR is backed by GHCR (it even authenticates against `ghcr.io/token`), so it shares GHCR's tag
listing behaviour and this optimisation.

When `INCREMENTALTAGS` is enabled (the default), WUD remembers the tag list from the previous cycle
and asks the registry only for the tags added since then, merging the delta into the cached list.
Tags are listed in creation order and are never reordered, which is what makes this safe.

If the remembered position no longer exists — for example because the tag it pointed at was deleted —
WUD logs an `info` message and transparently falls back to a full listing, which re-establishes the
position for the next cycle. Set the variable to `false` to always list the whole repository.

By default, the remembered position lives in memory only, so a restart discards it and the next
cycle lists the whole repository again. Set `WUD_TAGCACHE_ENABLED` to `true` to persist it across
restarts — see the [tag cache](/configuration/storage/?id=tag-cache) documentation.

### Examples

<!-- tabs:start -->
#### **Docker Compose**
```yaml
services:
  whatsupdocker:
    image: getwud/wud
    ...
    environment:
      - WUD_REGISTRY_LSCR_PRIVATE_USERNAME=johndoe
      - WUD_REGISTRY_LSCR_PRIVATE_TOKEN=xxxxx 
```
#### **Docker**
```bash
docker run \
  -e WUD_REGISTRY_LSCR_PRIVATE_USERNAME="johndoe" \
  -e WUD_REGISTRY_LSCR_PRIVATE_TOKEN="xxxxx" \
  ...
  getwud/wud
```
<!-- tabs:end -->

### How to create a Github Personal Token
#### Go to your Github settings and open the Personal Access Token tab
[Click here](https://github.com/settings/tokens)

#### Click on `Generate new token`
Choose an expiration time & appropriate scopes (`read:packages` is only needed for wud) and generate.
![image](lscr_01.png)

#### Copy the token & use it as the WUD_REGISTRY_LSCR_{REGISTRY_NAME}_TOKEN value
![image](lscr_02.png)
