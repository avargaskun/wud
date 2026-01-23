@agent
Feature: Agent Mode

    Scenario: Controller lists containers from Agent
        When I GET /api/containers
        Then response body path $[?(@.image.name=="library/nginx")].agent should be remote

    Scenario: Controller performs update checks for Agent containers
        When I GET /api/containers
        Then the container with image "library/nginx:1.20-alpine" should have update available

    Scenario: Full Update Cycle (Agent Mode)
        When I find the container with image "library/nginx:1.20-alpine" and save its ID as "NGINX_ID", version as "NGINX_VERSION", and name as "NGINX_NAME"
        And I send POST to /api/containers/{{NGINX_ID}}/triggers/remote/docker/update
        Then response code should be 200
        And I wait for 30 seconds
        And I send POST to /api/containers/{{NGINX_ID}}/watch
        And I GET /api/containers
        Then the container with saved name "NGINX_NAME" should have a version different than "NGINX_VERSION"
