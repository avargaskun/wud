# Runbook: git worktrees in this repo

Read this before running tests in, or removing, a worktree. Everything here is repo-specific — it
deliberately omits generic `git worktree` mechanics.

Use a worktree whenever you need your own branch. **Never move the main checkout off its current
branch** — another agent is often working in it, and switching its branch corrupts that agent's work in
a way it cannot detect. Read the main checkout's state (`git -C … rev-parse`), don't change it. If a
task seems to require moving it, ask first.

## Procedure

Worktrees are created and removed by Paseo, never by `git worktree add` or `EnterWorktree`:

```bash
paseo worktree create --mode branch-off --new-branch <name>   # or mcp__paseo__create_workspace
```

`paseo.json` then runs `npm ci` in `app/` and `ui/` and copies `.env` from the main checkout. The other
two workspaces are installed on demand:

```bash
(cd e2e && npm ci)              # 151M — needed to run the e2e suite
(cd ui-e2e && npm ci)           # 48M, plus npx playwright install
```

## Removing one

Archive the workspace through Paseo (`mcp__paseo__archive_workspace`); its teardown prunes the
worktree's lumen index. Archiving leaves the branch behind:

```bash
git branch -d <branch>                            # -D if the branch was squash-merged
```

A worktree removed any other way leaves its lumen index orphaned — run `scripts/lumen-prune.sh`.
Deleting a branch that is **not** checked out anywhere is safe and needs no ceremony.

## Gotchas — all of these have actually bitten us

1. **Git-ignored files are not copied into a worktree.** A worktree contains only what is committed,
   plus what `paseo.json` setup puts there (`.env`, `app/node_modules`, `ui/node_modules`). Anything
   else that is ignored — `ralph/`, `.claude/settings.local.json`, `e2e/node_modules`,
   `ui-e2e/node_modules` — is missing until you create it.

2. **`.env` holds real registry credentials** — 15 keys spanning AWS/ECR, GitHub, GitLab, ACR, GCR and
   TrueForge. Copy it, never commit it, never paste its contents anywhere. Both `e2e/` and `ui-e2e/`
   read it via `dotenvx run -f ../.env`.

3. **`node_modules` is per-directory and expensive** — ~900 MB to seed all four workspaces, which is
   why setup installs only `app/` and `ui/`. Note `app/` is needed for the e2e suite too, because the
   harness builds the `wud` image from it.

4. **Docker state is global, not per-worktree. This is the biggest trap.** The e2e harness uses *fixed*
   container names (`wud-controller`, `wud-agent`, `wud-dind`, `zz_*`, …), a fixed network
   (`wud-e2e-net`), fixed host ports (3000, 3001, 2376) and a fixed image tag (`wud:latest`). Therefore:
   - **Two worktrees cannot run the e2e suite concurrently.** They collide on every one of those names.
   - **`cleanup-test-containers.sh` in one worktree destroys the fixtures of a suite running in
     another.** `npm test` begins with that cleanup.
   - `wud:latest` belongs to whichever worktree built last, so an interleaved run can test the *other*
     branch's image.
   Before running the suite anywhere, check nothing else is mid-run:
   `docker ps --format '{{.Names}} {{.RunningFor}}'`.

5. **A stale base produces phantom failures that look like environment rot.** Because Docker state is
   global (gotcha 4) but the checkout is not, a worktree branched from an older commit can run its
   *old* feature files against fixtures created by a *newer* base's `setup-test-containers.sh`.
   Real example: a branch cut at `72a86af` failed `api-container.feature` with "expected 26, actual 27"
   because `dev` had since added the `zz_compose_unresolvable` fixture and bumped the assertion to 27.
   That looks exactly like a dirty daemon. **When a container-count assertion disagrees with reality,
   check whether the base branch has moved (`git log HEAD..origin/dev`) before concluding the
   environment is dirty.**

6. **A branch checked out in another worktree cannot be checked out again.** The main checkout usually
   holds `dev`, so branch new worktrees *from* `dev` rather than trying to check it out.

7. **Missing seeding fails late and misleadingly.** A missing `.env` or missing `e2e/node_modules`
   surfaces as `Unknown command: cucumber-js …` — emitted *after* the harness has built the image and
   started every container, minutes into the run. If you see that, suspect the install steps above, not
   the suite.

8. **The e2e suite rate-limits against ghcr.io on repeated runs.** The registry oracle enumerates ~15.5k
   tags of `linuxserver/radarr` over 16 pages; roughly 4 full runs within an hour earns
   `TOOMANYREQUESTS`, failing `api-container.feature:30` and cascading into two `prometheus.feature`
   scenarios via an unresolved `EXPECTED_TAG`. Transient and unrelated to the code under test — re-run
   rather than investigate, but confirm the failures are exactly those three.

9. **Start the stack through the npm scripts, never the raw `scripts/*.sh`.** Only the npm scripts wrap
   the harness in `dotenvx run -f ../.env`; `scripts/start-wud.sh` and `scripts/run-e2e-tests.sh` load
   nothing. A stack started raw and a cucumber run started through npm disagree on the environment and
   produce exactly 7 failures that mimic registry trouble: `ECR_REGISTRY_URL` / `AWS_REGION` expected
   `us-west-2` against the `eu-west-1` fallback image, and `EXPECTED_TAG` null on lscr/ghcr containers
   (dummy tokens). When a single 15-minute command is too long for your tool, split it:
   `cd e2e && npm run test:cleanup && npm run test:start-wud`, then `npm run cucumber`, then
   `npm run test:cleanup`. Detaching with `nohup`/`setsid` from an agent sandbox is killed silently.
