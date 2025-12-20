Feature: WUD Trigger API Exposure

  Scenario: WUD must allow to get all Triggers state
    When I GET /api/triggers
    Then response code should be 200
    And response body should be valid json
    And response body path $ should be of type array with length 2
    And response body path $ should contain [?(@.id == 'mock.example')]
    And response body path $ should contain [?(@.id == 'dockercompose.labels')]
    And response body path $[?(@.id == 'mock.example')].type should be mock
    And response body path $[?(@.id == 'mock.example')].name should be example
    And response body path $[?(@.id == 'mock.example')].configuration.threshold should be all
    And response body path $[?(@.id == 'mock.example')].configuration.mode should be simple
    And response body path $[?(@.id == 'mock.example')].configuration.once should be true
    And response body path $[?(@.id == 'mock.example')].configuration.simpletitle should be New \$\{container.updateKind.kind\} found for container \$\{container.name\}
    And response body path $[?(@.id == 'mock.example')].configuration.batchtitle should be \$\{containers.length\} updates available
    And response body path $[?(@.id == 'mock.example')].configuration.mock should be mock
    And response body path $[?(@.id == 'dockercompose.labels')].type should be dockercompose
    And response body path $[?(@.id == 'dockercompose.labels')].name should be labels
    And response body path $[?(@.id == 'dockercompose.labels')].configuration.mode should be simple

  Scenario: WUD must allow to get specific Triggers state
    When I GET /api/triggers/mock/example
    Then response code should be 200
    And response body should be valid json
    And response body path $.id should be mock.example
    And response body path $.type should be mock
    And response body path $.name should be example
    And response body path $.configuration.threshold should be all
    And response body path $.configuration.mode should be simple
    And response body path $.configuration.once should be true
    And response body path $.configuration.simpletitle should be New \$\{container.updateKind.kind\} found for container \$\{container.name\}
    And response body path $.configuration.batchtitle should be \$\{containers.length\} updates available
    And response body path $.configuration.mock should be mock

  Scenario: WUD must allow to get dockercompose labels Trigger state
    When I GET /api/triggers/dockercompose/labels
    Then response code should be 200
    And response body should be valid json
    And response body path $.id should be dockercompose.labels
    And response body path $.type should be dockercompose
    And response body path $.name should be labels
    And response body path $.configuration.mode should be simple
