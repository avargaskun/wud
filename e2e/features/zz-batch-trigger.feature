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
    And the compose file "../test/compose-stack/docker-compose.active.yml" should pin service "zz_batch_compose_bystander" to "ghcr.io/stefanprodan/podinfo:5.0.0"
    And the compose file "../test/compose-stack/docker-compose.active.yml" should pin service "zz_batch_compose_1" to "ghcr.io/stefanprodan/podinfo:6.0.0"

  Scenario: Reject an invalid bucket value on the batch endpoint
    When I find the container with name "zz_bucket_batch_1" and save its ID as "BKID1", version as "BKV1", and name as "BKN1"
    And I send POST to /api/containers/batch/triggers/docker/update with container IDs "BKID1" and bucket "nonsense"
    Then response code should be 400
    And response body path $.error should be bucket must be one of major, minor, patch, digest

  Scenario: Reject a single-container trigger with an unpopulated bucket
    When I find the container with name "zz_bucket_single" and save its ID as "BKSID", version as "BKSV", and name as "BKSN"
    And I send POST to /api/containers/`BKSID`/triggers/docker/update with bucket "major"
    Then response code should be 400
    And I GET /api/containers/`BKSID`
    And response body path $.image.tag.value should be 6.0.0

  Scenario: Reject a batch bucket trigger when members lack the bucket
    When I find the container with name "zz_bucket_batch_1" and save its ID as "BKID1", version as "BKV1", and name as "BKN1"
    And I find the container with name "zz_bucket_batch_2" and save its ID as "BKID2", version as "BKV2", and name as "BKN2"
    And I send POST to /api/containers/batch/triggers/docker/update with container IDs "BKID1,BKID2" and bucket "major"
    Then response code should be 400
    And response body path $.error should be All containers must have a populated 'major' update
    And I GET /api/containers/`BKID1`
    And response body path $.image.tag.value should be 6.0.0

  Scenario: Apply a specific bucket to a single container
    When I find the container with name "zz_bucket_single" and save its ID as "BKSID", version as "BKSV", and name as "BKSN"
    And I resolve the latest version for image "stefanprodan/podinfo" on registry "ghcr.public" with strategy "dynamic" and pattern "^6\.0\.\d+$" and value "" as "EXPECTED_PATCH_TAG"
    And I send POST to /api/containers/`BKSID`/triggers/docker/update with bucket "patch"
    Then response code should be 200
    And I wait for 30 seconds
    And I send POST to /api/containers/watch
    And I GET /api/containers
    Then the container with saved name "BKSN" should have version equal to variable "EXPECTED_PATCH_TAG"

  Scenario: Batch update with bucket patch applies the patch not the highest update
    When I find the container with name "zz_bucket_batch_1" and save its ID as "BKID1", version as "BKV1", and name as "BKN1"
    And I find the container with name "zz_bucket_batch_2" and save its ID as "BKID2", version as "BKV2", and name as "BKN2"
    And I resolve the latest version for image "stefanprodan/podinfo" on registry "ghcr.public" with strategy "dynamic" and pattern "^6\.0\.\d+$" and value "" as "EXPECTED_PATCH_TAG"
    And I send POST to /api/containers/batch/triggers/docker/update with container IDs "BKID1,BKID2" and bucket "patch"
    Then response code should be 200
    And I wait for 30 seconds
    And I send POST to /api/containers/watch
    And I GET /api/containers
    Then the container with saved name "BKN1" should have version equal to variable "EXPECTED_PATCH_TAG"
    And the container with saved name "BKN2" should have version equal to variable "EXPECTED_PATCH_TAG"

  Scenario: Update a container whose compose pin routes through a mirror prefix
    When I find the container with name "zz_mirror_app" and save its ID as "MRID", version as "MRV", and name as "MRN"
    And I set variable "EXPECTED_MIRROR_TAG" to "6.0.0"
    And I send POST to /api/containers/`MRID`/triggers/dockercompose/update
    Then response code should be 200
    And I wait for 30 seconds
    And I send POST to /api/containers/watch
    And I GET /api/containers
    Then the container with saved name "MRN" should have version equal to variable "EXPECTED_MIRROR_TAG"
    And the compose file "../test/compose-stack/docker-compose.mirror.active.yml" should pin service "zz_mirror_app" to "mirror.local/ghcr.io/stefanprodan/podinfo:6.0.0"
    And the compose file "../test/compose-stack/docker-compose.mirror.active.yml" should pin service "zz_mirror_bystander" to "ghcr.io/stefanprodan/podinfo:5.0.0"

  Scenario: Reject a single compose trigger when the compose file cannot be resolved
    When I find the container with name "zz_compose_unresolvable" and save its ID as "URID", version as "URV", and name as "URN"
    And I send POST to /api/containers/`URID`/triggers/dockercompose/update
    Then response code should be 400
    And response body path $.error should be Container zz_compose_unresolvable cannot be updated by this trigger.*
    And response body path $.details[0].reason should be none of its candidate compose files exist.*
    And I GET /api/containers/`URID`
    And response body path $.image.tag.value should be 6.0.0
