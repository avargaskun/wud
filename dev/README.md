# WUD Developer Guide

Welcome to the WUD (What's Up Docker?) developer documentation. This guide provides an overview of the project structure, architecture, and instructions for building and testing.

## Project Structure

- **`app/`**: Backend application (Node.js/TypeScript).
- **`ui/`**: Frontend application (Vue.js 3).
- **`e2e/`**: Backend integration tests (Cucumber).
- **`ui-e2e/`**: Frontend end-to-end tests (Playwright).
- **`dev/`**: Developer documentation (you are here).
- **`docs/`**: User documentation (Docsify).

## Architecture

WUD operates in two modes:
1.  **Controller Mode** (Default): The standard standalone application. It runs the UI, API, Store (persisted), and manages Local Watchers. It can also connect to remote Agents.
2.  **Agent Mode**: A lightweight, headless mode intended to run on remote Docker hosts. It performs discovery and pushes updates to a Controller.

See [Agent Mode Design](agent-mode.md) for deep-dive details.

### Backend (`app`)
The backend is an Express-based Node.js application.
-   **Store**: Uses LokiJS. In Controller mode, it persists to `wud.json`. In Agent mode, it runs in-memory.
-   **Watchers**: Modules that discover containers (e.g., Docker socket, Kubernetes).
-   **Registries**: Modules that query external registries (Hub, GHCR, ECR) for image updates.
-   **Triggers**: Modules that execute actions (Notifications, Webhooks, Container Updates).

### Frontend (`ui`)
The frontend is a Vue 3 application built with Vuetify. It communicates with the backend via the REST API.

## Development Workflow

### Prerequisites
-   Node.js (v20+)
-   Docker

### Running Local Development

#### Backend
```bash
cd app
npm install
npm start
```

#### Frontend
```bash
cd ui
npm install
npm run serve
```

### Testing

**Backend Unit Tests:**
```bash
cd app
npm test
```

**Frontend Unit Tests:**
```bash
cd ui
npm test
```

**End-to-End Tests:**
```bash
# Backend Integration
cd e2e
npm test

# Frontend E2E
cd ui-e2e
npm test
```

## Contributing
Please follow the existing code style (Prettier/ESLint). Ensure all tests pass before submitting a PR.
