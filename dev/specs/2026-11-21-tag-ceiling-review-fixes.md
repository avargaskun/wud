# Tag ceiling — review fixes (PR #48)

## Intent

Fix the review findings on the version-ceiling PR (#48) before it merges, on the same branch:
the dynamic ceiling must agree with `wud.tag.transform`, its errors must say what actually went
wrong, its per-cycle memo must not be shared across watchers, its logs must not be noisy, and its
real-registry path must be covered end to end.

## Goals

1. **Transform symmetry.** A dynamic ceiling's resolved label is passed through the container's
   `wud.tag.transform` before validation and comparison, exactly like the tag candidates it caps.
2. **Precise errors.** A dynamic ceiling that fails because no manifest matches the container's
   platform (or the manifest is schema v1, or has no config) reports that cause, not "no version label".
3. **No shared memo, and one that works.** The dynamic-ceiling memo lives for one `watch()` call of one
   watcher, and containers resolved concurrently within that scan share one in-flight registry lookup.
4. **Quiet success.** Successful ceiling resolution logs at `debug`; failures stay at `warn`.
5. **E2E coverage of the dynamic path**, both the success and the fail-closed case, against a real registry.

## Non-goals

- Docker Hub rate-limit documentation (review finding 2) — out of scope.
- Cross-container `getTags` dedupe (the remaining half of #47) and label-less resolution (#46).
- Transforming the static `wud.tag.ceiling.version` value.

## Anti-goals

- Any change to trigger, threshold, bucket or `updatesSignature` behaviour.
- Containers sharing an image and ceiling tag but using different transforms leaking each other's
  resolved ceiling.

## Approaches

Each finding had one sensible fix; alternatives considered and dropped:

- **Transform (1).** Chosen: memoize the *raw* label, apply the per-container transform after the
  memo. Dropped: caching the transformed value with the transform in the key (more keys, same result);
  transforming the static value too (users already write it in the compared, transformed space).
- **Errors (3).** Chosen: `Registry.getImageVersionLabel` throws a specific `Error` for structural
  failures and returns `undefined` only when the config blob lacks the label; `resolveCeiling` already
  wraps thrown messages as `Could not resolve ceiling tag [<tag>]: <message>`. Dropped: a discriminated
  return type (more surface for the same information).
- **Memo scope (4).** Chosen: `Docker.watch()` creates a local `Map` and passes it through
  `watchContainer(container, ceilingCache?)` → `findNewVersion(..., ceilingCache?)` →
  `resolveCeiling(..., ceilingCache?)`; event-driven watches pass none (no memo). `resetCeilingCache`
  and the module-level map are removed. Dropped: an instance field reset in `watch()` (overlapping
  cron and debounced scans on one watcher would clobber it); per-watcher keys in the module map
  (still shared mutable state).
- **E2E (6).** Chosen: pinned podinfo tags carry `org.opencontainers.image.version` equal to the tag
  (verified live on GHCR for 6.0.0–6.5.0), so a pinned tag as the ceiling tag is deterministic.

## Design

### 1. Transform symmetry
- `resolveCeiling` memoizes only the registry outcome — `{ label }` (raw) or `{ error }` (registry
  failure or missing label) — per `registryUrl|imageName|ceilingTag`. Validation is never memoized: it
  depends on each container's transform.
- After the memo, per container: `transformed = transformTag(container.transformTags, label)`; validate
  with `isValidCeiling(transformed)`; `ceiling = { tag, version: normalizeCeiling(transformed) }`.
- Invalid after transform → fail closed with
  `Could not resolve ceiling tag [<tag>]: value [<raw>] is not a valid semver` when the transform left
  the value unchanged (or none is set), and
  `... value [<raw>] (transformed to [<transformed>]) is not a valid semver` when it changed it.
- `container.ceiling.version` exposes the transformed value (the effective ceiling actually compared).
- `transform()` already falls back to the raw value (with a warn) when the regex does not match; kept.
- Docs: state that the dynamic ceiling's label goes through `wud.tag.transform`, and that the static
  value is compared as written.

### 2. Precise errors
`getImageVersionLabel` throws:
- schema v1 → `manifest for [<tag>] is schema v1 and carries no labels`
- index with no matching platform → `no manifest for platform [<os>/<arch>[/<variant>]] in [<tag>]`
- no config digest → `manifest for [<tag>] has no image config`

Returns `undefined` only when the config blob has no `org.opencontainers.image.version` label.
A falsy manifest response is treated like the no-config case.

### 3. Memo scope
As in Approaches. `findNewVersion` keeps its current parameters, plus an optional trailing
`ceilingCache?: CeilingCache`. Without one, every call resolves fresh.

The memo stores the **in-flight promise**, not the settled result:
`CeilingCache = Map<string, Promise<CeilingLookup>>`. `watch()` starts every container concurrently
(`Promise.all`), so a result-only memo misses for every container sharing an image — each checks before
any lookup has settled. Storing the promise on first miss makes concurrent containers await the same
lookup (the same pattern as `Registry.tagListsInFlight`). The promise never rejects: registry failures
resolve to `{ error }`, so a failure is shared exactly like a success. This also makes the documented
cost ("containers sharing both are resolved once per cycle") true.

### 4. Logs
`Ceiling set to …` (static) and `Ceiling resolved to …` (dynamic) move to `debug`. Failure messages stay at `warn`.

### 5. E2E
Two new fixtures in `scripts/setup-test-containers.sh` (with `--pull=never`), both
`ghcr.io/stefanprodan/podinfo:6.0.0`, `wud.tag.include=^6\.\d+\.\d+$`:
- `zz_ceiling_dynamic`: `wud.tag.ceiling=6.1.0` → `ceiling = {tag: "6.1.0", version: "6.1.0"}`,
  `updates.minor.remoteValue = 6.1.0`, `updates.patch` = latest `6.0.x` (resolved via the oracle),
  `updates.major` exactly null, no `error`.
- `zz_ceiling_unresolvable`: `wud.tag.ceiling=does-not-exist` → `error.message` contains
  `Could not resolve ceiling tag [does-not-exist]`, `ceiling` absent, `updates.patch/minor/major` exactly null.

Also: add both to `scripts/cleanup-test-containers.sh`, the setup summary count and grep, and bump
the `/api/containers` length assertion from 31 to 33.

## Left to the builder

- Exact test names and fixture layout in the unit specs.
- Whether the memo type is exported from `utils.ts` or inlined.
