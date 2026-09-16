import axios, {
    AxiosRequestConfig,
    Method,
    AxiosResponse,
    AxiosInstance,
} from 'axios';
import log, { registerAxiosErrorLogging } from '../log';
import Component from '../registry/Component';
import { getSummaryTags } from '../prometheus/registry';
import { ContainerImage } from '../model/container';

export interface RegistryManifest {
    digest?: string;
    version?: number;
    created?: string;
}

export interface RegistryTagsList {
    name: string;
    tags: string[] | null;
}

export interface RegistryManifestResponse {
    schemaVersion: number;
    mediaType?: string;
    manifests?: {
        digest: string;
        mediaType: string;
        platform: {
            architecture: string;
            os: string;
            variant?: string;
        };
    }[];
    config?: {
        digest: string;
        mediaType: string;
    };
    history?: {
        v1Compatibility: string;
    }[];
}

const WATERMARK_OFFSET = 3;

/**
 * Docker Registry Abstract class.
 */
export class Registry extends Component {
    protected axiosInstance: AxiosInstance;

    private tagListsInFlight: Map<string, Promise<string[]>> = new Map();

    private tagListCache: Map<string, string[]> = new Map();

    constructor() {
        super();
        this.axiosInstance = axios.create();
        registerAxiosErrorLogging(this.axiosInstance, () => this.log);
    }

    /**
     * Encode Bse64(login:password)
     */
    static base64Encode(login: string, token: string) {
        return Buffer.from(`${login}:${token}`, 'utf-8').toString('base64');
    }

    /**
     * Check if the digest label value is to be watched for this registry (to be overridden).
     */
    shouldWatchDigest(_wudWatchDigestLabelValue: string, _image: string) {
        return true;
    }

    /**
     * If this registry is responsible for the image url (to be overridden).
     */
    match(_imageUrl: string): boolean {
        return false;
    }

    /**
     * Normalize image according to Registry Custom characteristics (to be overridden).
     */
    normalizeImage(image: ContainerImage): ContainerImage {
        return image;
    }

    /**
     * Authenticate and set authentication value to requestOptions.
     */
    async authenticate(
        _image: ContainerImage,
        requestOptions: AxiosRequestConfig,
    ): Promise<AxiosRequestConfig> {
        return requestOptions;
    }

    /**
     * Get Tags.
     *
     * The returned array is shared between concurrent callers and must not be mutated.
     */
    async getTags(image: ContainerImage): Promise<string[]> {
        const key = this.getTagListCacheKey(image);
        const inFlight = this.tagListsInFlight.get(key);
        if (inFlight) {
            this.log.debug(
                `Reuse in-flight tag list request for ${image.name}`,
            );
            return inFlight;
        }
        const request = this.resolveTagList(image, key);
        this.tagListsInFlight.set(key, request);
        try {
            return await request;
        } finally {
            // Deregistration may have cleared the map and a newer request may already own the key
            if (this.tagListsInFlight.get(key) === request) {
                this.tagListsInFlight.delete(key);
            }
        }
    }

    /**
     * Resolve the sorted tag list for an image.
     */
    private async resolveTagList(
        image: ContainerImage,
        key: string,
    ): Promise<string[]> {
        if (this.isIncrementalTagListingEnabled()) {
            const cached = this.tagListCache.get(key);
            // Without this a short repository would log the fallback below every cycle
            if (cached && cached.length > WATERMARK_OFFSET) {
                const delta = await this.fetchTagsSinceWatermark(image, cached);
                if (delta !== undefined) {
                    const merged = this.mergeTagDelta(cached, delta);
                    this.tagListCache.set(key, merged);
                    this.log.debug(
                        `${image.name}: incremental tag fetch returned ${delta.length} new tag(s) (${merged.length} total)`,
                    );
                    return this.sortTagsDesc(merged);
                }
                this.log.info(
                    `${image.name}: incremental tag listing watermark is no longer valid; falling back to a full tag crawl`,
                );
                this.tagListCache.delete(key);
            }
        }
        const tags = await this.crawlAllTags(image);
        if (this.isIncrementalTagListingEnabled()) {
            this.tagListCache.set(key, tags);
        }
        return this.sortTagsDesc(tags);
    }

