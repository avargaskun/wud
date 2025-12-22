const log = require('../log');
const {
    parse: parseSemver,
    isGreater: isGreaterSemver,
    transform: transformTag,
} = require('../tag');

/**
 * Filter candidate tags (based on tag name).
 * @param container
 * @param tags
 * @returns {*}
 */
function getTagCandidates(container, tags, logContainer) {
    let filteredTags = tags;

    // Match include tag regex
    if (container.includeTags) {
        const includeTagsRegex = new RegExp(container.includeTags);
        filteredTags = filteredTags.filter((tag) => includeTagsRegex.test(tag));
    } else {
        // If no includeTags, filter out tags starting with "sha"
        filteredTags = filteredTags.filter(tag => !tag.startsWith('sha'));
    }

    // Match exclude tag regex
    if (container.excludeTags) {
        const excludeTagsRegex = new RegExp(container.excludeTags);
        filteredTags = filteredTags.filter(
            (tag) => !excludeTagsRegex.test(tag),
        );
    }

    // Always filter out tags ending with ".sig"
    filteredTags = filteredTags.filter(tag => !tag.endsWith('.sig'));

    // Semver image -> find higher semver tag
    if (container.image.tag.semver) {
        if (filteredTags.length === 0) {
            logContainer.warn(
                'No tags found after filtering; check you regex filters',
            );
        }

        // If user has not specified custom include regex, default to keep current prefix
        // Prefix is almost-always standardised around "must stay the same" for tags
        if (!container.includeTags) {
            const currentTag = container.image.tag.value;
            const match = currentTag.match(/^(.*?)(\d+.*)$/);
            const currentPrefix = match ? match[1] : '';

            if (currentPrefix) {
                // Retain only tags with the same non-empty prefix
                filteredTags = filteredTags.filter(tag => tag.startsWith(currentPrefix));
            } else {
                // Retain only tags that start with a number (no prefix)
                filteredTags = filteredTags.filter(tag => /^\d/.test(tag));
            }

            // Ensure we throw good errors when we've prefix-related issues
            if (filteredTags.length === 0) {
                if (currentPrefix) {
                    logContainer.warn(
                        "No tags found with existing prefix: '" + currentPrefix + "'; check your regex filters",
                    );
                } else {
                    logContainer.warn(
                        "No tags found starting with a number (no prefix); check your regex filters",
                    );
                }
            }
        }

        // Keep semver only
        filteredTags = filteredTags.filter(
            (tag) =>
                parseSemver(transformTag(container.transformTags, tag)) !==
                null,
        );

        // Remove prefix and suffix (keep only digits and dots)
        const numericPart = container.image.tag.value.match(/(\d+(\.\d+)*)/);

        if (numericPart) {
          const referenceGroups = numericPart[0].split('.').length;

          filteredTags = filteredTags.filter((tag) => {
            const tagNumericPart = tag.match(/(\d+(\.\d+)*)/);
            if (!tagNumericPart) return false; // skip tags without numeric part
            const tagGroups = tagNumericPart[0].split('.').length;

            // Keep only tags with the same number of numeric segments
            return tagGroups === referenceGroups;
          });
        }

        // Keep only greater semver
        filteredTags = filteredTags.filter((tag) =>
            isGreaterSemver(
                transformTag(container.transformTags, tag),
                transformTag(
                    container.transformTags,
                    container.image.tag.value,
                ),
            ),
        );

        // Apply semver sort desc
        filteredTags.sort((t1, t2) => {
            const greater = isGreaterSemver(
                transformTag(container.transformTags, t2),
                transformTag(container.transformTags, t1),
            );
            return greater ? 1 : -1;
        });
    } else {
        // Non semver tag -> do not propose any other registry tag
        filteredTags = [];
    }
    return filteredTags;
}

/**
 * Find new version for a Container.
 */
async function findNewVersion(container, logContainer, registryProvider, dockerApi) {
    const result = { tag: container.image.tag.value };
    if (!registryProvider) {
        logContainer.error(
            `Unsupported registry (${container.image.registry.name})`,
        );
        return result;
    } else {
        // Get all available tags
        const tags = await registryProvider.getTags(container.image);

        // Get candidate tags (based on tag name)
        const tagsCandidates = getTagCandidates(
            container,
            tags,
            logContainer,
        );

        // Must watch digest? => Find local/remote digests on registry
        if (container.image.digest.watch && container.image.digest.repo) {
            // If we have a tag candidate BUT we also watch digest
            // (case where local=`mongo:8` and remote=`mongo:8.0.0`),
            // Then get the digest of the tag candidate
            // Else get the digest of the same tag as the local one
            const imageToGetDigestFrom = JSON.parse(
                JSON.stringify(container.image),
            );
            if (tagsCandidates.length > 0) {
                [imageToGetDigestFrom.tag.value] = tagsCandidates;
            }

            const remoteDigest =
                await registryProvider.getImageManifestDigest(
                    imageToGetDigestFrom,
                );

            result.digest = remoteDigest.digest;
            result.created = remoteDigest.created;

            if (remoteDigest.version === 2) {
                // Regular v2 manifest => Get manifest digest

                const digestV2 =
                    await registryProvider.getImageManifestDigest(
                        imageToGetDigestFrom,
                        container.image.digest.repo,
                    );
                container.image.digest.value = digestV2.digest;
            } else {
                // Legacy v1 image => take Image digest as reference for comparison
                // dockerApi is optional because it is only available when running as a watcher
                // but for remote agents/controller version checking, we might not have it or need it
                // If dockerApi is missing, we skip this check (or handle it gracefully)
                if (dockerApi) {
                    const image = await dockerApi
                        .getImage(container.image.id)
                        .inspect();
                    container.image.digest.value =
                        image.Config.Image === ''
                            ? undefined
                            : image.Config.Image;
                }
            }
        }

        // The first one in the array is the highest
        if (tagsCandidates && tagsCandidates.length > 0) {
            [result.tag] = tagsCandidates;
        }
    }
    return result;
}

module.exports = {
    findNewVersion,
    getTagCandidates
};
