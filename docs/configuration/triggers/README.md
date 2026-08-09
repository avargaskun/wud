# Triggers

Triggers are responsible for performing actions when a new container version is found.
  
Triggers are enabled using environment variables.

```bash
WUD_TRIGGER_{{ trigger_type }}_{{trigger_name }}_{{ trigger_configuration_item }}=XXX
```

!> Multiple triggers of the same type can be configured (for example multiple Smtp addresses).  
You just need to give them different names.

?> See the _Triggers_ subsection to discover which triggers are implemented and how to use them.

### Common trigger configuration
All implemented triggers, in addition to their specific configuration, also support the following common configuration variables.

| Env var                                                 |    Required    | Description                                                                                   | Supported values                                                                                                        | Default value when missing                                                                                                                                                                          |
|---------------------------------------------------------|:--------------:|-----------------------------------------------------------------------------------------------|----------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `WUD_TRIGGER_{trigger_type}_{trigger_name}_AUTO`        | :white_circle: | `true` to automatically execute the trigger. `false` to manually execute it (from UI, API...) | `true`, `false`                              | `true`                                                                                                                                                                                                                                                                         |
| `WUD_TRIGGER_{trigger_type}_{trigger_name}_BATCHTITLE`  | :white_circle: | The template to use to render the title of the notification (batch mode)                      | String template with placeholders `${count}` | `${containers.length} updates available`                                                                                                                                                                                                                                       |
| `WUD_TRIGGER_{trigger_type}_{trigger_name}_INCLUDEBYDEFAULT` | :white_circle: | `true` to associate the trigger with containers that do not define `wud.trigger.include`. `false` to require explicit inclusion with `wud.trigger.include` | `true`, `false` | `true` |
| `WUD_TRIGGER_{trigger_type}_{trigger_name}_MODE`        | :white_circle: | Trigger for each container update or trigger once with all available updates as a list        | `simple`, `batch`                            | `simple`                                                                                                                                                                                                                                                                       |
| `WUD_TRIGGER_{trigger_type}_{trigger_name}_ONCE`        | :white_circle: | Run trigger once (do not repeat previous results)                                             | `true`, `false`                              | `true`                                                                                                                                                                                                                                                                         |
| `WUD_TRIGGER_{trigger_type}_{trigger_name}_SIMPLEBODY`  | :white_circle: | The template to use to render the body of the notification                                    | JS string template with vars `container`     | `Container ${container.name} running with ${container.updateKind.kind} ${container.updateKind.localValue} can be updated to ${container.updateKind.kind} ${container.updateKind.remoteValue}${container.result && container.result.link ? "\\n" + container.result.link : ""}` |
| `WUD_TRIGGER_{trigger_type}_{trigger_name}_SIMPLETITLE` | :white_circle: | The template to use to render the title of the notification (simple mode)                     | JS string template with vars `${containers}` | `New ${container.updateKind.kind} found for container ${container.name}`                                                                                                                                                                                                       |
| `WUD_TRIGGER_{trigger_type}_{trigger_name}_THRESHOLD`   | :white_circle: | The threshold to reach to run the trigger                                                     | `all`, `major`, `major-only`, `minor`, `minor-only`, `patch`, `digest`             | `all`                                                                                                                                                                                                                                                                          |

?> Threshold `all` means that the trigger will run regardless of the nature of the change

?> Threshold `major` means that the trigger will run only if this is a `major`, `minor` or `patch` semver change 

?> Threshold `major-only` means that the trigger will run only if this is a `major` semver change

?> Threshold `minor` means that the trigger will run only if this is a `minor` or `patch` semver change

?> Threshold `minor-only` means that the trigger will run only if this is a `minor` semver change

?> Threshold `patch` means that the trigger will run only if this is a `patch` semver change

?> Threshold `digest` means that the trigger will run only for a digest rebuild of the tag the container already runs — no tag change is ever installed

?> `WUD_TRIGGER_{trigger_type}_{trigger_name}_ONCE=false` can be useful when `WUD_TRIGGER_{trigger_type}_{trigger_name}_MODE=batch` to get a report with all pending updates.

?> `WUD_TRIGGER_{trigger_type}_{trigger_name}_INCLUDEBYDEFAULT=false` makes a trigger opt-in: the trigger will only be associated with containers explicitly listing it in `wud.trigger.include`.

### Threshold and multiple available updates

WUD detects **every** available update for a container, split by kind (`major`, `minor`, `patch` and `digest`), not only the highest one.