    /**
     * Fetch the tags added since the cached watermark.
     *
     * Returns undefined when the registry response contradicts the cached list
     * (the caller must then full-crawl); an empty array means nothing is new.
     */
    private async fetchTagsSinceWatermark(
        image: ContainerImage,
        cached: string[],
    ): Promise<string[] | undefined> {
        if (cached.length < WATERMARK_OFFSET + 1) {
            return undefined;
        }
        const watermarkIndex = cached.length - WATERMARK_OFFSET;
        const expectedEcho = cached.slice(watermarkIndex + 1);

        let page = await this.getTagsPage(image, cached[watermarkIndex]);
        let pageTags = page?.data?.tags ?? [];

        if (pageTags.length < expectedEcho.length) {
            return undefined;
        }
        for (let i = 0; i < expectedEcho.length; i += 1) {
            if (pageTags[i] !== expectedEcho[i]) {
                return undefined;
            }
        }

        const collected: string[] = pageTags.slice(expectedEcho.length);
        let link: string | undefined = page?.headers?.link;
        // An empty page has no cursor, and getTagsPage without one restarts from page one
        while (link !== undefined && pageTags.length > 0) {
            page = await this.getTagsPage(
                image,
                pageTags[pageTags.length - 1],
                link,
            );
            pageTags = page?.data?.tags ?? [];
            link = page?.headers?.link;
            collected.push(...pageTags);
        }
        return collected;
    }

    /**
     * Append a delta to the cached registry-order tag list.
     */
    private mergeTagDelta(cached: string[], delta: string[]): string[] {
        if (delta.length === 0) {
            return cached;
        }
        const deltaSet = new Set(delta);
        // A tag deleted then re-pushed reappears at the end of the creation-ordered list
        return [...cached.filter((t) => !deltaSet.has(t)), ...delta];
    }

    /**
     * Key identifying an image tag list within this registry instance.
     */
    private getTagListCacheKey(image: ContainerImage): string {
        return `${image.registry.url}|${image.name}`;
    }

    /**
     * To be overridden by registries whose tag list is append-only and whose
     * last= cursor is positional.
     */
    supportsIncrementalTagListing(): boolean {
        return false;
    }

    /**
     * Whether incremental tag listing is both supported and consented to.
     */
    isIncrementalTagListingEnabled(): boolean {
        if (!this.supportsIncrementalTagListing()) {
            return false;
        }
        const configured = this.configuration?.incrementaltags;
        return configured !== false && configured !== 'false';
    }

    /**
     * Drop the tag list state kept for this registry instance.
     */
    async deregisterComponent(): Promise<void> {
        this.tagListsInFlight.clear();
        this.tagListCache.clear();
    }

    /**
     * Crawl all pages of the registry tag list; returns tags in registry order.
     */
    protected async crawlAllTags(image: ContainerImage): Promise<string[]> {
        this.log.debug(`Get ${image.name} tags`);
        const tags: string[] = [];
        let page: AxiosResponse<RegistryTagsList> | undefined = undefined;
        let hasNext = true;
        let link: string | undefined = undefined;
        while (hasNext) {
            const lastItem =
                page && page.data && page.data.tags
                    ? page.data.tags[page.data.tags.length - 1]
                    : undefined;

            page = await this.getTagsPage(image, lastItem, link);
            const pageTags =
                page && page.data && page.data.tags ? page.data.tags : [];
            link = page && page.headers ? page.headers.link : undefined;
            hasNext = page && page.headers && page.headers.link !== undefined;
            tags.push(...pageTags);
        }

        return tags;
    }

    /**
     * Sort alpha then reverse to get higher values first.
     */
    protected sortTagsDesc(tags: string[]): string[] {
        return [...tags].sort().reverse();
    }

