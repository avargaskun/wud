import fs from 'fs/promises';
import path from 'path';
import yaml from 'yaml';
import { Scalar } from 'yaml';
import type { Document } from 'yaml';
import Docker from '../docker/Docker';
import { getState } from '../../../registry';
import { Container } from '../../../model/container';
import type { ContainerUpdateContext, TriggerRunResult } from '../docker/types';

/**
 * Minimal shape of a compose service — only the fields this trigger reads.
 */
interface ComposeService {
    image?: string;
    build?: unknown;
}

/**
 * Minimal shape of a parsed docker-compose file — only the fields this trigger reads.
 */
interface ComposeFile {
    services: Record<string, ComposeService>;
}

/**
 * A compose file read once: its exact bytes, its AST and its materialized services.
 */
interface LoadedCompose {
    source: string;
    doc: Document.Parsed;
    compose: ComposeFile;
}

/**
 * Outcome of matching a container against the services of a compose file.
 */
type ServiceResolution =
    | { status: 'resolved'; serviceName: string; source: 'label' | 'image' }
    | { status: 'not-found' }
    | { status: 'ambiguous'; candidates: string[] };

/**
 * A single character-range replacement to apply to a compose file.
 */
interface ComposeEdit {
    serviceName: string;
    start: number; // inclusive offset into LoadedCompose.source
    end: number; // exclusive offset into LoadedCompose.source
    text: string;
    from: string;
    to: string;
}

/**
 * Which containers got their compose image line spliced, and which were left stale.
 */
interface ComposeRewriteOutcome {
    editedIds: Set<string>;
    staleIds: Set<string>;
}

const COMPOSE_SERVICE_LABEL = 'com.docker.compose.service';

const HUB_HOSTS = new Set<string>([
    'docker.io',
    'index.docker.io',
    'registry-1.docker.io',
]);

const PLAIN_SAFE = /^[A-Za-z0-9._:/@-]+$/;

/**
 * Reduce an image reference to a comparable canonical form: drop an explicit
 * Docker Hub host, then drop a redundant `library/` namespace.
 */
function canonicalizeImageRef(ref: string): string {
    let rest: string = ref.trim();
    const slash: number = rest.indexOf('/');
    if (slash !== -1) {
        const head: string = rest.slice(0, slash);
        if (HUB_HOSTS.has(head)) {
            rest = rest.slice(slash + 1);
        }
    }
    if (rest.startsWith('library/') && rest.split('/').length === 2) {
        rest = rest.slice('library/'.length);
    }
    return rest;
}

/**
 * Return true when two image references are the same after canonicalization.
 */
function imageRefsMatch(a: string, b: string): boolean {
    return canonicalizeImageRef(a) === canonicalizeImageRef(b);
}

/**
 * The image reference WUD believes the container is currently running, in
 * registry-normalized form. Returns undefined instead of throwing when the
 * registry is unknown.
 */
function getCurrentImageRef(container: Container): string | undefined {
    const registry = getState().registry[container.image.registry.name];
    if (!registry) {
        return undefined;
    }
    try {
        return registry.getImageFullName(
            container.image,
            container.image.tag.value,
        );
    } catch {
        return undefined;
    }
}

/**
 * Return the image reference to write, derived from the one already in the file
 * by replacing only its tag. Returns undefined when the file's reference is not
 * tag-pinned.
 */
function buildUpdatedImageRef(
    currentFileRef: string,
    newTag: string,
): string | undefined {
    if (currentFileRef.includes('${')) {
        return undefined;
    }
    if (currentFileRef.includes('@')) {
        return undefined;
    }
    const lastColon: number = currentFileRef.lastIndexOf(':');
    const lastSlash: number = currentFileRef.lastIndexOf('/');
    if (lastColon === -1 || lastColon < lastSlash) {
        return undefined;
    }
    return `${currentFileRef.slice(0, lastColon)}:${newTag}`;
}

/**
 * Render a value back in the quoting style of the scalar it replaces.
 * Returns undefined when the value cannot be written in that style.
 */
function renderScalarValue(
    value: string,
    type: Scalar.Type | undefined,
): string | undefined {
    switch (type) {
        case Scalar.QUOTE_DOUBLE:
            return JSON.stringify(value);
        case Scalar.QUOTE_SINGLE:
            return `'${value.replaceAll("'", "''")}'`;
        case Scalar.PLAIN:
        case undefined:
            return PLAIN_SAFE.test(value) ? value : undefined;
        default:
            return undefined;
    }
}

/**
 * Apply character-range edits to the source string, in descending start order so
 * earlier offsets stay valid. Throws on overlapping ranges.
 */
