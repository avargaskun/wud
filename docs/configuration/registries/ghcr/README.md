# GHCR (Github Container Registry)
![logo](github.png)

The `ghcr` registry lets you configure [GHCR](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-docker-registry) integration.

### Variables

| Env var                                      | Required       | Description     | Supported values                         | Default value when missing |
| -------------------------------------------- |:--------------:| --------------- | ---------------------------------------- | -------------------------- | 
| `WUD_REGISTRY_GHCR_{REGISTRY_NAME}_USERNAME` | :white_circle: | Github username |                                          |                            |
| `WUD_REGISTRY_GHCR_{REGISTRY_NAME}_TOKEN`    | :white_circle: | Github token    | Github password or Github Personal Token |                            |
| `WUD_REGISTRY_GHCR_{REGISTRY_NAME}_INCREMENTALTAGS` | :white_circle: | Fetch only tags pushed since the last cycle instead of re-listing the whole repository | `true`, `false` | `true` |

### Incremental tag listing

Large repositories can expose tens of thousands of tags (`ghcr.io/immich-app/immich-server` alone
lists over 30,000), and re-listing all of them for every container on every cycle is enough to hit
GHCR's anonymous rate limit (HTTP 429).

When `INCREMENTALTAGS` is enabled (the default), WUD remembers the tag list from the previous cycle
and asks GHCR only for the tags added since then, merging the delta into the cached list. GHCR lists
tags in creation order and never reorders them, which is what makes this safe.

If the remembered position no longer exists — for example because the tag it pointed at was deleted —
WUD logs an `info` message and transparently falls back to a full listing, which re-establishes the
position for the next cycle. Set the variable to `false` to always list the whole repository.

The remembered position lives in memory only, so a restart discards it and the next cycle lists the
whole repository again. Set `WUD_TAGCACHE_ENABLED` to `true` to persist it across restarts — see the
[tag cache](/configuration/storage/?id=tag-cache) documentation.

### Examples

#### Configure to access private images

<!-- tabs:start -->
#### **Docker Compose**
```yaml
services:
  whatsupdocker:
    image: getwud/wud
    ...
    environment:
      - WUD_REGISTRY_GHCR_PRIVATE_USERNAME=john@doe
      - WUD_REGISTRY_GHCR_PRIVATE_TOKEN=xxxxx 
```
#### **Docker**
```bash
docker run \
  -e WUD_REGISTRY_GHCR_PRIVATE_USERNAME="john@doe" \
  -e WUD_REGISTRY_GHCR_PRIVATE_TOKEN="xxxxx" \
  ...
  getwud/wud
```
<!-- tabs:end -->

### How to create a Github Personal Token
#### Go to your Github settings and open the Personal Access Token tab
[Click here](https://github.com/settings/tokens)

#### Click on `Generate new token`
Choose an expiration time & appropriate scopes (`read:packages` is only needed for wud) and generate.
![image](ghcr_01.png)

#### Copy the token & use it as the WUD_REGISTRY_GHCR_{REGISTRY_NAME}_TOKEN value
![image](ghcr_02.png)
