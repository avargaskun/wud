import parse from 'parse-docker-image-name';
import {
    parse as parseSemver,
    isGreater as isGreaterSemver,
    transform as transformTag,
    diff as diffSemver,
    compare as compareSemver,
} from '../../../tag';
import log from '../../../log';
import { wudWatchDigest, wudWatchDigestSemver } from './label';
import {
    validate as validateContainer,
    fullName,
    renderLink,
} from '../../../model/container';
import * as registry from '../../../registry';
import {
    Container,
    ContainerResult,
    ContainerUpdate,
    ContainerUpdates,
    UpdateBucketKey,
} from '../../../model/container';

/**
 * Return all supported registries
 * @returns {*}
 */
export function getRegistries(): Record<string, any> {
    return registry.getState().registry;
}

/**
 * Get the Docker Registry by name.
 * @param registryName
 */
export function getRegistry(registryName: string): any {
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
export function getTagCandidates(
    container: Container,
    tags: string[],
    logContainer: any,
): string[] {
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
        // Prefix is almost-always standardized around "must stay the same" for tags
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
            const cmp = compareSemver(
                transformTag(container.transformTags, t2),
                transformTag(container.transformTags, t1),
            );
            // Unparseable pair -> preserve the previous behaviour rather than inventing an order
            return cmp === null ? (isGreaterSemver(t2, t1) ? 1 : -1) : cmp;
        });
    } else {
        // Non semver tag -> do not propose any other registry tag
        filteredTags = [];
    }
    return filteredTags;
}

/**
 * Map a raw semver diff to the update bucket it belongs to.
 * A prerelease diff deliberately folds into the patch bucket.
 * @param rawDiff
 */
export function mapDiffToBucket(
    rawDiff: string | null,
): UpdateBucketKey | undefined {
    switch (rawDiff) {
        case 'major':
        case 'premajor':
            return 'major';
        case 'minor':
        case 'preminor':
            return 'minor';
        case 'patch':
        case 'prepatch':
            return 'patch';
        case 'prerelease':
            return 'patch';
        default:
            return undefined;
    }
}

/**
 * Map a raw semver diff to the semverDiff reported on the bucket.
 * @param rawDiff
 */
export function mapDiffToSemverDiff(
    rawDiff: string | null,
): ContainerUpdate['semverDiff'] {
    switch (rawDiff) {
        case 'major':
        case 'premajor':
            return 'major';
        case 'minor':
        case 'preminor':
            return 'minor';
        case 'patch':
        case 'prepatch':
            return 'patch';
        case 'prerelease':
            return 'prerelease';
        default:
            return undefined;
    }
}

/**
 * Return the buckets that are structurally possible for a container.
 * @param container
 */
export function getApplicableBuckets(container: Container): UpdateBucketKey[] {
    const buckets: UpdateBucketKey[] = [];
    if (container.image.tag.semver) {
        // Measure the TRANSFORMED tag: computeUpdateBuckets assigns buckets by diffing
        // transformed values, so a segment-changing wud.tag.transform would otherwise
        // drop every bucket via the `bucket in updates` guard.
        const localTransformed = transformTag(
            container.transformTags,
            container.image.tag.value,
        );
        const numericPart = localTransformed.match(/(\d+(\.\d+)*)/);
        // No numeric part -> the segment lock is skipped entirely, so all levels are possible
        const segments = numericPart ? numericPart[0].split('.').length : 3;
        if (segments >= 1) buckets.push('major');
        if (segments >= 2) buckets.push('minor');
        if (segments >= 3) buckets.push('patch');
    }
    if (container.image.digest.watch) buckets.push('digest');
    return buckets;
}

/**
 * Render a bucket link, never throwing: renderLink evals a user-supplied label.
 * @param container
 * @param tagValue
 */
function renderBucketLink(
    container: Container,
    tagValue: string,
): string | undefined {
    try {
        return renderLink(container, tagValue);
    } catch (e) {
        log.debug(
            `Error when rendering link template for tag [${tagValue}] (${e})`,
        );
        return undefined;
    }
}

/**
 * Compute the per-kind update buckets of a container.
 * @param container
 * @param tagsCandidates
 * @param result
 */
