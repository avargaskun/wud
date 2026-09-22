# Retry throttled and transient registry responses

- **Issue:** [#59](https://github.com/avargaskun/wud/issues/59)
- **Follow-up (out of scope here):** [#62](https://github.com/avargaskun/wud/issues/62) — per-registry concurrency limit, watcher jitter / scheduling guidance
- **Date:** 2026-09-20
- **Release type:** `fix:`

## Problem

`Registry.callRegistry` makes exactly one attempt per request. Any HTTP 429 is thrown to the watcher,
which publishes the container with `updateAvailable=false` plus an `error` field for the whole watch
cycle. Consumers that read only `updateAvailable` cannot tell "up to date" from "the registry throttled
us".

On GHCR this happens nightly for scans that start in the first minute of the hour, with the registry
asking for a wait of under one millisecond
(`"retry-after: 982.701µs, allowed: 44000/minute"`). It is not caused by the instance's own volume: an
81 % cut in requests (#53, #47) moved scheduled-scan errors from 14 to 9. A transient Docker Hub 502 on
a tag list has nulled a container's result the same way.

## Scope

In scope (issue items 1–3):

1. Bounded retry of throttled and transient responses inside `callRegistry`.
2. WARN only once retries are exhausted; a recovered retry is `debug`.
3. Retry counts observable: a Prometheus counter on the controller, a field in the `Cron finished` line
   everywhere (the agent has no `/metrics`).

Out of scope:

- Per-registry concurrency limit; watcher jitter default; ":00" scheduling docs → #62.
- Retrying errors without an HTTP response (DNS, reset, timeout). Not observed; a registry that is down
  would cost every container the full backoff budget each scan.
- Retrying the token requests providers make with bare `axios(...)` inside `authenticate` (GCR, GitLab,
  …). The observed 429s are on `tags/list` and `manifests`.
- Configurability. The policy is fixed constants; a knob can be added later without breaking anything.
- Redacting the `Authorization` header from the existing "Request headers" log line. Behaviour is kept
  as is; worth its own issue.

## Design

### 1. Retry policy — `app/registries/retry.ts` (new, pure)

No I/O, timers or logging. `random` and `now` are injectable so tests are deterministic.

| constant | value |
|---|---|
| `MAX_ATTEMPTS` | 4 (1 try + 3 retries) |
| `FLOOR_MS` | 250 |
| `CAP_MS` | 30 000 |
| retryable statuses | 429, 502, 503, 504 |

**`isRetryable(error): boolean`** — true only for an axios error with a `response` whose status is in
the set. 500 is excluded (on registries it usually means a real, repeatable fault). Every request
`callRegistry` makes is `GET`/`HEAD`, so retrying is safe.

**`parseRetryHint(error, now = Date.now()): { ms: number; source: 'header' | 'body' } | undefined`**

1. `Retry-After` header: delta-seconds (`"2"`), or an HTTP date converted to `date − now` and clamped
   at 0.
2. Otherwise the response body: stringify `response.data`, find `retry-after:` followed by a Go
   duration — one or more `<number><unit>` tokens, units `ns`, `us`, `µs` (U+00B5), `μs` (U+03BC), `ms`,
   `s`, `m`, `h`, summed (Go prints compounds such as `1m30s`).
3. Unparseable, negative or NaN → `undefined`. `HEAD` responses have no body and rely on the header or
   the fallback.

Whether GHCR also sends the header on a 429 is unknown — its 200 responses carry no rate-limit headers
at all. Header-first means it is used automatically if present.

**`computeDelay(retryNumber, hintMs?, random = Math.random): number | undefined`**

- `backoff = FLOOR_MS × 2^(retryNumber − 1)` → 250, 500, 1000 ms.
- `jitter = random() × backoff`.
- A hint is a lower bound, not a replacement: `delay = max(hintMs ?? 0, backoff) + jitter`.
- `hintMs > CAP_MS` → `undefined`: do not retry, fail as today. Otherwise clamp `delay` to `CAP_MS`.

Consequences: without a hint the waits are [250, 500), [500, 1000), [1000, 2000) ms. The second retry
lands 750–1500 ms after the first failure — past the ~600 ms throttle windows observed — and jitter
de-synchronises the requests that were throttled together. A request that never recovers costs under
3.5 s extra; containers run concurrently, so a scan gets seconds slower, not minutes. Worst case is
hints just under the cap: ~90 s for that one request.

### 2. `callRegistry` flow — `app/registries/Registry.ts`

```
authenticate once
for attempt = 1..MAX_ATTEMPTS:
    start = now
    try:    response = axiosInstance(options); observe(start); return
    catch:  observe(start)
            hint  = parseRetryHint(error)
            delay = attempt < MAX_ATTEMPTS && isRetryable(error)
                      ? computeDelay(attempt, hint?.ms) : undefined
            if delay === undefined:  logAxiosError(warn); throw error
            logAxiosError(debug)
            log.debug("Retrying in <delay> ms (attempt <n>/<max>, status <s>, hint <ms> from header|body|none)")
            retry counter ++ ; recordRetry()
            await this.sleep(delay)
```

- **Authenticate once.** Several providers fetch a token in `authenticate`; repeating it per retry
  doubles traffic against a registry that is already throttling. Token lifetimes are minutes, the loop
  is seconds, and 401 is not retryable.
- **The Prometheus summary is observed per attempt** (`start` resets), so `wud_registry_response_count`
  counts every request and the quantiles exclude sleep time.
- **`protected sleep(ms)`** on `Registry`, an unref'ed `setTimeout`, so a pending retry cannot hold the
  process open on SIGTERM. Tests replace this one method instead of using fake timers.
- `callRegistry`'s signature and overloads are unchanged. The Quay and ECR overrides call
  `this.callRegistry` and inherit retries.

**Interaction with #53 (incremental tag listing).** `fetchTagsSinceWatermark` → `getTagsPage` →
`callRegistry` with a fixed URL, so the retry re-requests the same `last=<watermark>`. The full-crawl
fallback triggers only when `fetchTagsSinceWatermark` *returns* `undefined`; an exhausted retry *throws*,
leaving the cached list in place (no `deleteTagList`, no crawl).

**Interaction with #47 (in-flight dedupe).** `tagListsInFlight` stores the `resolveTagList` promise,
which sits above `callRegistry`. Concurrent callers await one promise and therefore one retried request.

### 3. Logging — `app/log/index.ts`

`registerAxiosErrorLogging` (a response interceptor, whose only production caller is `Registry`) is
replaced by `logAxiosError(log, error, level: 'warn' | 'debug')`, which emits the same three lines as
today — status + URL, request headers, response body — and nothing for errors without a `response`.

- Retried attempt → three `debug` lines plus the "Retrying in…" `debug` line.
- Exhausted or non-retryable failure → the same three WARN lines as today, once, for the final attempt.
  The watcher's own WARN and stack trace are untouched and now fire only when retries are exhausted.

Once retries are exhausted, behaviour is exactly today's.

### 4. Observability

**Controller — `app/prometheus/registry.ts`.** A `Counter`
`wud_registry_retry_count{type, name, status}`, where `status` is the HTTP status that caused the retry.
Incremented once per retry (per sleep), so a request needing three retries adds 3. `init()` registers
and replaces it like the existing summary; `getRetryCounter()` is `undefined` in agent mode and
`callRegistry` guards for that as `observePrometheusSummaryTags` does. The file gains explicit types.
Exhausted retries need no new metric: they surface as container errors.

**Everywhere — `Cron finished` line.**

```
Cron finished (70 containers watched, 0 errors, 3 available updates, 9 registry retries)
```

Always present, including `0 registry retries`, so the line keeps a stable shape. Nothing in the repo
parses this line. The number comes from `app/registries/retryStats.ts` (new): a process-wide tally with
`recordRetry()` and `getRetryCount()`. `watchFromCron` reads the count before and after `watch()` and
logs the difference.

*Known limitation:* the tally is process-wide. Two watchers on one instance scanning at overlapping
times can each include the other's retries. An exact per-scan figure would need a scan context threaded
from the watcher through `findNewVersion` → `getTags` → `callRegistry`, which is not worth it for a
diagnostic number. Single-watcher instances (the usual agent setup) are exact.

**Docs.** `docs/monitoring/README.md` gains the new metric; the changelog gains an entry describing the
retry behaviour (statuses, up to 3 retries, the new log field).

## Files

| file | change |
|---|---|
| `app/registries/retry.ts` | new — constants, `isRetryable`, `parseRetryHint`, `computeDelay` |
| `app/registries/retryStats.ts` | new — process-wide retry tally |
| `app/registries/Registry.ts` | retry loop in `callRegistry`, `sleep`, drop interceptor registration |
| `app/log/index.ts` | `logAxiosError` replaces `registerAxiosErrorLogging` |
| `app/prometheus/registry.ts` | retry counter, `getRetryCounter()`, explicit types |
| `app/watchers/providers/docker/Docker.ts` | `registry retries` field in `Cron finished` |
| `docs/monitoring/README.md`, `docs/changelog/README.md` | document metric and behaviour |

## Testing

TDD. New test files are typed (no `@ts-nocheck`).

**`app/registries/retry.test.ts`** (new)

- `isRetryable`: 429/502/503/504 → true; 400/401/404/500, no-`response` error, plain `Error` → false.
- `parseRetryHint`: header delta-seconds; header HTTP date in the future and in the past (→ 0); garbage
  header; the exact GHCR payload from the issue; both micro-sign code points; `ms`; `s`; compound
  `1m30s`; string body; body without a hint; header precedence over body; `source` reported correctly.
- `computeDelay` with `random` pinned to 0 and 0.999: the three backoff steps; sub-floor hint → floor;
  5 s hint → ≥ 5 s; hint over the cap → `undefined`; result never exceeds the cap.

**`app/registries/Registry.test.ts`** (extended; `axiosInstance` scripted per test, `sleep` stubbed)

- 429→200: resolves, one sleep in [250, 500), no `log.warn`, `authenticate` called once.
- 429→429→200: two sleeps, increasing, resolves.
- 5xx→200: resolves; counter labelled `status="503"`.
- 429 ×4: rejects with the last error; exactly three sleeps; three WARN lines emitted once.
- 404: rejects immediately, no sleep, WARN as today.
- No response (`ECONNRESET`): rejects immediately, no sleep.
- `Retry-After: 120` (over the cap): rejects immediately, no sleep.
- Header hint, body hint, unparseable hint → backoff.
- Summary observed once per attempt; retry counter and `recordRetry` once per sleep.
- #53: warm cache, watermark page 429→200 → the same `last=` URL is requested twice, no page-one
  request, `deleteTagList` not called, merged list returned. With 429 ×4 → the error propagates and the
  cached list is still there.
- #47: two concurrent `getTags` for one image, first page 429→200 → `axiosInstance` called exactly
  twice, both callers receive the same array.

**Other**

- `app/log`: `logAxiosError` honours the level, emits the same three lines, is silent without a
  `response`.
- `app/prometheus/registry.test.ts`: counter registered, replaced on re-init.
- `app/watchers/providers/docker/Docker.test.ts`: `Cron finished` reports the `getRetryCount()` delta
  across `watch()`, and `0 registry retries` when nothing happened.
- `app/watchers/providers/docker/utils.test.ts`: drop the `registerAxiosErrorLogging` mock entry.

**Gates:** `npm test`, `npm run lint`, `npx tsc --noEmit` in `app/`; the e2e suite once before the PR
(registry behaviour changed). No new e2e scenario: a real registry cannot be made to return 429 on
demand, and the unit tests script the HTTP layer exactly.

## Acceptance criteria (from #59)

| criterion | covered by |
|---|---|
| 429 then 200 yields a normal result: no `error`, correct `updateAvailable`, no WARN | `callRegistry` resolves, so the watcher never sees an error; 429→200 test asserts no `log.warn` |
| Header and GHCR in-body hints parsed; floor and cap applied; unparseable → backoff | `retry.test.ts` |
| Retries bounded; exhausted behaviour is today's | 429 ×4 test |
| Incremental path retries the same watermark, no full crawl on 429 | #53 tests |
| De-duplicated `getTags` callers share one retried request | #47 test |
| Unit tests: 429→200, 429→429→200, exhausted, 5xx→200, header vs body, floor/cap | above |
| Retry counts observable (metric on controller, log line on agent) | §4 |

## Post-release check

With `WUD_LOG_LEVEL=debug`, on the first throttled night, read the `Retrying in … hint … from header|body|none` debug lines to learn
whether GHCR sends `Retry-After` as a header on a 429, and record the answer on #59.