    /**
     * Get tags page
     */
    getTagsPage(
        image: ContainerImage,
        lastItem: string | undefined = undefined,
        _link: string | undefined = undefined,
    ) {
        // Default items per page (not honoured by all registries)
        const itemsPerPage = 1000;
        const last = lastItem ? `&last=${lastItem}` : '';
        return this.callRegistry<RegistryTagsList>({
            image,
            url: `${image.registry.url}/${image.name}/tags/list?n=${itemsPerPage}${last}`,
            resolveWithFullResponse: true,
        });
    }

    /**
     * Get image manifest for a remote tag.
     */
    async getImageManifestDigest(
        image: ContainerImage,
        digest?: string,
    ): Promise<RegistryManifest> {
        const tagOrDigest = digest || image.tag.value;
        let manifestDigestFound;
        let manifestMediaType;
        this.log.debug(
            `${this.getId()} - Get ${image.name}:${tagOrDigest} manifest`,
        );
        const responseManifests =
            await this.callRegistry<RegistryManifestResponse>({
                image,
                url: `${image.registry.url}/${image.name}/manifests/${tagOrDigest}`,
                headers: {
                    Accept: 'application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json',
                },
            });
        if (responseManifests) {
            this.log.debug(
                `Found manifests [${JSON.stringify(responseManifests)}]`,
            );
            if (responseManifests.schemaVersion === 2) {
                this.log.debug('Manifests found with schemaVersion = 2');
                this.log.debug(
                    `Manifests media type detected [${responseManifests.mediaType}]`,
                );
                if (
                    responseManifests.mediaType ===
                        'application/vnd.docker.distribution.manifest.list.v2+json' ||
                    responseManifests.mediaType ===
                        'application/vnd.oci.image.index.v1+json'
                ) {
                    this.log.debug(
                        `Filter manifest for [arch=${image.architecture}, os=${image.os}, variant=${image.variant}]`,
                    );
                    let manifestFound;
                    const manifestFounds = responseManifests.manifests.filter(
                        (manifest: any) =>
                            manifest.platform.architecture ===
                                image.architecture &&
                            manifest.platform.os === image.os,
                    );

                    // 1 manifest matching al least? Get the first one (better than nothing)
                    if (manifestFounds.length > 0) {
                        [manifestFound] = manifestFounds;
                    }

                    // Multiple matching manifests? Try to refine using variant filtering
                    if (manifestFounds.length > 1) {
                        const manifestFoundFilteredOnVariant =
                            manifestFounds.find(
                                (manifest: any) =>
                                    manifest.platform.variant === image.variant,
                            );

                        // Manifest exactly matching with variant? Select it
                        if (manifestFoundFilteredOnVariant) {
                            manifestFound = manifestFoundFilteredOnVariant;
                        }
                    }

                    if (manifestFound) {
                        this.log.debug(
                            `Manifest found with [digest=${manifestFound.digest}, mediaType=${manifestFound.mediaType}]`,
                        );
                        manifestDigestFound = manifestFound.digest;
                        manifestMediaType = manifestFound.mediaType;
                    }
                } else if (
                    responseManifests.mediaType ===
                        'application/vnd.docker.distribution.manifest.v2+json' ||
                    responseManifests.mediaType ===
                        'application/vnd.oci.image.manifest.v1+json'
                ) {
                    // Single-platform manifest (no list/index) => the reference
                    // we already fetched it by (tag or digest) *is* the manifest
                    // identifier. Do not use responseManifests.config.digest here;
                    // that's the digest of the config blob, not of the manifest,
                    // and is not a valid value to re-request a manifest with.
                    this.log.debug(
                        `Manifest found with [reference=${tagOrDigest}, mediaType=${responseManifests.mediaType}]`,
                    );
                    manifestDigestFound = tagOrDigest;
                    manifestMediaType = responseManifests.mediaType;
                }
            } else if (responseManifests.schemaVersion === 1) {
                this.log.debug('Manifests found with schemaVersion = 1');
                const v1Compat = JSON.parse(
                    responseManifests.history[0].v1Compatibility,
                );
                const manifestFound = {
                    digest: v1Compat.config ? v1Compat.config.Image : undefined,
                    created: v1Compat.created,
                    version: 1,
                };
                this.log.debug(
                    `Manifest found with [digest=${manifestFound.digest}, created=${manifestFound.created}, version=${manifestFound.version}]`,
                );
                return manifestFound;
            }
            if (
                (manifestDigestFound &&
                    manifestMediaType ===
                        'application/vnd.docker.distribution.manifest.v2+json') ||
                (manifestDigestFound &&
                    manifestMediaType ===
                        'application/vnd.oci.image.manifest.v1+json')
            ) {
                log.debug(
                    'Calling registry to get docker-content-digest header',
                );
                const responseManifest =
                    await this.callRegistry<RegistryManifestResponse>({
                        image,
                        method: 'head',
                        url: `${image.registry.url}/${image.name}/manifests/${manifestDigestFound}`,
                        headers: {
                            Accept: manifestMediaType,
                        },
                        resolveWithFullResponse: true,
                    });
                const manifestFound = {
                    digest: responseManifest.headers['docker-content-digest'],
                    version: 2,
                };
                log.debug(
                    `Manifest found with [digest=${manifestFound.digest}, version=${manifestFound.version}]`,
                );
                return manifestFound;
            }
            if (
                (manifestDigestFound &&
                    manifestMediaType ===
                        'application/vnd.docker.container.image.v1+json') ||
                (manifestDigestFound &&
                    manifestMediaType ===
                        'application/vnd.oci.image.config.v1+json')
            ) {
                const manifestFound = {
                    digest: manifestDigestFound,
                    version: 1,
                };
                log.debug(
                    `Manifest found with [digest=${manifestFound.digest}, version=${manifestFound.version}]`,
                );
                return manifestFound;
            }
        }
        // Empty result...
        throw new Error('Unexpected error; no manifest found');
    }