export function computeUpdateBuckets(
    container: Container,
    tagsCandidates: string[],
    result: ContainerResult,
): ContainerUpdates {
    const updates: ContainerUpdates = {};
    getApplicableBuckets(container).forEach((bucketKey) => {
        updates[bucketKey] = null;
    });

    const localTag = container.image.tag.value;
    const localTransformed = transformTag(container.transformTags, localTag);

    (tagsCandidates ?? []).forEach((candidate) => {
        const candidateTransformed = transformTag(
            container.transformTags,
            candidate,
        );
        const rawDiff = diffSemver(localTransformed, candidateTransformed);
        const bucket = mapDiffToBucket(rawDiff);
        if (!bucket || !(bucket in updates)) {
            return;
        }

        const incumbent = updates[bucket];
        if (incumbent) {
            const cmp = compareSemver(
                candidateTransformed,
                transformTag(container.transformTags, incumbent.remoteValue),
            );
            // Ties and unparseable pairs keep the incumbent (first encountered wins)
            if (cmp === null || cmp <= 0) {
                return;
            }
        }
        updates[bucket] = {
            kind: 'tag',
            localValue: localTag,
            remoteValue: candidate,
            semverDiff: mapDiffToSemverDiff(rawDiff),
            link: renderBucketLink(container, candidate),
        };
    });

    // Digest bucket - always against the CURRENT tag
    if (
        'digest' in updates &&
        container.image.digest.value !== undefined &&
        result.digest !== undefined &&
        container.image.digest.value !== result.digest
    ) {
        updates.digest = {
            kind: 'digest',
            localValue: container.image.digest.value,
            remoteValue: result.digest,
            created: result.created,
            link: renderBucketLink(container, localTag),
        };
    }

    return updates;
}

/**
 * Return true if the digest must be watched for a container.
 * @param registryProvider
 * @param isSemver
 * @param watchDigestLabelValue the value of the wud.watch.digest label
 * @param watchDigestSemverLabelValue the value of the wud.watch.digest.semver label
 * @param imageName
 */
export function shouldWatchDigestForContainer(
    registryProvider: any,
    isSemver: boolean,
    watchDigestLabelValue: string | undefined,
    watchDigestSemverLabelValue: string | undefined,
    imageName: string,
): boolean {
    if (isSemver) {
        // Semver containers: opt in via the DEDICATED label only.
        // Deliberately NOT wud.watch.digest -- that label is inert on semver tags
        // today, so honouring it would activate digest watching on upgrade for
        // deployments that already set it, recreating running containers unprompted.
        // The provider default is likewise not consulted: most providers default to
        // true, which would add 2 HTTP calls per container per cycle everywhere.
        return watchDigestSemverLabelValue === 'true';
    }
    return registryProvider.shouldWatchDigest(watchDigestLabelValue, imageName);
}

export function normalizeContainer(container: Container): Container {
    const containerWithNormalizedImage = container;
    const registryProvider = Object.values(getRegistries()).find((provider) =>
        provider.match(container.image.registry.url),
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

export function getContainerName(container: any): string {
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
export function getRepoDigest(containerImage: any): string | undefined {
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
export function isContainerToWatch(
    wudWatchLabelValue: string | undefined,
    watchByDefault: boolean,
): boolean {
    return wudWatchLabelValue !== undefined && wudWatchLabelValue !== ''
        ? wudWatchLabelValue.toLowerCase() === 'true'
        : watchByDefault;
}

export interface FindNewVersionResult {
    result: ContainerResult;
    updates: ContainerUpdates;
}

/**
 * Find new version for a Container.
 * @param container
 * @param dockerApi - Optional, used for v1 manifest legacy check
 * @param logContainer
 */
export async function findNewVersion(
    container: Container,
    dockerApi: any,
    logContainer: any,
): Promise<FindNewVersionResult> {
    const registryProvider = getRegistry(container.image.registry.name);
    const result: ContainerResult = { tag: container.image.tag.value };
    if (!registryProvider) {
        logContainer.error(
            `Unsupported registry (${container.image.registry.name})`,
        );
        return { result, updates: {} };
    } else {
        const watchDigest = shouldWatchDigestForContainer(
            registryProvider,
            container.image.tag.semver,
            container.labels?.[wudWatchDigest],
            container.labels?.[wudWatchDigestSemver],
            container.image.name,
        );

        if (!container.image.tag.semver && !watchDigest) {
            logContainer.warn(
                `Image ${container.image.name} is not a semver and digest watching is disabled so wud won't report any update. Please review the configuration to enable digest watching for this container or exclude this container from being watched`,
            );
        }

        // Get all available tags
        const tags = await registryProvider.getTags(container.image);

        // Get candidate tags (based on tag name)
        const tagsCandidates = getTagCandidates(container, tags, logContainer);

        // Must watch digest? => Find local/remote digests on registry
        if (watchDigest && container.image.digest.repo) {
            // The digest is always resolved against the currently running tag
            const imageToGetDigestFrom = JSON.parse(
                JSON.stringify(container.image),
            );

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
                    // Legacy v1 image => take Image digest as reference for comparison.
                    // Config.Image is empty on most modern images (deprecated since
                    // Docker moved to content-addressable image storage), so fall back
                    // to the local image Id, which is the config digest Docker itself
                    // uses to identify this image.
                    const image = await dockerApi
                        .getImage(container.image.id)
                        .inspect();
                    container.image.digest.value =
                        image.Config.Image || image.Id;
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

        return {
            result,
            updates: computeUpdateBuckets(container, tagsCandidates, result),
        };
    }
}
