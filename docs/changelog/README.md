# Changelog

## next
- :fire: [DOCKER] [DOCKER-COMPOSE] - Fix the replacement container being recreated on the **old** image's baked-in defaults (fixes #49). The new container is now created from the settings actually set on the container — Docker's container config is the user's settings already merged with the image's, and recreating from that merged view pinned the old image's defaults forever — so the new image's `ENV`, `CMD`, `ENTRYPOINT`, `WORKDIR`, `USER`, `HEALTHCHECK` and `LABEL` values apply to the replacement
  - An auto-generated hostname (12 hexadecimal digits, the short ID of the container it was generated for) is re-derived by the daemon from the new container, instead of being carried over so that every replacement answered to a long-gone container's ID
  - `com.docker.compose.image` now points at the image the container runs, so a **digest** update leaves the next `docker compose up -d` a no-op. A **tag** update still leaves one compose-driven recreate pending, because `com.docker.compose.config-hash` covers the rewritten `image:` line and WUD cannot compute that hash without the compose engine — delegating the recreate to Compose is tracked as an opt-in follow-up in [#50](https://github.com/avargaskun/wud/issues/50). Every other `com.docker.compose.*` label, the config hash included, is left as it was
  - For the `dockercompose` trigger, every key the service declares in its compose file(s) — `environment`, `labels`, `command`, `entrypoint`, `user`, `working_dir`, `stop_signal`, `hostname`, `expose`, `healthcheck` — is kept as-is. Only keys are read, never values, so `${VAR}` interpolation is irrelevant, and keys are unioned across every candidate file of the project
- :warning: **The new image's `ENV`, `CMD`, `ENTRYPOINT`, `WORKDIR`, `USER`, `HEALTHCHECK` and labels now apply on update**, where a container updated by WUD used to keep the old image's ones indefinitely. A container-level value byte-identical to the old image's default is indistinguishable from an inherited one and follows the new image: with `ENV PUID=1000` in the old image, `PUID=1000` set on the container and `ENV PUID=911` in the new one, the replacement runs with `911`. For the `dockercompose` trigger the keys the compose file declares are exempt and keep their value; keys reaching the service through `env_file:`, an `extends:` base or a `<<:` merge are not, and neither is anything under the plain `docker` trigger, which has no file to consult. Review such settings before upgrading, and set them in the compose service itself where you rely on them
- :fire: [DOCKER-COMPOSE] - Fix the trigger rewriting every occurrence of an image string in the compose file (fixes #22). Only the updated container's own service is rewritten now, resolved by the service's `image:` pin and disambiguated by the automatic `com.docker.compose.service` label, so a second service pinned to the same `image:tag` is no longer co-bumped. Comments, quoting style, indentation, key order, line endings and a leading BOM are preserved byte for byte
  - The compose file's own registry prefix is now preserved: `docker.io/library/nginx:1.0` becomes `docker.io/library/nginx:1.1` instead of being rewritten to `nginx:1.1`
  - The trigger API response's `members[]` gains an optional `fileUpdated` boolean: `false` when the container was updated but its compose file could not be rewritten, `true` when its `image:` line was rewritten, and omitted for digest updates
  - Services whose image is a YAML anchor (`image: &shared_img ...`) or an alias (`image: *shared_img`) are now skipped with a warning rather than co-bumped
- :warning: **Containers whose compose pin only *substring*-matched are no longer members of that compose file.** A file pinning `podinfo:5.0.00` no longer matches a container on `5.0.0`, and a combined `repo:tag@sha256:...` pin no longer matches a tag-form container — matching is now exact after canonicalization. Such a container is no longer batchable through the `dockercompose` trigger, so an explicit batch trigger request naming it returns **HTTP 400** instead of silently rewriting the wrong service's line. This also affects **pull-through mirror pins**: a file pinning `mirror.local/ghcr.io/user/app:1.0` where WUD resolves the container to the upstream `ghcr.io/user/app:1.0` matched before and was rewritten correctly, and is now excluded — see [#25](https://github.com/avargaskun/wud/issues/25). Audit compose pins that differ from the running tag, and mirror-prefixed pins, before upgrading
- :fire: [DOCKER-COMPOSE] - Fix the `com.docker.compose.project.config_files` fallback for projects made of several files (fixes #23). Compose writes that label as a **comma-separated list** as soon as a project uses an override file, and the whole string was used as a single path, so every such container was silently skipped unless it also carried a `wud.compose.file` label. Each entry is now validated on its own and the **last** file declaring the container's image is the one rewritten, following Compose's merge semantics. `wud.compose.file` accepts a comma-separated list too, and a candidate whose YAML does not parse is now warned about and skipped instead of failing the whole run
- :warning: **The single-container trigger endpoint no longer answers `200 {}` for an update that never happened.** A container the trigger cannot act on — a `dockercompose` container whose compose file cannot be resolved, that matches no service in it, or that is not watched on the local host — is now rejected with **HTTP 400** naming the container and the reason (`error`, `containers`, `details[].reason`), and a container that no longer exists in Docker returns **HTTP 409** instead of `200 {}` (`docker`) or a generic `500` (`dockercompose`). Orchestrators treating `200 {}` as success will start seeing errors **for containers that were never actually being updated**. Successful `docker` runs now also carry the `members[]` array `dockercompose` already returned (dry-run still answers `200 {}`), the batch endpoint's `400` gains a `details[]` array, and a batch member that vanished is reported with `gone: true` — its `error` text also changes from `Container no longer exists` to `Container <name> no longer exists`, so use the `gone` flag rather than matching that string
- :warning: The **automatic** `docker` trigger changes with it: a container that disappeared between the watch cycle and the trigger used to be counted as `wud_trigger_count{status="success"}`; it now logs a warning and is counted as `status="error"`. This is the only part of the change that affects users who never call the API — adjust any alerting on that counter
- :warning: **Invalid threshold values in `wud.trigger.include` are now rejected instead of silently falling back to `all`.** A container whose label carries a typo (e.g. `wud.trigger.include=docker.update:pacth`) **stops triggering entirely**, where it previously triggered for every update level. **The only signal is a `log.warn`** — nothing in the API or the UI indicates why the trigger went quiet. This applies to any malformed value, including entries with more than one colon (`docker.update:patch:minor`), which previously also fell back to `all`. Threshold matching is now case-insensitive, so `docker.update:Patch` is valid **and takes effect as `patch`** — previously it was unrecognised and degraded silently to `all`, so such a container will now be updated *less* readily than before, not more. Audit your `wud.trigger.include` labels **before** upgrading, and grep the logs for `Invalid threshold` afterwards — note the warning recurs on every watch cycle and on every read of the container's triggers through the API (which the Web UI does when you expand a container card), rather than appearing only once.
- :star: Add the `digest` trigger threshold, accepted both as `WUD_TRIGGER_{trigger_type}_{trigger_name}_THRESHOLD=digest` and as `wud.trigger.include=$trigger_id:digest`. It completes the ceiling ladder (`all` → `major` → `minor` → `patch` → `digest`) and installs **only** digest rebuilds of the tag the container already runs, while `major`, `minor` and `patch` updates keep being detected, reported through the API and displayed in the WebUI for a human to apply deliberately. On a **semver** tagged container it requires `wud.watch.digest.semver=true`, without which there is no digest bucket and the trigger is a silent no-op. `digest-only` is **not** accepted and fails closed like any unknown token. Purely additive: no existing threshold changes behaviour
- :star: Detect every available update per container, split by kind (`major`, `minor`, `patch`, `digest`), exposed through the new `updates` field of the container API, usable in notification templates (`${container.selectedUpdate.remoteValue}` for the update actually being applied; per-kind access must be optional-chained, e.g. `${container.updates?.patch?.remoteValue ?? ''}`, because a bucket may be `null` or absent) and published as 24 new `updates_*` Prometheus labels
- :warning: [AGENT] Agents must be upgraded in lock-step with the controller (controller first if the upgrade is staged). A new agent reporting to an old controller has its containers silently rejected by the controller's validation
- :warning: Threshold-gated triggers now fire for permitted lower-level updates that were previously masked by a higher-level one. This is the point of the change, but it means containers that were silently never updating will start updating
- :star: Add `wud.watch.digest.semver` label to enable digest watching on **semver** tagged containers (costs two extra registry calls per watch cycle per opted-in container). It is deliberately *not* `wud.watch.digest`, which remains inert on semver tags: reusing it would have activated digest watching at upgrade time for anyone already carrying it, potentially recreating running containers unprompted
- :warning: The persisted container layout changes. The first watch cycle after the upgrade repopulates update data and produces **one round of re-notification** (only for containers that actually have an update available)
- :warning: Notification frequency may increase for containers where lower-level updates appear independently of the highest one
- :warning: `wud.trigger.exclude` entries carrying a threshold now log a warning. The threshold has always been ignored there; the exclusion itself is unchanged
- :warning: The WebUI still displays the highest available update; with a threshold other than `all`, the version actually installed may be a lower one
- :fire: Fix notifications and updates for containers whose update kind cannot be determined (`updateKind.kind` is `unknown`): the notification now renders `digest` instead of `unknown` (previously `...running with unknown undefined can be updated to unknown undefined`) and the malformed image reference the trigger produced in that state is fixed
- :fire: Fix non-deterministic candidate tag ordering when two tags carry the same semver value (the comparator was self-contradictory for such pairs, leaving the resulting order unspecified)
- :star: Add `WUD_REGISTRY_HUB_PUBLIC_SUPPRESSDIGESTWATCHWARNING` env var
- :star: [GITLAB] - Add support for GitLab group access tokens
- :fire: [DOCKER-COMPOSE] - Fix trigger fails to detect containers in compose file
- :fire: [PROMETHEUS] - Reduce CPU usage
- :fire: [OIDC] - Fix issues when WUD starts while OIDC provider is temporarily unavailable
- :fire: [DOCKER] - Fix Docker container update when container is attached to multiple networks
- :wrench: [TELEGRAM] - Replace deprecated client by direct HTTP API use
- :star: Add batch trigger API endpoint (`POST /api/containers/batch/triggers/:triggerType/:triggerName`) to update multiple containers in lockstep
- :warning: `docker`/`dockercompose` batch-mode updates are now all-or-nothing: every image is pulled before any container is swapped (compose files are rewritten after a successful pull, not before)
- :star: Add an optional `bucket` field (`major` | `minor` | `patch` | `digest`) to the container trigger endpoint (`POST /api/containers/:id/triggers/:triggerType/:triggerName`) to run the trigger against a specific pending update instead of the highest one
- :star: Add the same optional `bucket` field to the batch trigger endpoint, applied to every member of the batch
- :star: Add `wud.postupdate.restart` label: after the `docker`/`dockercompose` trigger updates a container, the containers it names are restarted (or recreated with their `network_mode` re-pointed when they share the updated container's network namespace), gated on the new container being healthy. Outcomes are logged, exposed as `wud_postupdate_bounce_count` and returned in the trigger API response. New `WUD_TRIGGER_{DOCKER|DOCKERCOMPOSE}_{trigger_name}_POSTUPDATETIMEOUT` variable (ms, default `300000`)
- :warning: With `wud.postupdate.restart` set, a successful trigger run may now stop, start, restart or **recreate other containers** — including containers WUD does not watch. The label is opt-in, so nothing changes until you add it. Note that a trigger call also blocks through the health gate (up to `POSTUPDATETIMEOUT`), which may exceed a reverse proxy read timeout
- :warning: Trigger API responses are no longer empty: the single endpoint returns `dependents`, the batch endpoint returns `members` + `dependents`, and a batch where some members failed now returns `500` with that structured body instead of a bare error (the members that succeeded are still updated). Old Agents return an empty body and degrade to the previous behaviour

## 8.3.0
- :star: Add opt-in mode for trigger association
- :star: Add SOCKS5/HTTP proxy support to Telegram trigger
- :star: Add runtime subpath proxy support with WUD_SERVER_BASEPATH
- :star: Add ENV option for watch digest default
- :star: [MQTT] - Improve trigger
- :star: [DISCORD] - Add avatar URL support
- :star: ©
- :fire: Fix digest comparison for single-platform manifests resolved from a manifest list
- :fire: [NTFY] - Fix basic auth
- :fire: [UI] - Fix container filters on mobile
- :fire: [ECR] - Use link header for pagination
- :fire: Fix Passport auth
- :fire: [DOCKER-COMPOSE] - Fix services without images
- :fire: Fix txt log format
- :wrench: Update OIDC library
- :wrench: Add multi-stage UI build to Dockerfile
- :wrench: Add Playwright e2e tests

## 8.2.2
- :star: Add public Codeberg registry (codeberg.org) to the list of default supported registries
- :star: Add public Forgejo registry (code.forgejo.org) to the list of default supported registries
- :fire: Fix startup errors for some users

## 8.2.1
- :wrench: Migrate backend to typescript
- :fire: [APPRISE] - Fix bad request error ("Payload lacks minimum requirements")
- :fire: [DISCORD] - Fix bad request error ("Invalid URL")
- :fire: [NTFY] - Fix token auth
- :fire: Fix metrics related errors when Prometheus is disabled
- :fire: Fix `wud.watch.digest` not respected

## 8.2.0
- :star: Add TrueForge Container Registry support (oci.trueforge.org)
- :star: Add Codeberge registry
- :star: Allow disabling Prometheus metrics
- :star: Enable digest watching by default (except for Docker hub images)
- :star: Ensure tag candidates keep same number of semver parts
- :star: Ensure tag candidates keep same prefix
- :star: Add `wud.compose.file` supported label
- :star: Add Rocket.chat trigger
- :star: [SMTP] - Allow from address to take a display name
- :wrench: [UI] - Migrate to Vue 3
- :wrench: [UI] - Migrate to Vuetify 3
- :wrench: [UI] - Migrate to typescript
- :wrench: Upgrade to node.js 24
- :wrench: Switch to Alpine docker image
- :fire: Fix docker-compose yaml when many aliases
- :fire: Ignore `sig` tags

## 8.1.1
- :fire: [TELEGRAM] - Fix markdown character escape

## 8.1.0
- :star: Add 60s default jitter in docker watcher to avoid load spike on Docker Hub
- :star: Add support for custom TLDs in SMTP trigger
- :star: Add title to `telegram` and `slack` triggers
- :star: [UI] - Add support for [Homarr Labs](https://github.com/homarr-labs/dashboard-icons) icons
- :star: [UI] - Add support for sorting containers by oldest creation date
- :fire: Fix prerelase variable in link template

## 8.0.1
- :star: Force watcher to watch at startup only if store is empty ([#570](https://github.com/getwud/wud/issues/570))
- :fire: Fix default healthcheck when http server is disabled ([#562](https://github.com/getwud/wud/issues/556))
- :fire: Fix missing Prometheus label ([#562](https://github.com/getwud/wud/issues/562))
- :fire: [DOCKER-COMPOSE] - Fix manual update ([#546](https://github.com/getwud/wud/issues/546))

## 8.0.0
- :star: [COMMAND] - Add support for [Command](/configuration/triggers/command/) trigger
- :star: [DOCKER] - Add default healthcheck to the `wud` docker image
- :star: [PUSHOVER] - Add support for optional message TTL
- :star: [REGISTRY] - Add support for multiple registries of the same type
- :star: [TRIGGER] - Add support for automatic or manual triggers
- :star: [TRIGGER] - Improve `title`, `body` and `link` templates
- :star: [UI] - Add ability to group containers by label
- :star: New logo! :smile:
- :fire: [TRIGGER] - Fix specific triggers to specific containers association issue
- :wrench: Add prettier
- :wrench: Upgrade to node.js 23

!> **Breaking changes!** \
Registry configuration has changed; please adapt [your environment variables](/configuration/registries/) \
Internal ids has changed; your [existing state](/configuration/storage/) will be reset

## 7.2.0
- :star: [TRIGGER] - Add support for associating specific triggers to specific containers
- :star: [UI] - Some ux improvements
- :star: [UI/API] - Add support for manually running triggers to help with configuration

## 7.1.1
- :fire: [NTFY] - Fix basic/bearer authentication

## 7.1.0
- :star: [GOTIFY] - Add support for [Gotify](/configuration/triggers/gotify/) trigger
- :star: [NTFY] - Add support for [Ntfy](/configuration/triggers/ntfy/) trigger
- :star: [PUSHOVER] - Add support for HTML templating
- :fire: [UI] - Fix container list sort

## 7.0.0
- :star: [UI] - Add support for [Selfh.st](https://selfh.st/icons/) icons
- :star: [Docker watcher] - Add new `watchatstart` option to disable automatic watch during startup

!> **Breaking changes!** \
**WUD** is moving to its own organization! \
Github project is now located at [https://github.com/getwud/wud](https://github.com/getwud/wud) \
Docker image is now located at [https://hub.docker.com/r/getwud/wud](https://hub.docker.com/r/getwud/wud)

## 6.6.1
- :star: [API/UI] - Add a feature to allow/disallow delete operations (`WUD_SERVER_FEATURE_DELETE`)
- :star: [Apprise] - Add support for [Apprise persistent yaml configuration](https://github.com/caronc/apprise/wiki/config_yaml)
- :star: [DISCORD] - Add [Discord trigger](configuration/triggers/discord/)
- :star: [Docker / Docker-compose trigger] - Allow to prune old versions (except current one and candidate one)
- :star: [FORGEJO] - Add support for [Forgejo registries](/configuration/registries/forgejo/)
- :star: [GCR] - Allow anonymous access (for public images)
- :star: [GITEA] - Add support for [Gitea registries](/configuration/registries/gitea/)
- :star: [HTTP trigger] - Add support for Basic/Bearer authentication
- :star: [HTTP trigger] - Add support for Http proxy
- :star: [Mqtt trigger / Home-assistant] - Replace binary sensors by [update sensors](https://www.home-assistant.io/integrations/update/)
- :star: [MQTT] - Add home-assistant global sensors (number of containers, number of containers to update...)
- :star: [MQTT] - Prefix client id with `wud_` instead of the generic `mqttjs_` prefix 
- :star: [TELEGRAM] - Add [Telegram trigger](configuration/triggers/telegram/)
- :star: [UI] - Add dark mode
- :star: [UI] - Add filter dropdown for update kinds (major, minor...)
- :star: [UI] - Focus login input field on page load
- :star: [UI] - Make filter values bookmarkable (url query params)
- :star: [UI] - Make watcher and registry names visible when container box is collapsed
- :star: Add `watcher` placeholder visible to trigger templates  
- :star: Reduce docker image size
- :star: Upgrade all dependencies
- :star: Upgrade to node.js 18

!> **Breaking changes!** \
New Home-Assistant sensors are now created as `update` sensors instead of `binary` sensors. \
Existing Home-Assistant sensors must be manually cleaned up. \
Do not forget to adjust your existing HA configuration accordingly (automations, dashboards... if needed) 

## 5.22.1
- :star: [Docker / Docker-compose trigger] - Add dry-run feature (pull only new images)
- :star: [Docker watcher] - Add ability to listen to Docker events
- :star: [ECR] Add support for public.ecr.aws gallery
- :star: [Mqtt trigger] - Add `update` class to home-assistant devices
- :star: [Mqtt trigger] - Send mqtt message when container status change
- :star: [Mqtt trigger] Add support for (m)TLS
- :star: [Smtp trigger] - Add ability to skip tls verify
- :star: [UI] - Add PWA (Progressive Web Application) for better mobile experience
- :star: [UI] - Revamping
- :star: Add [Apprise](https://github.com/caronc/apprise) trigger
- :star: Add [CORS](configuration/server/?id=server) support
- :star: Add [Fontawesome icons](https://fontawesome.com/) and [Simple icons](https://simpleicons.org/) support
- :star: Add [Gitlab Registry](/configuration/registries/gitlab/) support
- :star: Add [HTTPS support](configuration/server/?id=server)
- :star: Add ability to customize the display of the container ([see `wud.display.name` and `wud.display.icon`](configuration/watchers/?id=label))
- :star: Add ability to specify a link pointing to the container version (changelog...) ([see here](configuration/watchers/?id=associate-a-link-to-the-container-version))
- :star: Add ability to watch all container digests (at `watcher` level)
- :star: Add Authentication system ([see here](configuration/authentications/))
- :star: Add Authentik configuration documentation
- :star: Add Container status (running, stopped...)
- :star: Add custom timeout configuration on OIDC authentication providers
- :star: Add Docker Compose examples to the documentation
- :star: Add Docker Compose Trigger ([see here](configuration/triggers/docker-compose/))
- :star: Add Docker Trigger ([see here](configuration/triggers/docker/))
- :star: Add Github Container Registry support
- :star: Add Hotio Registry support
- :star: Add LinuxServer Container Registry support (lscr.io)
- :star: Add OIDC auto redirect capabilities
- :star: Add Openid Connect authentication ([see here](configuration/authentications/oidc/))
- :star: Add Quay Registry support (quay.io)
- :star: Add support for [custom registries](configuration/registries/custom/)
- :star: Add support for `prerelease` placeholder in link templates
- :star: Add Trigger configurable threshold ([see here](configuration/authentications/triggers/))
- :star: Add Trigger configuration to be able to transform tags before performing the analysis ([see here](configuration/watchers/?id=transform-the-tags-before-performing-the-analysis))
- :star: Add Trigger configuration to customize title / body templates
- :star: Add Trigger configuration to fire container updates individually or to fire all container updates as 1 batch
- :star: Add Trigger configuration to ignore/repeat previous updates
- :star: Allow excluding specific containers from being watched
- :star: Allow to externalize [secrets to external files](/configuration/?id=secret-management) 
- :star: Automatically enable digest watching for non semver tags
- :star: Digest management optimizations
- :star: Embed Material Design icons & Google fonts in UI for offline access
- :star: Enable by default all registries with possible anonymous access (hub, ghcr, quay)
- :star: Highlight containers in UI when new digest
- :star: Improve code coverage
- :star: Improve logs
- :star: Push wud image to ghcr.io in addition to docker hub
- :star: Support TZ env var for local time configuration
- :star: Update all dependencies
- :star: Upgrade to nodejs 16
- :star: Watch individual containers instead of images

!> **Breaking changes!** \
WUD is now **container centric** instead of image centric. \
The data model changed, the API changed, some integrations changed... \
Please take a look at the documentation before upgrading to analyse all potential impacts on your integrations.

## 4.1.2
- :star: Add Container name
- :star: Add Log format (text by default instead of json)
- :star: Add Option to watch all containers (not only the running ones)
- :star: Add Support for Non Semver image versions
- :star: Add TLS support for Remote Docker API over TCP
- :star: Add WUD current version in the logs

## 3.5.0
- :star: Add [Home-Assistant](https://www.home-assistant.io/) MQTT integration
- :star: Add Prometheus metrics & HealthCheck endpoint
- :star: Add Pushover trigger
- :star: Add Registry Concept & ACR / ECR / GCR / Docker Hub (private repositories) implementations
- :star: Load local assets instead of relying on external CDN
- :star: Support sha256 image references
- :star: Update all dependencies

## 2.3.1
- :star: Add REST API
- :star: Add support for Docker Hub private repositories
- :star: Add UI
- :star: Update dependencies
- :star: Upgrade to Node.js 14

## 1.0.0
- :star: Yeah!
