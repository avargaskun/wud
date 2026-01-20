// @ts-nocheck
import parse from 'parse-docker-image-name';
import {
    parse as parseSemver,
    isGreater as isGreaterSemver,
    transform as transformTag,
} from '../../../tag';
import log from '../../../log';
import {
    validate as validateContainer,
    fullName,
} from '../../../model/container';
import * as registry from '../../../registry';

/**
 * Return all supported registries
 * @returns {*}
 */
export function getRegistries() {
    return registry.getState().registry;
}

/**
 * Get the Docker Registry by name.
 * @param registryName
 */
export function getRegistry(registryName) {
    const registryToReturn = getRegistries()[registryName];
    if (!registryToReturn) {
        throw new Error(`Unsupported Registry ${registryName}`);
    }
    return registryToReturn;
}

/**
 * Filter candidate tags (based on tag name).
 * @param container
 * @param tags
 * @returns {*}
 */
export function getTagCandidates(container, tags, logContainer) {
    let filteredTags = tags;

    // Match include tag regex
    if (container.includeTags) {
        const includeTagsRegex = new RegExp(container.includeTags);
        filteredTags = filteredTags.filter((tag) => includeTagsRegex.test(tag));
    } else {
        // If no includeTags, filter out tags starting with "sha"
        filteredTags = filteredTags.filter((tag) => !tag.startsWith('sha'));
    }

    // Match exclude tag regex
    if (container.excludeTags) {
        const excludeTagsRegex = new RegExp(container.excludeTags);
        filteredTags = filteredTags.filter(
            (tag) => !excludeTagsRegex.test(tag),
        );
    }

    // Always filter out tags ending with ".sig"
    filteredTags = filteredTags.filter((tag) => !tag.endsWith('.sig'));

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
                filteredTags = filteredTags.filter((tag) =>
                    tag.startsWith(currentPrefix),
                );
            } else {
                // Retain only tags that start with a number (no prefix)
                filteredTags = filteredTags.filter((tag) => /^\d/.test(tag));
            }

            // Ensure we throw good errors when we've prefix-related issues
            if (filteredTags.length === 0) {
                if (currentPrefix) {
                    logContainer.warn(
                        "No tags found with existing prefix: '" +
                            currentPrefix +
                            "'; check your regex filters",
                    );
                } else {
                    logContainer.warn(
                        'No tags found starting with a number (no prefix); check your regex filters',
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

export function normalizeContainer(container) {
    const containerWithNormalizedImage = container;
    const registryProvider = Object.values(getRegistries()).find((provider) =>
        provider.match(container.image),
    );
    if (!registryProvider) {
        log.warn(`${fullName(container)} - No Registry Provider found`);
        containerWithNormalizedImage.image.registry.name = 'unknown';
        if (!containerWithNormalizedImage.image.registry.url) {
            containerWithNormalizedImage.image.registry.url = 'unknown';
        }
    } else {
        containerWithNormalizedImage.image = registryProvider.normalizeImage(
            container.image,
        );
        containerWithNormalizedImage.image.registry.name =
            registryProvider.getId();
    }
    return validateContainer(containerWithNormalizedImage);
}

export function getContainerName(container) {
    let containerName;
    const names = container.Names;
    if (names && names.length > 0) {
        [containerName] = names;
    }
    // Strip ugly forward slash
    containerName = containerName.replace(/\//, '');
    return containerName;
}

/**
 * Get image repo digest.
 * @param containerImage
 * @returns {*} digest
 */
export function getRepoDigest(containerImage) {
    if (
        !containerImage.RepoDigests ||
        containerImage.RepoDigests.length === 0
    ) {
        return undefined;
    }
    const fullDigest = containerImage.RepoDigests[0];
    const digestSplit = fullDigest.split('@');
    return digestSplit[1];
}

/**
 * Return true if container must be watched.
 * @param wudWatchLabelValue the value of the wud.watch label
 * @param watchByDefault true if containers must be watched by default
 * @returns {boolean}
 */
export function isContainerToWatch(wudWatchLabelValue, watchByDefault) {
    return wudWatchLabelValue !== undefined && wudWatchLabelValue !== ''
        ? wudWatchLabelValue.toLowerCase() === 'true'
        : watchByDefault;
}

/**
 * Return true if container digest must be watched.
 * @param {string} wudWatchDigestLabelValue - the value of wud.watch.digest label
 * @param {object} parsedImage - object containing at least `domain` property
 * @returns {boolean}
 */
export function isDigestToWatch(
    wudWatchDigestLabelValue,
    parsedImage,
    isSemver,
) {
    const domain = parsedImage.domain;
    const isDockerHub =
        !domain ||
        domain === '' ||
        domain === 'docker.io' ||
        domain.endsWith('.docker.io');

    if (
        wudWatchDigestLabelValue !== undefined &&
        wudWatchDigestLabelValue !== ''
    ) {
        const shouldWatch = wudWatchDigestLabelValue.toLowerCase() === 'true';
        if (shouldWatch && isDockerHub) {
            log.warn(
                `Watching digest for image ${parsedImage.path} with domain ${domain} may result in throttled requests`,
            );
        }
        return shouldWatch;
    }

    if (isSemver) {
        return false;
    }

    return !isDockerHub;
}

/**
 * Find new version for a Container.
 * @param container
 * @param dockerApi - Optional, used for v1 manifest legacy check
 * @param logContainer
 */
export async function findNewVersion(container, dockerApi, logContainer) {
    const registryProvider = getRegistry(container.image.registry.name);
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
        const tagsCandidates = getTagCandidates(container, tags, logContainer);

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

                const digestV2 = await registryProvider.getImageManifestDigest(
                    imageToGetDigestFrom,
                    container.image.digest.repo,
                );
                container.image.digest.value = digestV2.digest;
            } else {
                if (dockerApi) {
                    // Legacy v1 image => take Image digest as reference for comparison
                    const image = await dockerApi
                        .getImage(container.image.id)
                        .inspect();
                    container.image.digest.value =
                        image.Config.Image === ''
                            ? undefined
                            : image.Config.Image;
                } else {
                    logContainer.warn(
                        'Cannot check legacy v1 image digest without Docker API access',
                    );
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
