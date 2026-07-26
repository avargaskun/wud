Feature: WUD Batch Trigger API

  Scenario: Batch update two local containers with the docker trigger
    When I find the container with name "zz_batch_local_1" and save its ID as "ID1", version as "V1", and name as "N1"
    And I find the container with name "zz_batch_local_2" and save its ID as "ID2", version as "V2", and name as "N2"
    And I send POST to /api/containers/batch/triggers/docker/update with container IDs "ID1,ID2"
    Then response code should be 200
    And I wait for 30 seconds
    And I send POST to /api/containers/watch
    And I GET /api/containers
    Then the container with saved name "N1" should have a version different than "V1"
    And the container with saved name "N2" should have a version different than "V2"

  Scenario: Batch update two agent containers with the remote docker trigger
    When I find the remote container with name "zz_batch_remote_1" and save its ID as "RID1", version as "RV1", and name as "RN1"
    And I find the remote container with name "zz_batch_remote_2" and save its ID as "RID2", version as "RV2", and name as "RN2"
    And I send POST to /api/containers/batch/triggers/remote/docker/update with container IDs "RID1,RID2"
    Then response code should be 200
    And I wait for 30 seconds
    And I send POST to /api/containers/`RID1`/watch
    And I send POST to /api/containers/`RID2`/watch
    And I GET /api/containers
    Then the container with saved name "RN1" should have a version different than "RV1"
    And the container with saved name "RN2" should have a version different than "RV2"

  Scenario: Batch update a compose stack with the dockercompose trigger
    When I find the container with name "zz_batch_compose_1" and save its ID as "CID1", version as "CV1", and name as "CN1"
    And I find the container with name "zz_batch_compose_2" and save its ID as "CID2", version as "CV2", and name as "CN2"
    And I send POST to /api/containers/batch/triggers/dockercompose/update with container IDs "CID1,CID2"
    Then response code should be 200
    And I wait for 30 seconds
    And I send POST to /api/containers/watch
    And I GET /api/containers
    Then the container with saved name "CN1" should have a version different than "CV1"
    And the container with saved name "CN2" should have a version different than "CV2"
