Feature: WUD Post-Update Dependent Restart

  # zz_postupdate_sidecar shares zz_postupdate_main's network namespace
  # (--network container:zz_postupdate_main), so it must be recreated against the new
  # container ID. zz_postupdate_ghost deliberately does not exist.
  Scenario: Single trigger bounces the by-ID sidecar and skips the ghost
    When I find the container with name "zz_postupdate_main" and save its ID as "PUID", version as "PUV", and name as "PUN"
    And I send POST to /api/containers/`PUID`/triggers/docker/update
    Then response code should be 200
    And response body should be valid json
    And response body path $.dependents should be of type array with length 2
    And response body path $.dependents[0].name should be zz_postupdate_sidecar
    And response body path $.dependents[0].host should be zz_postupdate_main
    And response body path $.dependents[0].status should be bounced
    And response body path $.dependents[0].method should be recreate
    And response body path $.dependents[1].name should be zz_postupdate_ghost
    And response body path $.dependents[1].host should be zz_postupdate_main
    And response body path $.dependents[1].status should be skipped
    And response body path $.dependents[1].reason should be unresolved

  Scenario: The updated host and its recreated sidecar are both running afterwards
    When I wait for 30 seconds
    And I send POST to /api/containers/watch
    Then the container with saved name "PUN" should have a version different than "PUV"
    When I find the container with name "zz_postupdate_sidecar" and save its ID as "PUSID", version as "PUSV", and name as "PUSN"
    And I GET /api/containers/`PUSID`
    Then response code should be 200
    And response body should be valid json
    And response body path $.name should be zz_postupdate_sidecar
    And response body path $.status should be running

  Scenario: WUD must expose the post-update bounce counter
    When I GET /metrics
    Then response code should be 200
    And response body should contain wud_postupdate_bounce_count

  # zz_postupdate_batch_a names zz_postupdate_batch_b (a member of this very batch, hence
  # skipped) and zz_postupdate_sidecar (whose namespace host is zz_postupdate_main, not a
  # member of this batch, hence a plain restart).
  Scenario: Batch update skips a batch member and bounces the shared sidecar
    When I find the container with name "zz_postupdate_batch_a" and save its ID as "PBIDA", version as "PBVA", and name as "PBNA"
    And I find the container with name "zz_postupdate_batch_b" and save its ID as "PBIDB", version as "PBVB", and name as "PBNB"
    And I send POST to /api/containers/batch/triggers/docker/update with container IDs "PBIDA,PBIDB"
    Then response code should be 200
    And response body should be valid json
    And response body path $.members should be of type array with length 2
    And response body path $.members[0].name should be zz_postupdate_batch_a
    And response body path $.members[0].status should be updated
    And response body path $.members[1].name should be zz_postupdate_batch_b
    And response body path $.members[1].status should be updated
    And response body path $.dependents should be of type array with length 2
    And response body path $.dependents[0].name should be zz_postupdate_batch_b
    And response body path $.dependents[0].host should be zz_postupdate_batch_a
    And response body path $.dependents[0].status should be skipped
    And response body path $.dependents[0].reason should be batch member, already updated
    And response body path $.dependents[1].name should be zz_postupdate_sidecar
    And response body path $.dependents[1].host should be zz_postupdate_batch_a
    And response body path $.dependents[1].status should be bounced
    And response body path $.dependents[1].method should be restart
    And I wait for 30 seconds
    And I send POST to /api/containers/watch
    Then the container with saved name "PBNA" should have a version different than "PBVA"
    And the container with saved name "PBNB" should have a version different than "PBVB"
