You are a senior full-stack developer specialized VueJS, NodeJS and Typescript.

## SITUATION

This repository has the implementation of a self-hosted service called WUD. The purpose of WUD is to monitor your docker containers and inform when there are new versions for the images of those containers. WUD is capable of applying updates to those containers as well. WUD supports configuring multiple container "watchers". This feature allows users to monitor containers in more than 1 machine, by pointing additional watchers to the Docker socket in other machines. 

There are multiple downsides to this approach:

- The remote system has to expose their docker socket via HTTP/HTTPS. The options available for this currently do not offer any security layers (like username/password).
- Certain update triggers, like DockerCompose, won't work on containers in the remote system because they require access to the files on the remote system.

## PROJECT STRUCTURE

- `app` - the code for the 'back-end' server (NodeJS) - includes unit-tests
- `ui` - the code for the 'front-end' WebUI (VueJS) - includes unit-tests
- `e2e` - cucumber integration tests for the 'back-end'
- `ui-e2e` - playwright integration tests for the 'front-end'
- `scripts` - useful scripts to run tests and cleanup manually
- `test` - supporting files for end to end tests
- `docs` - documentation for the project

## YOUR TASK

You have to implement a new feature for WUD called "Agent Mode. This new feature allows users to run a "headless" instance of WUD on a remote system which will be then accessed from their main instance, also referred to as "Controller". The benefits of this configuration include:

- User can manage containers monitored by multiple "Agents" from a single WebUI service, running in the "Controller"
- Update triggers, like DockerCompose, configured in "Agents" can be executed remotely from the "Controller"
- The remote triggers running in the "Agents" can have access to the file-systems, allowing operations like updating docker-compose files

## IMPORTANT CONSIDERATIONS

- Before continuing, read the entire codebase to get your bearings. The rest of this document implies familiarity with the code in the repository.
- Functionality already supported by the "Controller" should be reused. For example, the "Controller" already supports configuration for HTTPS (with SSL certs). This functionality must not be re-written for the "Agent". The code may be re-structured if necessary, but not duplicated.
- All suites of unit and integration tests must pass 100% after the change
- Any new functionality added by this feature should be covered with new unit tests
- You should add integration tests to the back-end e2e test project, for at least 1 happy path
- You should add simple tests to the front-end e2e tests for newly added UI controls

## IMPLEMENTATION DETAILS

Here are more details of the feature and how I want it to be implemented:

### 1. Launching WUD in "Agent" mode

WUD can be launched in this new mode passing the command-line parameter `--agent`. 

### 2. Configuring the WUD "Agent"

The following environment variables allow specifying the 'secret' that will be used to authenticate the "Controller". At least one of the following is **required**:

- `WUD_AGENT_SECRET`: The secret used to authenticate the calls from the "Controller"
- `WUD_AGENT_SECRET_FILE`: Similar as `WUD_AGENT_SECRET`, but the secret is read from the file path specified.

The following environment variables are accepted to configure the agent server settings. They work the same way as they do when configured for the WUD promary node:

- `WUD_SERVER_PORT`
- `WUD_SERVER_TLS_ENABLED`
- `WUD_SERVER_TLS_KEY`
- `WUD_SERVER_TLS_CERT`

Watcher configuration in the "Agent" follows the same syntax than in the "Controller". However, an "Agent" **MUST** configure at least 1 watcher. If there are no watchers configured, the process should log an error and exit.

Only the DOCKER and DOCKERCOMPOSE trigger types will need to be supported in the "Agent" configuration. Specifying any other trigger type in the WUD "Agent" configuration is ignored. In this case, the "Agent" process should log a warning describing the issue, but continue to run.

Registries will **NOT** be accessed by the "Agent", so those variables are ignored when running in Agent mode.

### 3. Configuring the WUD "Controller"

Adding an Agent connection to the Controller will be done via a new set of `WUD_AGENT_{name}_*` environment variables. The following variables will be supported:

- `WUD_AGENT_{name}_SECRET` _OR_ `WUD_AGENT_{name}_SECRET_FILE` - **required**, secret to authenticate with the Agent
- `WUD_AGENT_{name}_HOST` - **required**, points to the agent by hostname (without protocol or port)
- `WUD_AGENT_{name}_PORT` - *optional*, by default set to 3000
- `WUD_AGENT_{name}_CAFILE`, `WUD_AGENT_{name}_CERTFILE`, `WUD_AGENT_{name}_KEYFILE` -  *optional*, used to support TLS

Registries will only need to be configured on the Controller. The Agent nodes will not perform an actual check for image updates. When a watcher runs in the Agent it will push updated updater container information up to the Controller, which will then perform the version checks.

### 4. Refactoring Requirements (Critical)

Currently, the `Docker` watcher (and the base logic) couples **Container Discovery** (listing containers) with **Update Checking** (querying registries). This must be decoupled:

- **Agent Behavior:** The Watchers running on the Agent must run in a "Discovery Only" mode. They should retrieve container details and image tags but **skip** the step of contacting a Registry to find new versions.
- **Controller Behavior:** The Controller must receive the raw container data from the Agent and perform the registry lookups (Update Checking) locally, using the Controller's own Registry configuration.
- You will likely need to refactor `app/watchers/providers/docker/Docker.ts` to support this split logic based on whether WUD is running in `--agent` mode.

### 5. Object model changes in "Controller"