> The threshold is a **ceiling on the eligible update kinds**. The trigger fires if **any** eligible kind has an update available, and it installs the **highest eligible** one.

| Threshold                                     | `major` | `minor` | `patch` | `digest` |
| --------------------------------------------- | :-----: | :-----: | :-----: | :------: |
| `all`                                         |    ✓    |    ✓    |    ✓    |    ✓     |
| `major`                                       |    ✓    |    ✓    |    ✓    |    ✓     |
| `minor`                                       |    ✗    |    ✓    |    ✓    |    ✓     |
| `patch`                                       |    ✗    |    ✗    |    ✓    |    ✓     |
| `major-only`                                  |    ✓    |    ✗    |    ✗    |    ✓     |
| `minor-only`                                  |    ✗    |    ✓    |    ✗    |    ✓     |
| `digest`                                      |    ✗    |    ✗    |    ✗    |    ✓     |

?> A `digest` update is eligible at **every** threshold, including `digest` itself — the one threshold at which it is the **only** eligible kind. A `digest` threshold installs digest rebuilds and nothing else, while `major`, `minor` and `patch` updates keep being detected and displayed.

!> **`digest-only` is not a valid threshold.** Unlike `major-only` and `minor-only`, there is a single spelling — `digest` — and `wud.trigger.include=docker.update:digest-only` fails closed exactly like a typo: the trigger is not associated with the container and only a `warn` log is emitted.

?> On a **semver** tagged container the `digest` bucket only exists when the container carries `wud.watch.digest.semver=true` (see the [Watchers](/configuration/watchers/) documentation). Without that label a `digest` threshold selects nothing and the trigger is a silent no-op.

?> A `prerelease` update counts as a `patch` update.

!> A higher update no longer **masks** a lower one. A container running `1.2.3` with both `1.2.4` and `2.0.0` available and a `patch` threshold now installs `1.2.4`; previously the `major` change was the only one considered and the trigger never ran. Containers that were silently never updating will start updating.

?> The WebUI keeps displaying the **highest** available update, so with a threshold other than `all` the version actually installed may be a lower one.

### Per container threshold

The threshold can be overridden per container with the `wud.trigger.include` label, using the `$trigger_id:$threshold` syntax (see the [Watchers](/configuration/watchers/) documentation).

!> **An invalid threshold in `wud.trigger.include` is now rejected and the entry fails closed.** `wud.trigger.include=docker.update:pacth` no longer silently degrades to `all` — the trigger is simply **not** associated with that container and a `warn` log is emitted. Failing open was dangerous: a typo on an auto-updating trigger authorised every `major` update.

?> The threshold token is matched **case-insensitively**, so `docker.update:Patch` and `docker.update:patch` are equivalent. The trigger **id** before the colon is still matched case-sensitively and must match the trigger's `type.name` exactly.

!> A threshold on `wud.trigger.exclude` has always been meaningless (an exclusion is unconditional) and now emits a `warn` log. The container is excluded either way.

!> **A malformed entry with more than one colon also fails closed.** `wud.trigger.include=docker.update:patch:minor` is rejected exactly like a typo — everything after the first colon is treated as the threshold token, which then matches nothing. Only one threshold per entry is supported; list multiple triggers by separating them with commas instead, e.g. `wud.trigger.include=docker.update:patch,smtp.gmail:minor`.

?> **Where these warnings appear.** They are emitted from the trigger's `apply()` check, which runs both on every watch cycle *and* whenever the container's triggers are read through the API — which the Web UI does each time you expand a container card. Expect the same warning to recur rather than appear once; that is deliberate, since the log is the only place a rejected threshold is reported.

### Examples

<!-- tabs:start -->
#### **Docker Compose**
```yaml
services:
  whatsupdocker:
    image: getwud/wud
    ...
    environment:
      - WUD_TRIGGER_SMTP_GMAIL_SIMPLETITLE=Container $${container.name} can be updated
      - WUD_TRIGGER_SMTP_GMAIL_SIMPLEBODY=Container $${name} can be updated from $${local.substring(0, 15)} to $${remote.substring(0, 15)}
```
#### **Docker**
```bash
docker run \
  -e 'WUD_TRIGGER_SMTP_GMAIL_SIMPLETITLE=Container ${container.name} can be updated' \
  -e 'WUD_TRIGGER_SMTP_GMAIL_SIMPLEBODY=Container ${name} can be updated from ${local.substring(0, 15)} to ${remote.substring(0, 15)}'
  ...
  getwud/wud
```
<!-- tabs:end -->
