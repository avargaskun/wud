Feature: WUD Container API Exposure

  Scenario: WUD must return correct container count
    When I GET /api/containers
    Then response code should be 200
    And response body should be valid json
    And response body path $ should be of type array with length 10

  # Test one representative container per registry type + update pattern
  Scenario Outline: WUD must handle different registry types and update patterns
    When I GET /api/containers
    Then response code should be 200
    And response body should be valid json
    And response body path $[<index>].name should be <containerName>
    And response body path $[<index>].status should be running
    And response body path $[<index>].image.registry.name should be <registry>
    And response body path $[<index>].image.registry.url should be <registryUrl>
    And response body path $[<index>].image.name should be <imageName>
    And response body path $[<index>].image.tag.value should be <tag>
    And response body path $[<index>].result.tag should be <resultTag>
    And response body path $[<index>].updateAvailable should be <updateAvailable>
    Examples:
      | index | registry       | containerName            | registryUrl                                             | imageName                           | tag                | resultTag          | updateAvailable | testCase                      |
      # Containers in alphabetical order by name (local watchers first, then remote)
      | 0     | ecr.private    | ecr_sub_sub_test         | `ECR_REGISTRY_URL`                                      | `ECR_IMAGE_NAME`                    | 1.0.0              | 2.0.0              | true            | ECR semver major update       |
      | 1     | ghcr.public    | ghcr_podinfo_500         | https://ghcr.io/v2                                      | stefanprodan/podinfo                | 5.0.0              | 6.0.0              | true            | GHCR semver major update      |
      | 2     | ghcr.public    | ghcr_podinfo_latest      | https://ghcr.io/v2                                      | stefanprodan/podinfo                | latest             | latest             | true            | GHCR latest tag digest update |
      | 3     | ghcr.public    | ghcr_radarr              | https://ghcr.io/v2                                      | linuxserver/radarr                  | 5.14.0.9383-ls245  | 6.0.4.10291-ls290  | true            | GHCR complex semver update    |
      | 4     | gitlab.private | gitlab_test              | https://registry.gitlab.com/v2                          | gitlab-org/gitlab-runner            | v16.0.0            | v16.1.0            | true            | GitLab semver update          |
      | 5     | hub.public     | hub_homeassistant_202161 | https://registry-1.docker.io/v2                         | homeassistant/home-assistant        | 2021.6.1           | 2026.1.3           | true            | Hub date-based versioning     |
      | 6     | lscr.private   | lscr_radarr              | https://lscr.io/v2                                      | linuxserver/radarr                  | 5.14.0.9383-ls245  | 6.0.4.10291-ls290  | true            | LSCR complex semver update    |
      | 7     | quay.public    | quay_prometheus          | https://quay.io/v2                                      | prometheus/prometheus               | v2.52.0            | v3.9.1             | true            | Quay semver major update      |
      | 8     | ghcr.public    | remote_podinfo_latest    | https://ghcr.io/v2                                      | stefanprodan/podinfo                | latest             | latest             | false           | Remote latest no update       |
      | 9     | ghcr.public    | remote_podinfo_update    | https://ghcr.io/v2                                      | stefanprodan/podinfo                | 5.0.0              | 6.0.0              | true            | Remote update available       |

  # Test detailed container inspection (semver)
  Scenario: WUD must provide detailed container information for semver containers
    Given I GET /api/containers
    And I store the value of body path $[4].id as containerId in scenario scope
    When I GET /api/containers/`containerId`
    Then response code should be 200
    And response body should be valid json
    And response body path $.watcher should be local
    And response body path $.name should be gitlab_test
    And response body path $.image.registry.name should be gitlab.private
    And response body path $.image.tag.semver should be true
    And response body path $.result.tag should be v16.1.0
    And response body path $.updateAvailable should be true

  # Test detailed container inspection (digest)
  Scenario: WUD must provide detailed container information for digest-based containers
    Given I GET /api/containers
    And I store the value of body path $[2].id as containerId in scenario scope
    When I GET /api/containers/`containerId`
    Then response code should be 200
    And response body should be valid json
    And response body path $.watcher should be local
    And response body path $.name should be ghcr_podinfo_latest
    And response body path $.image.tag.semver should be false
    And response body path $.image.digest.value should be sha256:f94d6dd9b5761f33a21bb92848a1f70ea11a1c15f3a142c19a44ea3a4c545a4d
    And response body path $.result.digest should be sha256:514a9c2814250e61396ef4d6125ece1a8fbb3b0964a2ab441e9f7acf0b66b8b5
    And response body path $.updateAvailable should be true

  # Test link functionality
  Scenario: WUD must generate correct links for containers with link templates
    Given I GET /api/containers
    And I store the value of body path $[5].id as containerId in scenario scope
    When I GET /api/containers/`containerId`
    Then response code should be 200
    And response body should be valid json
    And response body path $.link should be https://github.com/home-assistant/core/releases/tag/2021.6.1
    And response body path $.result.link should be https://github.com/home-assistant/core/releases/tag/2026.1.3

  # Test watch trigger functionality
  Scenario: WUD must allow triggering container watch
    Given I GET /api/containers
    And I store the value of body path $[4].id as containerId in scenario scope
    When I POST to /api/containers/`containerId`/watch
    Then response code should be 200
    And response body should be valid json
    And response body path $.result.tag should be v16.1.0