Currently, the model (schema) of a "container" in the server includes the watcher associated with the container. This model will need to be augmented to include the `agent` associated with the container. The value of this field can be `undefined` which indicates the container is associated with a watcher declared in the current WUD instance, not a remote Agent. This model update needs to be propagated to all the surfaces of WUD. That is, any API that accepts or returns a container object. This also includes metrics in Prometheus.

Similarly, any APIs that accept or return "watcher" objects, need to support a new field for "agent" associated with that Watcher. The value of this field can be `undefined` which indicates the watcher is declared in the current WUD instance, not a remote Agent.

### 6. Agent-Controller protocol

The "Controller" will reuse the existing REST APIs to perform necessary actions on the "Agent" such as executing a Trigger.

When calling the Agent, the Controller will include the secret configured for the agent in the `X-Wud-Agent-Secret` HTTP header. 

**Connection Flow:**
1.  **Initial Handshake:** When the Controller starts (or establishes a connection to an Agent), it must first call the Agent's REST API (e.g., `GET /api/containers`) to retrieve a full snapshot of the current state.
2.  **Real-time Updates:** After the handshake, the Controller opens a Server-Side Events (SSE) connection to the Agent.
    - The Agent will use this SSE channel to push updates whenever a container change is detected (e.g. Docker events).
    - Because these are SSE, the Agent does not need to know the address of the Controller - the Controller is the one that establishes the connection to the Agent.
    - Authentication uses the same secret mechanism as when calling REST APIs on the Agent.

You are in charge of defining the protocol for messages delivered via the SSE channel. The only requirement is to use text-based messages, with JSON payload.

### 7. Special note on Trigger names

Trigger names are considered "global". That is, defining a trigger with the same name in the "Agent" and "Controller" nodes could have undesired effects. The following are some known behaviors for cases trigger names overlap between Agent and Controller:

- Configuration in docker `labels` for containers will apply to all triggers matching the given name. For example, setting `wud.trigger.exclude=docker` in a container that appears in an Agent, will exclude any trigger named "DOCKER" regardless of whether it was defined in the Agent or Controller.

### 8. Special note on the container "Store"

The project supports a "store" to keep a cache of known containers. This cache is used for performance optimization and diffing. 

- **In Agent Mode:** The main persistence features of the store should be disabled (e.g. no writing to disk/db if applicable), BUT the Agent must maintain an **Ephemeral (In-Memory) Store**. This is required so the Agent can "diff" previous states against current states to avoid spamming the Controller with SSE events when nothing has changed.
- **In Controller Mode:** The cache will include information about containers discovered locally AND containers discovered through Agents.

### 9. WebUI updates

There are several sections of the WebUI that need to be updated with the introduction of Agent mode:

- The "Configuration" section needs to be updated to include a new sub-section for "Agents" that shows all configured agents.
	- Each agent should be shown in an expandable card (like the UX in other sub-sections)
	- Besides their configuration, this sub-section should also show the 'state' of the agent (Connected/Disconnected) based on the status of the SSE channel to the agent.
	- If there are no Agents configured, the page should show text to this effect.
- The "Watchers" section under "Configuration" needs to be updated to include the "Agent" associated with each watcher. The following changes only apply if there are Agents defined in the configuration:
	- Currently this page shows a card for each watcher, which currently is titled with the TYPE and NAME of the watcher (e.g. "docker" / "default").
- The "Containers" page needs to be updated to include the "Agent" associated with each container. The following changes only apply if there are Agents defined in the configuration:
	- This means modifying the title of the card for each container, which currently is titled with the WATCHER, REGISTRY, NAME and VERSION of the container
	- When the card is expanded, the tab for CONTAINER should include in the details the name of the associated Agent, as a link to the "Configuration/Agents" page.
	- The top of the Containers page has drop-down controls to filter by different attributes (watcher, registry, etc.) A new drop-down should be added to filter by "Agent" - it should be the first drop down in the set.

### 10. Observability

There should be sufficient information in the logs in order to diagnose any issues with the new functionality. The implementation should make prudent use of log levels to avoid causing too much chattiness in the logs.

When running in Agent mode, the healthcheck will continue to be supported. The Prometheus metrics however will always be disabled in Agent mode.

### 11. Documentation updates

Inspect the structure of the documentation under the `docs` folder and include new sections and information relevant to Agent mode so that users know how to deploy WUD in agent mode and connect it to their controller.

You also need to generate a file called AGENT.md to be placed in the top-level folder. This file will have a very detailed description of the architecture of Agent Mode. It will include one or more Mermaid.js diagrams, including: 

1. A systems diagram showing relationships between Agent and Controller, and the entities that can be configured in each (watchers, registries, etc.)
2. A sequence diagram showing an end-to-end scenario that includes communication across Agent, Controller and WebUI

## NEXT STEPS

1. Iterate on the design
    - Read the entire code base to understand what components exist (server, webui, tests, etc.) and how they are structured.
    - Read the requirements (this plan) and ask clarifying questions. There may be some gaps in the design specification, help me fill those in.
    - Define all the environment variables that will be supported in both the Agent and Controller nodes.
    - Define the SSE protocol that will be used for real-time Agent > Controller communication
    - Save the final design into a file named `design.md`
2. Create a development plan
    - Break down the entire implementation into small, incremental, testable steps
    - EVERY step will have the following phases:
        - Implement the code
        - Add unit tests,
        - Add end to end tests (when applicable)
        - Ensure that all tests (old and new) pass successfully
    - Save the final plan into a file named `plan.md` 
        - Use 'checkboxes' in task items so they can be marked as complete as the execution of the plan takes place