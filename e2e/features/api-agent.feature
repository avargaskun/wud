Feature: API Agents

  Scenario: Get agents list (empty by default)
    Given I set X-Auth-User header to john
    And I set X-Auth-Token header to doe
    When I GET /api/agents
    Then response body should contain []
    And response code should be 200
