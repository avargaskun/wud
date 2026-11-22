# Registries

WUD supports most registries:

- [**ACR** (Azure Container Registry)](configuration/registries/acr/)

- [**CUSTOM** (Self-hosted Registry)](configuration/registries/custom/)

- [**ECR** (Amazon Elastic Container Registry)](configuration/registries/ecr/)

- [**FORGEJO** (Forgejo Container Registry)](configuration/registries/forgejo/)

- [**GCR** (Google Container Registry)](configuration/registries/gcr/)

- [**GHCR** (Github Container Registry)](configuration/registries/ghcr/)

- [**GITEA** (Gitea Container Registry)](configuration/registries/gitea/)

- [**GITLAB (Gitlab Container Registry)**](configuration/registries/gitlab/)

- [**HUB** (Docker Hub)](configuration/registries/hub/)

- [**LSCR** (LinuxServer Container Registry)](configuration/registries/lscr/)

- [**TrueForge** (TrueForge OCI Registry)](configuration/registries/trueforge/)

- [**Quay**](configuration/registries/quay/)

?> By default, without any further configuration, WUD is handling _out-of-the-box_ public images hosted on \
CODEBERG (codeberg.org)
ECR (public.ecr.aws) \
FORGEJO (code.forgejo.org)
GCR \
GHCR \
HUB \
QUAY

### Incremental tag listing

Only **GHCR** and **LSCR** support fetching just the tags added since the previous cycle
(`WUD_REGISTRY_GHCR_{REGISTRY_NAME}_INCREMENTALTAGS` / `WUD_REGISTRY_LSCR_{REGISTRY_NAME}_INCREMENTALTAGS`).
Every other registry lists the whole repository on every cycle.

The requirement is that the registry lists tags in creation order (so the list only ever grows at the
end) and that the `last=` pagination parameter resolves an exact position rather than acting as a
lexical filter:

| Registry | List ordering | `last=` semantics | Incremental viable |
|---|---|---|---|
| `ghcr.io` | creation order, append-only | positional (exact match) | Yes |
| `lscr.io` | creation order (GHCR-backed) | positional (exact match) | Yes |
| `registry-1.docker.io` (HUB) | lexical | lexical filter | No |
| `quay.io` | collated lexical | lexical filter | No |
| `registry.gitlab.com` | lexical | lexical filter | No |
| `codeberg.org` / FORGEJO / GITEA | lexical | lexical filter | No |
| `oci.trueforge.org` | lexical | lexical filter | No |
| `gcr.io` | whole list in one response | n/a | n/a — already a single request |
| `public.ecr.aws` | opaque cursor | opaque token only, arbitrary values rejected | No |
| ACR | lexical | lexical filter | No |

A lexical `last=` cannot be used as a watermark: a newly pushed tag can sort *before* the remembered
one, so it would fall outside every subsequent page and be missed permanently.

By default, the remembered position lives in memory only, so a restart discards it and the next
cycle lists every repository in full. Set `WUD_TAGCACHE_ENABLED` to `true` to persist it across
restarts — see the [tag cache](/configuration/storage/?id=tag-cache) documentation.
