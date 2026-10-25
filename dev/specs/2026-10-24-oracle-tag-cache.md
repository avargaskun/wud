# E2E oracle: persistent GHCR tag cache

## Problem

The e2e registry oracle (`e2e/features/support/registry_oracle.ts`) resolves the expected latest
tag of `linuxserver/radarr` by walking its full GHCR tag list: ~16,000 tags over 16 pages, on every
run. On 2026-10-25 GHCR answered that walk with `429 TOOMANYREQUESTS` on almost every page; the
oracle exhausted its 5 attempts and failed 3 scenarios in the post-merge validation of #71 and 2 in
the 9.4.3 release PR, with no change to WUD involved.

## Approach

Persist the oracle's GHCR tag lists between runs and resume from a watermark, so a warm run fetches
one page instead of sixteen. This is the technique WUD itself uses (#54, #56), re-implemented
independently in the oracle: the oracle exists to check WUD's answer, so it must not share WUD's
code and with it any bug in the delta fetch.

### Scope

- Only GHCR-backed endpoints (`ghcr.public`, `lscr.private`). GHCR lists tags in creation order
  and its `last=` cursor is positional. Docker Hub, quay and GitLab order lexically, where a
  watermark can silently miss new tags; they keep the full walk.
- Opt-in: enabled only when `ORACLE_TAG_CACHE_DIR` is set. Unset, behaviour is unchanged.

### Delta fetch

Given a cached list `C` (registry order) with more than 3 tags:

1. Watermark `w = C[len - 3]`; expected echo `E = C[len - 2..]` (the 2 tags after it).
2. Request `tags/list?last=<w>&n=1000`, following `Link` pages to the end.
3. The first page must start with `E`. GHCR answers an unknown cursor (e.g. a deleted tag) with
   `{"tags": null}`, indistinguishable from "nothing new", so the echo is the proof the cursor was
   honoured. Any mismatch, short echo or null page: discard the cache, warn, do a full walk.
4. Result: `C[0..w] ++ delta`.

The watermark sits 3 from the end because a cursor on the true last tag also returns `null`.

### Storage

One JSON file per endpoint, `<dir>/ghcr.io_<image with / as _>.json`, holding
`{ "endpoint": "ghcr.io/v2/<image>", "tags": [...] }`. Written after every successful walk (full
or delta) via a temp file and rename. Read or write errors, or a file whose `endpoint` does not
match, are warned about and treated as a cold cache; they never fail a scenario.

### CI

In `.github/workflows/reusable-tests.yml`, around `Test E2E`:

- `actions/cache/restore` of `e2e/.oracle-cache` with `restore-keys: oracle-tags-` (newest wins).
- `ORACLE_TAG_CACHE_DIR` set on the step.
- `actions/cache/save` with key `oracle-tags-<run_id>-<run_attempt>`, `if: always()` and only
  when a cache file exists, so a run that fails for an unrelated reason still keeps its progress.
  Cache entries are immutable, hence the per-run key.

PR runs restore from `dev`'s entries; their own saves stay scoped to the PR.

## Risks

- A cached tag deleted upstream stays in the list. If it were the newest match, the oracle would
  expect a tag WUD can no longer see. linuxserver does not delete release tags; accepted.
- A cold cache (first run, or 7 days without a run) costs the same full walk as today.

## Testing

New `oracle_selfcheck.ts` cases, stubbing `https`:

- warm cache: one `last=` request, new tags appended, latest resolved from the merged list;
- echo mismatch, `null` page and short echo each fall back to a full walk;
- the cache file is written after a full walk and after a delta;
- unset `ORACLE_TAG_CACHE_DIR`: no file is read or written;
- GitLab never uses the cache;
- unreadable or mismatched cache file degrades to a full walk.
