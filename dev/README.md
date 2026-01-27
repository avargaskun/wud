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
-   [Amazon ECR Docker Credential Helper](https://github.com/awslabs/amazon-ecr-credential-helper) (for seamless ECR authentication)

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

#### Environment Variables

Make sure to have a `.env` file in the root folder of the repository with the following values defined in them. Some end to end tests will not pass unless these variables are properly set:

```bash
# ECR Credentials
AWS_ACCESSKEY_ID=
AWS_SECRET_ACCESSKEY=
AWS_REGION=
ECR_REGISTRY_URL=
ECR_IMAGE_NAME=
# GitHub Credentials
GITHUB_USERNAME=
GITHUB_TOKEN=
# GitLab Credentials
GITLAB_USERNAME=
GITLAB_TOKEN=
# ACR
ACR_CLIENT_ID=
ACR_CLIENT_SECRET=
# TrueForge
TRUEFORGE_USERNAME=
TRUEFORGE_TOKEN=
# GCR
GCR_CLIENT_EMAIL=
GCR_PRIVATE_KEY=
```

#### ECR Test Images

The ECR end to end tests require a valid ECR image path and credentials to access the registry. 

The script `/scripts/setup-ecr-container.sh` will set this up for you. You will need to make sure the AWS SDK is installed and configured before running the script. After running the script, the values you need to include in the `.env` file will be output to the screen.

#### ECR Authentication

To run ECR tests without relying on the AWS CLI for `docker login`, configure the **Amazon ECR Docker Credential Helper**. This allows Docker to automatically authenticate using your AWS credentials.

1.  **Install the Helper**:
    * **Linux**: `sudo apt install amazon-ecr-credential-helper`
    * **macOS**: `brew install docker-credential-helper-ecr`

2.  **Configure Docker**:
    Add the `credsStore` or `credHelpers` configuration to your `~/.docker/config.json` file:
    ```json
    {
      "credHelpers": {
        "public.ecr.aws": "ecr-login",
        "<aws_account_id>.dkr.ecr.<region>.amazonaws.com": "ecr-login"
      }
    }
    ```

3.  **Configure Credentials**:
    Ensure your AWS keys (from the `.env` file or the output of `setup-ecr-container.sh`) are available in `~/.aws/credentials`:
    ```ini
    [default]
    aws_access_key_id = <AWS_ACCESSKEY_ID>
    aws_secret_access_key = <AWS_SECRET_ACCESSKEY>
    ```

#### Test Suites

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
