Feature: WUD Atomic Container Swap

  # zz_atomic_victim was created with --volumes-from zz_atomic_donor and the donor has since been
  # removed, so recreating it fails at create. The swap must leave the original container running.
  Scenario: A failed create leaves the container running on its original version
    When I find the container with name "zz_atomic_victim" and save its ID as "ASID", version as "ASV", and name as "ASN"
    And I send POST to /api/containers/`ASID`/triggers/docker/update
    Then response code should be 500
    When I wait for 10 seconds
    And I send POST to /api/containers/watch
    Then the container with saved name "ASN" should have version equal to variable "ASV"
    When I find the container with name "zz_atomic_victim" and save its ID as "ASID2", version as "ASV2", and name as "ASN2"
    And I GET /api/containers/`ASID2`
    Then response code should be 200
    And response body should be valid json
    And response body path $.name should be zz_atomic_victim
    And response body path $.status should be running