function applyComposeEdits(source: string, edits: ComposeEdit[]): string {
    const ordered: ComposeEdit[] = [...edits].sort((a, b) => b.start - a.start);
    let result: string = source;
    let previousStart: number = Number.POSITIVE_INFINITY;
    for (const edit of ordered) {
        if (edit.end > previousStart) {
            throw new Error(
                `Overlapping compose edits for service ${edit.serviceName} at ${edit.start}-${edit.end}`,
            );
        }
        result =
            result.slice(0, edit.start) + edit.text + result.slice(edit.end);
        previousStart = edit.start;
    }
    return result;
}

/**
 * Resolve which compose service a container corresponds to. The file must first
 * pin the image the container runs; `com.docker.compose.service` then only
 * disambiguates between services sharing that pin.
 */
function resolveComposeServiceName(
    compose: ComposeFile,
    container: Container,
    currentImageRef: string | undefined,
): ServiceResolution {
    const services: Record<string, ComposeService> = compose?.services ?? {};

    if (currentImageRef === undefined) {
        return { status: 'not-found' };
    }

    const candidates: string[] = Object.keys(services).filter((key) => {
        const image: string | undefined = services[key]?.image;
        return (
            typeof image === 'string' && imageRefsMatch(image, currentImageRef)
        );
    });

    const serviceLabel: string | undefined = (container.labels ?? {})[
        COMPOSE_SERVICE_LABEL
    ];
    if (
        typeof serviceLabel === 'string' &&
        serviceLabel.length > 0 &&
        candidates.includes(serviceLabel)
    ) {
        return {
            status: 'resolved',
            serviceName: serviceLabel,
            source: 'label',
        };
    }

    if (candidates.length === 1) {
        return {
            status: 'resolved',
            serviceName: candidates[0],
            source: 'image',
        };
    }
    if (candidates.length === 0) {
        return { status: 'not-found' };
    }
    return { status: 'ambiguous', candidates };
}

/**
 * Return true if the container belongs to the compose file. An ambiguous
 * container still belongs: the file pins its image, we just cannot tell which
 * line is its own.
 */
function doesContainerBelongToCompose(
    compose: ComposeFile,
    container: Container,
): boolean {
    const resolution: ServiceResolution = resolveComposeServiceName(
        compose,
        container,
        getCurrentImageRef(container),
    );
    return (
        resolution.status === 'resolved' || resolution.status === 'ambiguous'
    );
}

/**
 * Update a Docker compose stack with an updated one.
 */
class Dockercompose extends Docker {
    /**
     * Get the Trigger configuration schema.
     * @returns {*}
     */
    getConfigurationSchema() {
        const schemaDocker = super.getConfigurationSchema();
        return schemaDocker.append({
            // Make file optional since we now support per-container compose files
            file: this.joi.string().optional(),
            backup: this.joi.boolean().default(false),
            // Add configuration for the label name to look for
            composeFileLabel: this.joi.string().default('wud.compose.file'),
        });
    }

    async initTrigger() {
        // Force mode=batch to avoid docker-compose concurrent operations
        this.configuration.mode = 'batch';

        // Check default docker-compose file exists if specified
        if (this.configuration.file) {
            try {
                await fs.access(this.configuration.file);
            } catch (e) {
                this.log.error(
                    `The default file ${this.configuration.file} does not exist`,
                );
                throw e;
            }
        }
    }

    /**
     * Get the compose file path for a specific container.
     * First checks for a label, then falls back to default configuration.
     * @param container
     * @returns {string|null}
     */
    getComposeFileForContainer(container: Container): string | null {
        // Check if container has a custom wud compose file label
        const composeFileLabel = this.configuration.composeFileLabel;
        if (container.labels && container.labels[composeFileLabel]) {
            const labelValue = container.labels[composeFileLabel];
            // Convert relative paths to absolute paths
            return path.isAbsolute(labelValue)
                ? labelValue
                : path.resolve(labelValue);
        }

        // Check if container has automatic compose file label
        if (
            container.labels &&
            container.labels['com.docker.compose.project.config_files']
        ) {
            return container.labels['com.docker.compose.project.config_files'];
        }

        // Fall back to default configuration file
        return this.configuration.file || null;
    }

    /**
     * Update the container.
     * @param container the container
     * @returns {Promise<TriggerRunResult | undefined>}
     */
    async trigger(container: Container): Promise<TriggerRunResult | undefined> {
        const result = await this.triggerBatch([container]);
        // triggerBatch no longer rejects on a swap failure, but the single-container
        // contract must keep surfacing it to the caller (HTTP 500).
        const failed = result?.members?.find(
            (member) => member.status === 'failed',
        );
        if (failed) {
            throw new Error(
                failed.error ?? `Failed to update container ${failed.name}`,
            );
        }
        return result;
    }