    async callRegistry<T = any>(options: {
        image: ContainerImage;
        url: string;
        method?: Method;
        headers?: any;
        resolveWithFullResponse: true;
    }): Promise<AxiosResponse<T>>;

    async callRegistry<T = any>(options: {
        image: ContainerImage;
        url: string;
        method?: Method;
        headers?: any;
        resolveWithFullResponse?: false;
    }): Promise<T>;

    async callRegistry<T = any>({
        image,
        url,
        method = 'get',
        headers = {
            Accept: 'application/json',
        },
        resolveWithFullResponse = false,
    }: {
        image: ContainerImage;
        url: string;
        method?: Method;
        headers?: any;
        resolveWithFullResponse?: boolean;
    }): Promise<T | AxiosResponse<T>> {
        const start = new Date().getTime();

        // Request options
        const axiosOptions: AxiosRequestConfig = {
            url,
            method,
            headers,
            responseType: 'json',
        };

        const axiosOptionsWithAuth = await this.authenticate(
            image,
            axiosOptions,
        );

        try {
            const response = (await this.axiosInstance(
                axiosOptionsWithAuth,
            )) as AxiosResponse<T>;
            this.observePrometheusSummaryTags(start);
            return resolveWithFullResponse ? response : response.data;
        } catch (error) {
            this.observePrometheusSummaryTags(start);
            throw error;
        }
    }

    observePrometheusSummaryTags(start: number) {
        // The metric may be undefined if running in Agent mode because Prometheus is disabled
        const summaryTags = getSummaryTags();
        if (summaryTags) {
            const end = new Date().getTime();
            summaryTags.observe(
                { type: this.type, name: this.name },
                (end - start) / 1000,
            );
        }
    }

    getImageFullName(image: ContainerImage, tagOrDigest: string) {
        // digests are separated with @ whereas tags are separated with :
        const tagOrDigestWithSeparator =
            tagOrDigest.indexOf(':') !== -1
                ? `@${tagOrDigest}`
                : `:${tagOrDigest}`;
        let fullName = `${image.registry.url}/${image.name}${tagOrDigestWithSeparator}`;

        fullName = fullName.replace(/https?:\/\//, '');
        fullName = fullName.replace(/\/v2/, '');
        return fullName;
    }

    /**
     * Return {username, pass } or undefined.
     */
    async getAuthPull(): Promise<
        { username?: string; password?: string } | undefined
    > {
        return undefined;
    }
}

export default Registry;
