# Development Plan

- [x] **Step 1: Refactor Store for In-Memory Mode**
    - [x] Modify `app/store/index.ts` to accept a configuration option or flag to disable persistence (no `autosave`, memory adapter).
    - [x] Ensure `app/index.ts` can initialize store in this mode based on flags.
    - [x] Test: Unit tests for store initialization in both modes.

- [x] **Step 2: Refactor Docker Watcher for Discovery-Only**
    - [x] Modify `app/watchers/providers/docker/Docker.ts`.
    - [x] Add `discoveryOnly` configuration option.
    - [x] In `watchContainer`, if `discoveryOnly` is true, skip `findNewVersion`.
    - [x] Test: Unit test verifying `findNewVersion` is skipped when flag is set.

- [x] **Step 3: Implement Agent Server & Auth**
    - [x] Create `app/agent/AgentServer.ts`.
    - [x] Implement `init()` to start Express server with only `GET /api/containers`, `GET /api/events`, and `POST .../triggers`.
    - [x] Implement Middleware for `X-Wud-Agent-Secret`.
    - [x] Implement SSE logic in `GET /api/events` subscribing to `app/event` events.
    - [x] Test: Integration test for Agent Server endpoints and Auth.

- [x] **Step 4: Implement Agent Entry Point**
    - [x] Modify `app/index.ts` to handle `--agent` flag.
    - [x] Load Agent Configuration (`app/configuration`).
    - [x] Initialize Store (In-Memory).
    - [x] Initialize Watchers (Discovery Only).
    - [x] Start Agent Server.
    - [x] Skip Registry, Prometheus, and regular API initialization.
    - [x] Test: Manual run with `--agent`.

- [x] **Step 5: Implement Agent Client (Controller Side)**
    - [x] Create `app/agent/AgentClient.ts`.
    - [x] Implement connection logic (Handshake `GET /api/containers`).
    - [x] Implement SSE Client (EventSource).
    - [x] Handle `wud:container-added/updated/removed` events.
    - [x] Normalize data (inject `agentName`).
    - [x] Update local Store with remote containers.
    - [x] Test: Unit tests for AgentClient with mocked Agent.

- [x] **Step 6: Implement Agent Manager & Configuration**
    - [x] Create `app/agent/index.ts` (Manager).
    - [x] Read `WUD_AGENT_{name}_*` config.
    - [x] Instantiate `AgentClient` for each configured agent.
    - [x] Modify `app/index.ts` (Controller mode) to init `AgentManager`.
    - [x] Test: Verify Controller connects to Agent.

- [x] **Step 7: Decouple Registry & Update Checks**
    - [x] The Controller receives "raw" containers from Agent (no update info).
    - [x] Implement logic in `AgentClient` (or Manager) to call `registry.findNewVersion` for incoming Agent containers.
    - [x] Ensure `store.updateContainer` properly merges the remote data + local registry results.
    - [x] Test: Verify Agent containers get update status in Controller.

- [x] **Step 8: Remote Triggers**
    - [x] Implement `POST /api/containers/:id/triggers/...` in Agent Server.
    - [x] Modify Controller's Trigger logic to proxy requests to Agent if container has `agent` field.
    - [x] Test: End-to-end test of triggering a remote update.

- [x] **Step 9: Frontend - Configuration**
    - [x] Update `ui/src/services/api.ts` (or similar) to fetch Agent config/status.
    - [x] Add "Agents" section to Configuration view (`ui/src/views/Configuration.vue`?).
    - [x] Test: UI Test.

- [x] **Step 10: Frontend - Containers & Watchers**
    - [x] Update `Container` model in frontend to include `agent`.
    - [x] Add Agent filter in `ui/src/views/Containers.vue`.
    - [x] Display Agent name in Container details.
    - [x] Display Agent name in Watchers list.
    - [x] Test: UI Test.

- [ ] **Step 11: Backend E2E Tests**
    - [ ] Add E2E test scenario: Controller + Agent.
    - [ ] Verify container discovery, update check, and triggering.

- [ ] **Step 12: Frontend E2E Tests**
    - [ ] Add Playwright tests to validate new/updated views and components.

- [x] **Step 13: Documentation**
    - [x] Create `AGENT.md`.
    - [x] Update `README.md` and `docs/`.