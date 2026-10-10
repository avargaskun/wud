# Retry image pulls and reject failed pull streams

- **Issue:** [#67](https://github.com/avargaskun/wud/issues/67)
- **Builds on:** [#59](https://github.com/avargaskun/wud/issues/59) — [`2026-09-20-registry-retry.md`](2026-09-20-registry-retry.md)
- **Date:** 2026-10-09
- **Release type:** `fix:`

## Problem

#59 made `Registry.callRegistry` retry throttled and transient responses. The image pull in the `docker`
/ `dockercompose` triggers takes a different path — `Docker.pullImage` → `dockerode.pull`, i.e. the
Docker daemon talks to the registry — and makes exactly one attempt. A single GHCR 429 asking for a wait
of 306 µs failed a two-member batch trigger and cost it a full update cycle:

```
WARN  trigger.dockercompose.default: Error when pulling image ghcr.io/immich-app/immich-machine-learning:v3.3.1-openvino ((HTTP code 429) unexpected - toomanyrequests: retry-after: 306.189µs, allowed: 44000/minute )
```

`pullImage` has a second defect. It passes the promise's `resolve` as `followProgress`'s
`onFinished(err, output)` callback. In docker-modem 5.0.7:

- a stream `error` event calls `onFinished(err, output)`, which **resolves** the promise with `err`, so
  the `catch` never runs;
- a pull that fails partway (`{"error": "...", "errorDetail": {...}}` in the progress stream: blob 429 /
  5xx, digest mismatch, full disk) is pushed onto `output` and the stream ends normally with
  `onFinished(null, output)`.

Either way WUD logs `Image … pulled with success` and proceeds to the swap. The failure surfaces only at
container create, after the old container is stopped; in a batch the other members have already been
swapped. The pull phase is meant to be the barrier that prevents this.

## Scope

In scope:

1. A failed pull — stream error or error line in the progress output — rejects `pullImage`.
2. Bounded retry of throttled and transient pull failures, with the #59 policy.
3. One retry loop shared by `callRegistry` and `pullImage`.
4. Pull retries observable: debug line everywhere, Prometheus counter on the controller.

Out of scope:

- Changing the #59 policy (attempts, floor, cap, statuses).
- Retrying errors with no status and no recognisable text (daemon socket unreachable, reset). Same
  reasoning as #59.
- docker-modem's `JSON.parse` of progress lines throwing inside its `data` handler on a malformed line.
  Not observed.
- Batch semantics. Retries happen inside each member's pull; a member that exhausts them still aborts
  the batch with no swap.

## Design

### 1. Shared policy — `app/registries/retry.ts`

The file stays pure: no timers, I/O or logging. `sleep` and `random` are injected. `MAX_ATTEMPTS`,
`FLOOR_MS`, `CAP_MS`, the retryable statuses (429, 502, 503, 504) and `computeDelay` are unchanged.

```ts
export interface RetryHint { ms: number; source: 'header' | 'body' | 'message' }
export interface RetryDecision { status: number; hint?: RetryHint }
export type RetryClassifier = (error: unknown) => RetryDecision | undefined;
export interface RetryEvent { error: unknown; attempt: number; delay: number; decision: RetryDecision }

export async function withRetry<T>(
    attemptFn: () => Promise<T>,
    options: {
        classify: RetryClassifier;
        onRetry: (event: RetryEvent) => void;
        sleep: (ms: number) => Promise<void>;
        random?: () => number;
    },
): Promise<T>;
```

`withRetry` loop, for `attempt = 1..MAX_ATTEMPTS`:

```
try:   return await attemptFn()
catch: decision = attempt < MAX_ATTEMPTS ? classify(error) : undefined
       delay    = decision ? computeDelay(attempt, decision.hint?.ms, random) : undefined
       if delay === undefined: throw error            // unchanged original error
       onRetry({ error, attempt: attempt + 1, delay, decision })
       await sleep(delay)
```

`attempt` in `RetryEvent` is the number of the attempt about to run, matching the current
`attempt n/4` log text. The final WARN is the caller's job, so each keeps its own wording.

New exports alongside the existing ones:

- **`parseDurationHint(text: string): number | undefined`** — the Go-duration parser extracted from
  `parseBodyHint`: finds `retry-after:` followed by one or more `<number><unit>` tokens anywhere in the
  string and sums them. `parseBodyHint` keeps stringifying `response.data` and delegates to it.
- **`classifyHttpError(error): RetryDecision | undefined`** — `undefined` unless `isRetryable(error)`;
  otherwise `{ status: response.status, hint: parseRetryHint(error) }`. `isRetryable`, `parseRetryHint`
  and `getErrorResponse` stay exported and unchanged.
- **`formatRetryMessage(event: RetryEvent): string`** —
  `Retrying in <delay> ms (attempt <n>/<MAX_ATTEMPTS>, status <s>, hint <ms> ms from <source>)`, or
  `hint none`. The registry path must produce exactly today's text.

### 2. Pull classifier — `app/triggers/providers/docker/pullRetry.ts` (new)

`classifyPullError(error): RetryDecision | undefined` knows dockerode and daemon text, not registries,
so it lives beside the trigger. In order:

1. `error.statusCode` is a number in {429, 502, 503, 504} → that status.
2. Otherwise, if the error is a `PullError` or has any numeric `statusCode`, match its text
   (`error.json?.message ?? error.message`). The daemon commonly wraps an upstream registry failure in
   a **500** whose text carries the real cause (`received unexpected HTTP status: 503 Service
   Unavailable`), so a 500 is classified by text, not rejected outright:
   - `/toomanyrequests/i` → 429
   - `/HTTP status:?\s*(502|503|504)\b/` → that status
3. Anything else → `undefined` (fail fast): `manifest unknown`, `unauthorized`, `no space left on
   device`, digest mismatch, and errors with no `statusCode` that are not a `PullError` (e.g.
   `ECONNREFUSED` on the daemon socket).

The hint is `parseDurationHint(text)` with `source: 'message'`, when present.

### 3. `PullError` — `app/triggers/providers/docker/errors.ts`

```ts
export class PullError extends Error {
    readonly image: string;
    readonly detail?: { code?: number; message?: string };
}
```

`message` is `errorDetail.message ?? error` from the first progress entry carrying `error` or
`errorDetail`; `name` is `'PullError'`, as with the sibling classes.

### 4. `Docker.pullImage` — `app/triggers/providers/docker/Docker.ts`

`Dockercompose` inherits it; no change there.

```ts
async pullImage(dockerApi, auth, newImage, logContainer): Promise<void> {
    logContainer.info(`Pull image ${newImage}`);
    try {
        await withRetry(() => this.pullOnce(dockerApi, auth, newImage), {
            classify: classifyPullError,
            onRetry: (event) => {
                logContainer.debug(`Error when pulling image ${newImage} (${errorMessage(event.error)})`);
                logContainer.debug(formatRetryMessage(event));
                this.countPullRetry(event.decision.status);
            },
            sleep: (ms) => this.sleep(ms),
        });
        logContainer.info(`Image ${newImage} pulled with success`);
    } catch (e) {
        logContainer.warn(`Error when pulling image ${newImage} (${errorMessage(e)})`);
        throw e;
    }
}
```

- **`pullOnce(dockerApi, auth, newImage)`** — `dockerApi.pull(newImage, { authconfig: auth })`, then
  `followProgress` with a callback that rejects with `err` when set, rejects with a `PullError` when any
  entry of `output ?? []` has `error` or `errorDetail`, and resolves only otherwise. The `?? []` keeps
  the existing test mocks (`followProgress: (stream, res) => res()`) valid.
- **`errorMessage(error)`** — module-local: `error instanceof Error ? error.message : String(error)`,
  replacing today's untyped `e.message` on a `catch (e: any)`.
- **Each retry repeats the whole pull.** The daemon keeps layers it already has, so a retry fetches only
  what is missing.
- **`protected sleep(ms)`** — unref'ed `setTimeout`, mirroring `Registry.sleep`; tests override it.
  Not shared with `Registry` so `retry.ts` stays timer-free.
- **`countPullRetry(status)`** — `getPullRetryCounter()?.inc({ type: this.type, name: this.name, status:
  String(status) })`. Does **not** call `recordRetry()`: automatic triggers can fire during a watch, and
  the watcher's `Cron finished … N registry retries` field must keep counting registry API retries only.
- Logging: `pulled with success` only after a clean stream; WARN exactly once, on final failure; a
  recovered retry logs at `debug` only.
- `triggerBatch`'s `Promise.all` pull barrier, dry-run (which still pulls) and the single-container
  `trigger` (which routes through `triggerBatch([container])`) are unchanged.

### 5. `Registry.callRegistry` — `app/registries/Registry.ts`

Same behaviour, now on `withRetry`:

```ts
try {
    return await withRetry(async () => {
        const start = new Date().getTime();
        try {
            const response = (await this.axiosInstance(axiosOptionsWithAuth)) as AxiosResponse<T>;
            this.observePrometheusSummaryTags(start);
            return resolveWithFullResponse ? response : response.data;
        } catch (error) {
            this.observePrometheusSummaryTags(start);
            throw error;
        }
    }, {
        classify: classifyHttpError,
        onRetry: (event) => {
            logAxiosError(this.log, event.error, 'debug');
            this.log.debug(formatRetryMessage(event));
            this.countRetry(event.decision.status);
        },
        sleep: (ms) => this.sleep(ms),
    });
} catch (error) {
    logAxiosError(this.log, error, 'warn');
    throw error;
}
```

`authenticate` still runs once, before the loop. The per-attempt summary observation,
`wud_registry_retry_count` + `recordRetry()`, and every debug / WARN line are unchanged.
`Registry.retry.test.ts` must pass without modification.

### 6. Observability — `app/prometheus/pull.ts` (new)

Mirrors `prometheus/postupdate.ts`:

- `Counter` `wud_trigger_pull_retry_count{type, name, status}` — `type` / `name` are the trigger's
  (`dockercompose` / `default`), `status` the classified status. Incremented once per retry.
- `init()` registers it and replaces it on re-init; called from `prometheus/index.ts`.
- `getPullRetryCounter()` is `undefined` in agent mode (agents run docker triggers but have no
  Prometheus); `countPullRetry` guards with `?.`. On agents the debug line is the only signal, as in #59.

A sibling metric rather than reusing `wud_registry_retry_count`: that counter means "requests WUD itself
sent"; pulls go through the daemon with its own credentials and throttling.

**Docs.** `docs/monitoring/README.md` gains the metric in the sample output and its own `####` entry.
`docs/changelog/README.md` gains an entry: pull retries (statuses, up to 3 retries) and that a failed
pull stream now fails the trigger before any swap.

## Files

| file | change |
|---|---|
| `app/registries/retry.ts` | `withRetry`, `classifyHttpError`, `parseDurationHint`, `formatRetryMessage`, `RetryDecision` / `RetryEvent`, `'message'` hint source |
| `app/registries/Registry.ts` | `callRegistry` on `withRetry`, behaviour unchanged |
| `app/triggers/providers/docker/pullRetry.ts` | new — `classifyPullError` |
| `app/triggers/providers/docker/errors.ts` | `PullError` |
| `app/triggers/providers/docker/Docker.ts` | `pullImage` on `withRetry`, `pullOnce`, `sleep`, `countPullRetry` |
| `app/prometheus/pull.ts`, `app/prometheus/index.ts` | new counter, registered in `init` |
| `docs/monitoring/README.md`, `docs/changelog/README.md` | document metric and behaviour |

## Testing

TDD. New test files are typed (no `@ts-nocheck`).

**`app/registries/retry.test.ts`** (extended)

- `withRetry`: resolves on attempt 1 with no sleep; 429→ok → one sleep, `onRetry` gets `attempt: 2`;
  429 ×4 → rethrows the last error after three sleeps; non-retryable → rethrows, no sleep; hint over
  `CAP_MS` → rethrows, no sleep; `random` is passed through to `computeDelay`.
- `parseDurationHint`: the GHCR text from the issue, both micro-sign code points, compound `1m30s`, no
  hint → `undefined`.
- `classifyHttpError` agrees with `isRetryable` + `parseRetryHint`.
- `formatRetryMessage`: exact strings for header, body, message and no hint.

**`app/triggers/providers/docker/pullRetry.test.ts`** (new) — `classifyPullError`:

- `statusCode: 429` + the issue's message → `{ status: 429, hint ≈ 0.306 ms, source 'message' }`.
- `statusCode: 503` → 503.
- `statusCode: 500` + `received unexpected HTTP status: 503 Service Unavailable` → 503.
- `statusCode: 500` + `toomanyrequests` → 429.
- `PullError` `toomanyrequests: …` → 429.
- `undefined` for: 404 `manifest unknown`, 401 `unauthorized`, `PullError` `no space left on device`,
  `PullError` digest mismatch, `ECONNREFUSED` (no status, not a `PullError`).

**`app/triggers/providers/docker/Docker.test.ts`** (extended; `sleep` stubbed)

- `followProgress` calls back with `err` → `pullImage` rejects; no `pulled with success`.
- Output ends with `{ error, errorDetail }` → rejects with `PullError`; no `pulled with success`.
- 429→ok → resolves, one sleep, no WARN, counter incremented with the trigger's `type` / `name` and
  `status="429"`, `recordRetry` not called.
- 401 → one attempt, one WARN.
- `triggerBatch`, one member 429 ×4 → rejects; no container stopped, removed or created.
- `triggerBatch`, one member 429→ok → every member swapped.

**`app/registries/Registry.retry.test.ts`** — unchanged and green: the regression gate for §5.

**`app/prometheus/pull.test.ts`** (new) — counter registered with the right name and labels, replaced on
re-init.

**Gates:** `npm test`, `npm run lint`, `npx tsc --noEmit` in `app/`; the e2e suite once before the PR
(trigger behaviour changed). No new e2e scenario: a real registry cannot be made to return 429 or emit a
failing progress line on demand, and the unit tests script the dockerode layer exactly.

## Acceptance criteria (from #67)

| criterion | covered by |
|---|---|
| A 429 with `retry-after` under `CAP_MS` is retried and succeeds, no trigger error | `Docker.test.ts` 429→ok |
| A non-retryable error (`manifest unknown`, 401) fails on the first attempt | `Docker.test.ts` 401; `pullRetry.test.ts` |
| A progress stream with an `error` line rejects, no `pulled with success`, no swap | stream-error test + batch tests |
| In `triggerBatch`, a member exhausting retries aborts the batch with no swap | `triggerBatch` 429 ×4 |
| Unit tests for dockerode-shaped errors and a stream ending in an error entry | `pullRetry.test.ts` + stream tests |