    /**
     * Group the containers by the compose file they belong to.
     * Skips containers not running on the local host, without a resolvable or
     * existing compose file, or that do not belong to their compose file.
     * @param containers the containers
     * @returns {Promise<Map<string, Container[]>>}
     */
    async groupByComposeFile(
        containers: Container[],
    ): Promise<Map<string, Container[]>> {
        const groups = new Map<string, Container[]>();

        for (const container of containers) {
            // Filter on containers running on local host
            const { modem } = this.getWatcher(container).dockerApi;
            if ((modem as { socketPath?: string }).socketPath === '') {
                this.log.warn(
                    `Cannot update container ${container.name} because not running on local host`,
                );
                continue;
            }

            const composeFile = this.getComposeFileForContainer(container);
            if (!composeFile) {
                this.log.warn(
                    `No compose file found for container ${container.name} (no label '${this.configuration.composeFileLabel}' and no default file configured)`,
                );
                continue;
            }

            // Check if compose file exists
            try {
                await fs.access(composeFile);
            } catch {
                this.log.warn(
                    `Compose file ${composeFile} for container ${container.name} does not exist`,
                );
                continue;
            }

            // Filter on containers that belong to this compose file
            const compose = await this.getComposeFileAsObject(composeFile);
            if (!doesContainerBelongToCompose(compose, container)) {
                continue;
            }

            if (!groups.has(composeFile)) {
                groups.set(composeFile, []);
            }
            groups.get(composeFile)!.push(container);
        }

        return groups;
    }

    /**
     * Return the passed containers that cannot be batch-updated because they do
     * not resolve to, or belong to, a managed compose file. Used by the batch API
     * to reject the whole request instead of silently updating only a subset.
     * @param containers
     * @returns {Promise<Container[]>}
     */
    async getUnbatchableContainers(
        containers: Container[],
    ): Promise<Container[]> {
        const groups = await this.groupByComposeFile(containers);
        const batchable = new Set<Container>([...groups.values()].flat());
        return containers.filter((container) => !batchable.has(container));
    }

    /**
     * Rewrite a compose file with the update versions of its containers.
     * Assumes non-dry-run (the caller guards dry-run). Does not swap containers.
     * @param composeFile
     * @param containers
     * @returns {Promise<void>}
     */
    async rewriteComposeFile(
        composeFile: string,
        containers: Container[],
    ): Promise<void> {
        this.log.info(`Processing compose file: ${composeFile}`);

        const compose = await this.getComposeFileAsObject(composeFile);

        // Track which services have already been mapped to avoid duplicates
        // (multiple containers can share the same image/service)
        const processedServices = new Set<string>();

        // [{ current: '1.0.0', update: '2.0.0' }, {...}]
        const currentVersionToUpdateVersionArray = containers
            .map((container) =>
                this.mapCurrentVersionToUpdateVersion(
                    compose,
                    container,
                    processedServices,
                ),
            )
            .filter((map) => map !== undefined);

        // Backup docker-compose file
        if (this.configuration.backup) {
            const backupFile = `${composeFile}.back`;
            await this.backup(composeFile, backupFile);
        }

        // Read the compose file as a string
        let composeFileStr = (
            await this.getComposeFile(composeFile)
        ).toString();

        // Replace all versions
        currentVersionToUpdateVersionArray.forEach(({ current, update }) => {
            composeFileStr = composeFileStr.replaceAll(current, update);
        });

        // Write docker-compose.yml file back
        await this.writeComposeFile(composeFile, composeFileStr);
    }

    /**
     * Update the docker-compose stack(s) as a two-phase lockstep operation:
     * pull ALL images (the barrier), rewrite each compose file, then swap ALL
     * containers back-to-back.
     * @param containers the containers
     * @returns {Promise<TriggerRunResult | undefined>}
     */
    async triggerBatch(
        containers: Container[],
    ): Promise<TriggerRunResult | undefined> {
        // Validate + group (local-host only, resolvable/existing compose file,
        // container belongs to that file).
        const groups = await this.groupByComposeFile(containers);
        const valid = [...groups.values()].flat();
        if (valid.length === 0) {
            return;
        }

        // Pull phase — barrier across ALL containers in ALL files. A pull
        // rejection aborts here, before any file write or swap.
        const contexts = await Promise.all(
            valid.map((container) => this.pullContainer(container)),
        );
        const ctxByContainer = new Map<
            Container,
            ContainerUpdateContext | undefined
        >(valid.map((container, index) => [container, contexts[index]]));

        // Dry-run: pull-only, no rewrite, no swap (matches previous behavior).
        if (this.configuration.dryrun) {
            return;
        }

        // Rewrite phase — images are local now; rewrite each compose file.
        for (const [composeFile, groupContainers] of groups) {
            await this.rewriteComposeFile(composeFile, groupContainers);
        }

        // Swap phase — barrier across ALL containers. A member that vanished fails.
        const swaps = await this.swapAll(
            valid,
            valid.map((container) => ctxByContainer.get(container)),
        );

        // Post-update epilogue — once, after the global swap barrier, over the
        // filtered member set.
        const dependents = await this.runPostUpdate(
            swaps,
            new Set(valid.map((container) => container.name.trim())),
        );
        return { members: this.toMemberOutcomes(swaps), dependents };
    }

