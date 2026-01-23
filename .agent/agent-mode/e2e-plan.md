# Backend E2E Test Plan for Agent Mode

## High Level Description

To verify the Agent Mode functionality end-to-end, we need a test environment that simulates a distributed setup. Since the standard E2E tests run against a single WUD container, we will create a parallel test suite that spins up **two** WUD containers:

1.  **Agent Node**:
    - Runs with `--agent` flag.
    - Mounts the Docker socket to discover test containers.
    - Exposes an API (e.g., port 3001) for the Controller to connect to.
    - **Configuration**:
        - `WUD_AGENT_SECRET`: Shared secret.
        - `WUD_WATCHER_DOCKER_LOCAL_WATCHBYDEFAULT`: `true` (to see the test containers).

2.  **Controller Node**:
    - Runs in standard mode (no `--agent` flag).
    - **Configuration**:
        - `WUD_AGENT_REMOTE_HOST`: Points to the Agent container.
        - `WUD_AGENT_REMOTE_SECRET`: Shared secret.
        - `WUD_WATCHER_DOCKER_LOCAL_ENABLE`: `false` (Disabled). This ensures that any containers listed by the Controller *must* have come from the Agent, confirming the connection and data sync.
    - Exposes the main API (port 3000) for the test runner.

The test runner (Cucumber/Apickli) will run against the **Controller Node** (port 3000). We will verify that:
- The Controller lists containers found by the Agent.
- The containers have the correct `agent` metadata (e.g., `agent: "REMOTE"`).
- Update checks are performed (populated `result` fields), proving the Controller successfully processed the raw data from the Agent.

## Implementation Steps

### 1. Infrastructure Scripts

- [x] **Create `scripts/start-wud-agent-mode.sh`**
    - Based on `scripts/start-wud.sh`.
    - Build the WUD image.
    - Create a user-defined bridge network (or use standard links) to allow Controller to reach Agent.
    - **Step A**: Start `wud-agent` container.
        - Port: `3001:3000`
        - Env: `WUD_SERVER_PORT=3000` (internal), `WUD_AGENT_SECRET=testsecret`, `WUD_LOG_LEVEL=debug`.
        - Mount: `/var/run/docker.sock`.
    - **Step B**: Start `wud-controller` container.
        - Port: `3000:3000`
        - Env: `WUD_LOG_LEVEL=debug`.
        - Env: `WUD_WATCHER_DOCKER_LOCAL_ENABLE=false` (Disable local watcher).
        - Env: `WUD_AGENT_REMOTE_HOST=wud-agent` (assuming docker network/link).
        - Env: `WUD_AGENT_REMOTE_SECRET=testsecret`.
        - Link/Network: Connect to `wud-agent`.
    - **Step C**: Wait loop (simulating the `sleep 20`) to allow both to start and sync.

- [x] **Create `scripts/run-e2e-agent-tests.sh`**
    - Based on `scripts/run-e2e-tests.sh`.
    - Call `cleanup-test-containers.sh`.
    - Call `setup-test-containers.sh`.
    - Call `start-wud-agent-mode.sh`.
    - Run Cucumber with specific tag: `npm run cucumber -- --tags @agent`.

- [x] **Update `e2e/package.json` and `scripts/run-e2e-tests.sh`**
    - Modify the default test command to exclude agent tests: `npm run cucumber -- --tags "not @agent"`.
    - This ensures the standard CI/CD pipeline doesn't fail due to missing agent infrastructure.

### 2. Test Implementation

- [x] **2.1 Create `e2e/features/step_definitions/custom_steps.js`**
    - **Crucial**: These steps must be implemented first as they provide the robustness needed for all agent-mode scenarios (avoiding hardcoded array indices).
    - **Step: Find and Save ID/Version**
        - Regex: `/^I find the container with image "([^"]*)" and save its ID as "([^"]*)" and version as "([^"]*)"$/`
        - Logic: Fetch `/api/containers`, find the item matching the image, and store `id` and `version` in the Apickli variable store.
    - **Step: Compare Versions**
        - Regex: `/^the container with saved ID "([^"]*)" should have a version different than "([^"]*)"$/`
        - Logic: Assert that the current version of the container (found by saved ID) is not equal to the saved old version.

    - [x] **2.2 Create `e2e/features/agent-mode.feature`**
    - Use `@agent` tag.
    - [x] **Scenario 1: Controller lists containers from Agent**
        - `When I GET /api/containers`
        - `Then response body path $[?(@.image.name=="nginx")].agent should be REMOTE`
        - (Note: Even here, we can use the custom step or JSONPath with filters to be more robust).
    
    - [x] **Scenario 2: Controller performs update checks for Agent containers**
        - `When I GET /api/containers`
        - `Then response body path $[?(@.image.name=="nginx")].updateAvailable should be true`

    - [x] **Scenario 3: Full Update Cycle (Agent Mode)**
        - **Objective**: Verify that the Controller can trigger an update on the Agent, and the Agent successfully updates the container.
        - **Steps**:
            1.  `Given` the Agent is connected and has discovered containers.
            2.  `When` I find the container with image "library/nginx:1.20-alpine" and save its ID as "NGINX_ID" and version as "NGINX_VERSION".
            3.  `And` I POST to /api/containers/`{{NGINX_ID}}`/triggers/docker/update
            4.  `Then` response code should be 200.
            5.  `And` I wait for 30 seconds.
            6.  `And` I POST to /api/watchers/local/container/`{{NGINX_ID}}`
            7.  `And` I GET /api/containers
            8.  `Then` the container with saved ID "NGINX_ID" should have a version different than "NGINX_VERSION".

### 3. Execution & Verification

- [x] **Run the new test suite**
    - Execute `scripts/run-e2e-agent-tests.sh`.
    - Verify all tests pass.
    - Debug any networking/connectivity issues between the two docker containers.
