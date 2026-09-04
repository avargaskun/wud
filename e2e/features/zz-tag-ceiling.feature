Feature: WUD Tag Ceiling

  # zz_ceiling_static runs podinfo 6.0.0 restricted to ^6\.\d+\.\d+$ with a static ceiling of 6.0.
  # zz_mv_buckets uses the identical include regex with no ceiling and does report a minor update,
  # so a null minor here can only come from the ceiling.
  Scenario: WUD must cap tag candidates with a static version ceiling
    When I find the container with name "zz_ceiling_static" and save its ID as "CID", version as "CV", and name as "CN"
    And I resolve the latest version for image "stefanprodan/podinfo" on registry "ghcr.public" with strategy "dynamic" and pattern "^6\.0\.\d+$" and value "" as "EXPECTED_PATCH_TAG"
    And I GET /api/containers/`CID`
    Then response code should be 200
    And response body should be valid json
    And response body path $.name should be zz_ceiling_static
    And response body path $.image.tag.value should be 6.0.0
    And response body path $.ceiling.version should be 6.0
    And response body path $.ceiling.tag must be absent
    And response body path $.updates.patch.remoteValue should equal variable "EXPECTED_PATCH_TAG"
    And response body path $.updates.patch.semverDiff should be patch
    And response body path $.updates.minor must be exactly null
    And response body path $.updates.major must be exactly null
    # The container appearing at all is the real assertion: an undeclared gauge label makes
    # prom-client throw, populateGauge swallows it, and the container vanishes from wud_containers.
    When I GET /metrics
    Then response code should be 200
    And response body should contain name="zz_ceiling_static"