    /**
     * Backup a file.
     * @param file
     * @param backupFile
     * @returns {Promise<void>}
     */
    async backup(file, backupFile) {
        try {
            this.log.debug(`Backup ${file} as ${backupFile}`);
            await fs.copyFile(file, backupFile);
        } catch (e) {
            this.log.warn(
                `Error when trying to backup file ${file} to ${backupFile} (${e.message})`,
            );
        }
    }

    /**
     * Return a map containing the image declaration
     * with the current version
     * and the image declaration with the update version.
     * @param compose
     * @param container
     * @param processedServices - Set to track which services have already been processed
     * @returns {{current, update}|undefined}
     */
    mapCurrentVersionToUpdateVersion(
        compose: ComposeFile,
        container: Container,
        processedServices?: Set<string>,
    ) {
        // Get registry configuration
        this.log.debug(`Get ${container.image.registry.name} registry manager`);
        const registry = getState().registry[container.image.registry.name];

        // Rebuild image definition string
        const currentImage = registry.getImageFullName(
            container.image,
            container.image.tag.value,
        );

        const serviceKeyToUpdate = Object.keys(compose.services).find(
            (serviceKey) => {
                const service = compose.services[serviceKey];
                return (
                    Boolean(service.image) &&
                    service.image.includes(currentImage)
                );
            },
        );

        if (!serviceKeyToUpdate) {
            this.log.warn(
                `Could not find service for container ${container.name} with image ${currentImage}`,
            );
            return undefined;
        }

        // Skip if this service has already been processed (duplicate container with same image)
        if (processedServices && processedServices.has(serviceKeyToUpdate)) {
            this.log.debug(
                `Service ${serviceKeyToUpdate} already processed for container ${container.name} (duplicate image)`,
            );
            return undefined;
        }

        // Mark this service as processed
        if (processedServices) {
            processedServices.add(serviceKeyToUpdate);
        }

        // Rebuild image definition string
        return {
            current: compose.services[serviceKeyToUpdate].image,
            update: this.getNewImageFullName(registry, container),
        };
    }

    /**
     * Write docker-compose file.
     * @param file
     * @param data
     * @returns {Promise<void>}
     */
    async writeComposeFile(file: string, data: string): Promise<void> {
        try {
            await fs.writeFile(file, data);
        } catch (e) {
            this.log.error(`Error when writing ${file} (${e.message})`);
            this.log.debug(e);
            throw e;
        }
    }

    /**
     * Read docker-compose file as a buffer.
     * @param file - Optional file path, defaults to configuration file
     * @returns {Promise<any>}
     */
    getComposeFile(file = null) {
        const filePath = file || this.configuration.file;
        try {
            return fs.readFile(filePath);
        } catch (e) {
            this.log.error(
                `Error when reading the docker-compose yaml file ${filePath} (${e.message})`,
            );
            throw e;
        }
    }

    /**
     * Read docker-compose file as an object.
     * @param file - Optional file path, defaults to configuration file
     * @returns {Promise<any>}
     */
    async getComposeFileAsObject(file = null): Promise<ComposeFile> {
        try {
            return yaml.parse((await this.getComposeFile(file)).toString(), {
                maxAliasCount: 10000,
            });
        } catch (e) {
            const filePath = file || this.configuration.file;
            this.log.error(
                `Error when parsing the docker-compose yaml file ${filePath} (${e.message})`,
            );
            throw e;
        }
    }
}

export default Dockercompose;
export {
    doesContainerBelongToCompose,
    resolveComposeServiceName,
    canonicalizeImageRef,
    imageRefsMatch,
    getCurrentImageRef,
    buildUpdatedImageRef,
    renderScalarValue,
    applyComposeEdits,
};
export type { ComposeEdit, ComposeFile, ServiceResolution };
