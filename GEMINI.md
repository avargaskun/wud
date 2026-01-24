# WUD Repository Guide for Agents

This document provides context, architectural overview, and validation instructions for autonomous agents working on the WUD repository.

## High-Level Architecture

```mermaid
graph TD
    User((User)) -->|HTTP| UI[WUD UI (Vue.js)]
    UI -->|JSON API| App[WUD App (Node.js)]
    App -->|Docker Socket| Docker[Local Docker Engine]
    App -->|HTTPS| Registry[External Registries]
    App -->|HTTP/MQTT/SMTP| Trigger[Triggers / Notifications]

    subgraph Backend [app]
        App
    end

    subgraph Frontend [ui]
        UI
    end
```

## Introduction

WUD (What's Up Docker?) is a self-hosted tool that monitors Docker containers, checks for image updates on remote registries, and notifies users or performs actions (triggers) when updates are found. It consists of a Node.js backend (`app`) and a Vue.js frontend (`ui`).

## Project Structure

### `app/` (Backend)
The server-side Node.js application.
- **`api/`**: Contains the Express.js application, API route definitions, and authentication logic.
- **`configuration/`**: Manages application configuration loading and validation.
- **`model/`**: Defines core data structures (e.g., `Container` interface).
- **`store/`**: Handles data persistence (using LokiJS) for containers and application state.
- **`watchers/`**: Logic for discovering running containers.
    - `providers/`: Specific implementations (e.g., Docker, Mock).
- **`triggers/`**: Logic for executing actions when updates are found.
    - `providers/`: Implementations for various services (Slack, MQTT, Gotify, etc.).
- **`registries/`**: Logic for querying external container registries.
    - `providers/`: Implementations (e.g., Docker Hub, ECR, GCR).

### `ui/` (Frontend)
The client-side Vue.js 3 application.
- **`src/`**: Source code.
    - **`components/`**: Reusable Vue components (buttons, cards, inputs).
    - **`services/`**: API client modules that communicate with the backend `api/`.
    - **`views/`**: Top-level page components mapped to routes (e.g., Dashboard, Configuration).
    - **`composables/`**: Shared stateful logic using the Vue Composition API.
    - **`router/`**: Vue Router configuration.

### `e2e/` (Backend Integration Tests)
Cucumber-based integration tests for the backend.
- **`features/`**: Gherkin feature files describing test scenarios.

### `ui-e2e/` (Frontend E2E Tests)
Playwright-based end-to-end tests for the frontend.
- **`tests/`**: Playwright test specifications.

### `docs/`
Project documentation source files.

## Validation & Testing

**IMPORTANT:** Do NOT execute scripts located in the `scripts/` directory directly. Always use the NPM scripts defined in the respective package directories.

### Backend (`app/`)
To validate changes in the backend:
1.  Navigate to the directory: `cd app`
2.  **Linting:** `npm run lint` (or `npm run lint:fix` to auto-fix)
3.  **Formatting:** `npm run format`
4.  **Unit Tests:** `npm test`

### Frontend (`ui/`)
To validate changes in the frontend:
1.  Navigate to the directory: `cd ui`
2.  **Linting:** `npm run lint`
3.  **Unit Tests:** `npm run test:unit`

### Backend Integration (`e2e/`)
To run full backend integration tests (including container setup and cleanup):
1.  Navigate to the directory: `cd e2e`
2.  **Run Tests:** `npm run test:local`

### Frontend E2E (`ui-e2e/`)
To run frontend end-to-end tests:
1.  Navigate to the directory: `cd ui-e2e`
2.  **Run Tests:** `npm test`
    *   *Note: Ensure the WUD application and necessary environment are running if this script does not handle full environment orchestration.*
