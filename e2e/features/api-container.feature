Feature: WUD Container API Exposure

  Scenario: WUD must return correct container count
    When I GET /api/containers
    Then response code should be 200
    And response body should be valid json
    And response body path $ should be of type array with length 10

  # Test one representative container per registry type + update pattern
  Scenario Outline: WUD must handle different registry types and update patterns
    When I GET /api/containers
    And I resolve the latest version for image "<imageName>" on registry "<registry>" with strategy "<strategy>" and pattern "<pattern>" and value "<resultTag>" as "EXPECTED_TAG"
    Then response code should be 200
    And response body should be valid json
    And response body path $[<index>].name should be <containerName>
    And response body path $[<index>].status should be running
    And response body path $[<index>].image.registry.name should be <registry>
    And response body path $[<index>].image.registry.url should be <registryUrl>
    And response body path $[<index>].image.name should be <imageName>
    And response body path $[<index>].image.tag.value should be <tag>
    And response body path $[<index>].result.tag should equal variable "EXPECTED_TAG"
    And response body path $[<index>].updateAvailable should be <updateAvailable>
    Examples:
      | index | registry       | containerName            | registryUrl                                             | imageName                           | tag                | resultTag          | updateAvailable | strategy | pattern                       | testCase                      |
      # Containers in alphabetical order by name (local watchers first, then remote)
      | 0     | ecr.private    | ecr_sub_sub_test         | `ECR_REGISTRY_URL`                                      | `ECR_IMAGE_NAME`                    | 1.0.0              | 2.0.0              | true            | static   | .*                            | ECR semver major update       |
      | 1     | ghcr.public    | ghcr_podinfo_500         | https://ghcr.io/v2                                      | stefanprodan/podinfo                | 5.0.0              | ignored            | true            | dynamic  | ^6\.0\.0$                     | GHCR semver major update      |
      | 2     | ghcr.public    | ghcr_podinfo_latest      | https://ghcr.io/v2                                      | stefanprodan/podinfo                | latest             | latest             | true            | static   | .*.                           | GHCR latest tag digest update |
      | 3     | ghcr.public    | ghcr_radarr              | https://ghcr.io/v2                                      | linuxserver/radarr                  | 5.14.0.9383-ls245  | ignored            | true            | dynamic  | ^\d+\.\d+\.\d+\.\d+-ls\d+$    | GHCR complex semver update    |
      | 4     | gitlab.private | gitlab_test              | https://registry.gitlab.com/v2                          | gitlab-org/gitlab-runner            | v16.0.0            | ignored            | true            | dynamic  | ^v16\.[01]\.0$                | GitLab semver update          |
      | 5     | hub.public     | hub_homeassistant_202161 | https://registry-1.docker.io/v2                         | homeassistant/home-assistant        | 2021.6.1           | ignored            | true            | dynamic  | ^\d+\.\d+\.\d+$               | Hub date-based versioning     |
      | 6     | lscr.private   | lscr_radarr              | https://lscr.io/v2                                      | linuxserver/radarr                  | 5.14.0.9383-ls245  | ignored            | true            | dynamic  | ^\d+\.\d+\.\d+\.\d+-ls\d+$    | LSCR complex semver update    |
      | 7     | quay.public    | quay_prometheus          | https://quay.io/v2                                      | prometheus/prometheus               | v2.52.0            | ignored            | true            | dynamic  | ^v\d+\.\d+\.\d+$              | Quay semver major update      |
      | 8     | ghcr.public    | remote_podinfo_latest    | https://ghcr.io/v2                                      | stefanprodan/podinfo                | latest             | latest             | false           | static   | .*                            | Remote latest no update       |
      | 9     | ghcr.public    | remote_podinfo_update    | https://ghcr.io/v2                                      | stefanprodan/podinfo                | 5.0.0              | ignored            | true            | dynamic  | ^6\.0\.0$                     | Remote update available       |

  # Test detailed container inspection (semver)
  Scenario: WUD must provide detailed container information for semver containers
    Given I GET /api/containers
    And I store the value of body path $[4].id as containerId in scenario scope
    And I resolve the latest version for image "gitlab-org/gitlab-runner" on registry "gitlab.private" with strategy "dynamic" and pattern "^v16\.[01]\.0$" and value "" as "EXPECTED_TAG"
    When I GET /api/containers/`containerId`
    Then response code should be 200
    And response body should be valid json
    And response body path $.watcher should be local
    And response body path $.name should be gitlab_test
    And response body path $.image.registry.name should be gitlab.private
    And response body path $.image.tag.semver should be true
    And response body path $.result.tag should equal variable "EXPECTED_TAG"
    And response body path $.updateAvailable should be true

  # Test detailed container inspection (digest)
  Scenario: WUD must provide detailed container information for digest-based containers
    Given I GET /api/containers
    And I store the value of body path $[2].id as containerId in scenario scope
    And I get the latest digest for image "stefanprodan/podinfo" on registry "ghcr.public" with tag "latest" and store it in "EXPECTED_DIGEST"
    When I GET /api/containers/`containerId`
    Then response code should be 200
    And response body should be valid json
    And response body path $.watcher should be local
    And response body path $.name should be ghcr_podinfo_latest
    And response body path $.image.tag.semver should be false
    # Check repo digest (Manifest Digest) which should match the one we pulled (5.0.0's digest)
    And response body path $.image.digest.repo should be sha256:d15a206e4ee462e82ab722ed84dfa514ab9ed8d85100d591c04314ae7c2162ee
    And response body path $.result.digest should equal variable "EXPECTED_DIGEST"
    And response body path $.updateAvailable should be true

  # Test link functionality
  Scenario: WUD must generate correct links for containers with link templates
    Given I GET /api/containers
    And I store the value of body path $[5].id as containerId in scenario scope
    And I resolve the latest version for image "homeassistant/home-assistant" on registry "hub.public" with strategy "dynamic" and pattern "^\d+\.\d+\.\d+$" and value "" as "EXPECTED_TAG"
    And I set variable "EXPECTED_LINK" to "https://github.com/home-assistant/core/releases/tag/`EXPECTED_TAG`"
    When I GET /api/containers/`containerId`
    Then response code should be 200
    And response body should be valid json
    And response body path $.link should be https://github.com/home-assistant/core/releases/tag/2021.6.1
    And response body path $.result.link should equal variable "EXPECTED_LINK"

  # Test watch trigger functionality
  Scenario: WUD must allow triggering container watch
    Given I GET /api/containers
    And I store the value of body path $[4].id as containerId in scenario scope
    And I resolve the latest version for image "gitlab-org/gitlab-runner" on registry "gitlab.private" with strategy "dynamic" and pattern "^v16\.[01]\.0$" and value "" as "EXPECTED_TAG"
    When I POST to /api/containers/`containerId`/watch
    Then response code should be 200
    And response body should be valid json
    And response body path $.result.tag should equal variable "EXPECTED_TAG"