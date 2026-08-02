import fs from 'fs/promises';
import path from 'path';
import { parseDocument, isScalar, Scalar } from 'yaml';
import type { Document } from 'yaml';
import Docker from '../docker/Docker';
import { ContainerGoneError } from '../docker/errors';
import { getState } from '../../../registry';
import { Container } from '../../../model/container';
import type {
    ContainerUpdateContext,
    MemberOutcome,
    TriggerRunResult,
} from '../docker/types';
import type { UnprocessableContainer } from '../Trigger';

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

/**
 * Outcome of selecting the single compose file a container is updated through.
 */
interface ComposeResolution {
    file?: string;
    reason?: string;
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
            const candidates: string[] = this.splitComposeFileList(
                this.configuration.file,
            );
            const existing: string[] = [];
            for (const candidate of candidates) {
                try {
                    await fs.access(candidate);
                    existing.push(candidate);
                } catch {
                    this.log.warn(
                        `The default file ${candidate} does not exist`,
                    );
                }
            }
            if (existing.length === 0) {
                const message = `The default file ${this.configuration.file} does not exist`;
                this.log.error(message);
                throw new Error(message);
            }
        }
    }

    /**
     * Split a compose file source into absolute candidate paths. Docker Compose
     * writes `config_files` as a comma-joined list.
     * @param value
     * @returns {string[]}
     */
    private splitComposeFileList(value: string): string[] {
        return value
            .split(',')
            .map((part) => part.trim())
            .filter((part) => part.length > 0)
            .map((part) => (path.isAbsolute(part) ? part : path.resolve(part)));
    }

    /**
     * Get the candidate compose file paths for a specific container.
     * First checks for a label, then falls back to default configuration; the
     * first source yielding at least one candidate wins outright.
     * @param container
     * @returns {string[]}
     */
    getComposeFilesForContainer(container: Container): string[] {
        const labels: Record<string, string> = container.labels ?? {};
        const sources: (string | undefined)[] = [
            labels[this.configuration.composeFileLabel],
            labels['com.docker.compose.project.config_files'],
            this.configuration.file,
        ];
        for (const source of sources) {
            if (typeof source !== 'string') {
                continue;
            }
            const candidates: string[] = this.splitComposeFileList(source);
            if (candidates.length > 0) {
                return candidates;
            }
        }
        return [];
    }

    /**
     * Select the single compose file a container is updated through: of the
     * candidates that exist and declare the container's image, the last one wins
     * (later compose files override earlier ones).
     * @param container
     * @param loadedByFile per-pass cache; a cached parse failure is null
     * @returns {Promise<ComposeResolution>}
     */
    async resolveComposeFileForContainer(
        container: Container,
        loadedByFile: Map<string, LoadedCompose | null>,
    ): Promise<ComposeResolution> {
        const candidates: string[] =
            this.getComposeFilesForContainer(container);
        if (candidates.length === 0) {
            return {
                reason: `no compose file could be resolved (no '${this.configuration.composeFileLabel}' label, no 'com.docker.compose.project.config_files' label and no default file configured)`,
            };
        }

        const existing: string[] = [];
        for (const candidate of candidates) {
            try {
                await fs.access(candidate);
                existing.push(candidate);
            } catch {
                this.log.debug(
                    `Compose file ${candidate} for container ${container.name} does not exist`,
                );
            }
        }
        if (existing.length === 0) {
            return {
                reason: `none of its candidate compose files exist (${candidates.join(', ')})`,
            };
        }

        const matching: string[] = [];
        const parseFailed: string[] = [];
        for (const file of existing) {
            let loaded: LoadedCompose | null;
            if (loadedByFile.has(file)) {
                loaded = loadedByFile.get(file) ?? null;
            } else {
                try {
                    loaded = await this.loadComposeFile(file);
                } catch (e) {
                    loaded = null;
                    this.log.warn(
                        `Skipping compose file ${file} for container ${container.name} because it could not be read or parsed (${e.message})`,
                    );
                }
                loadedByFile.set(file, loaded);
            }
            if (loaded === null) {
                parseFailed.push(file);
            } else if (
                doesContainerBelongToCompose(loaded.compose, container)
            ) {
                matching.push(file);
            }
        }

        if (matching.length === 0) {
            if (parseFailed.length === existing.length) {
                return {
                    reason: `none of its candidate compose files could be read or parsed (${existing.join(', ')})`,
                };
            }
            return {
                reason: `no service in ${existing.join(', ')} pins its image ${getCurrentImageRef(container) ?? 'unknown'}`,
            };
        }

        return { file: matching[matching.length - 1] };
    }

    /**
     * Resolve every container to its compose file in one pass, returning both the
     * grouping and the reason each rejected container cannot be processed.
     * @param containers the containers
     * @returns {Promise<{groups: Map<string, Container[]>, unprocessable: UnprocessableContainer[]}>}
     */
    async classifyContainers(containers: Container[]): Promise<{
        groups: Map<string, Container[]>;
        unprocessable: UnprocessableContainer[];
    }> {
        const groups = new Map<string, Container[]>();
        const unprocessable: UnprocessableContainer[] = [];
        const loadedByFile = new Map<string, LoadedCompose | null>();

        for (const container of containers) {
            const { modem } = this.getWatcher(container).dockerApi;
            if ((modem as { socketPath?: string }).socketPath === '') {
                const reason = 'it is not running on the local host';
                this.log.warn(
                    `Cannot update container ${container.name} because ${reason}`,
                );
                unprocessable.push({ container, reason });
                continue;
            }

            const resolution: ComposeResolution =
                await this.resolveComposeFileForContainer(
                    container,
                    loadedByFile,
                );
            if (!resolution.file) {
                const reason = resolution.reason ?? 'unknown reason';
                this.log.warn(
                    `Cannot update container ${container.name} because ${reason}`,
                );
                unprocessable.push({ container, reason });
                continue;
            }

            if (!groups.has(resolution.file)) {
                groups.set(resolution.file, []);
            }
            groups.get(resolution.file)!.push(container);
        }

        return { groups, unprocessable };
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
            if (failed.gone) {
                throw new ContainerGoneError(container);
            }
            throw new Error(
                failed.error ?? `Failed to update container ${failed.name}`,
            );
        }

        // Dry-run legitimately produces no member outcome; anything else means the
        // container was filtered out and nothing was applied.
        if (!this.configuration.dryrun) {
            const updated = result?.members?.some(
                (member) =>
                    member.id === container.id && member.status === 'updated',
            );
            if (!updated) {
                const [unprocessable] = await this.getUnprocessableContainers([
                    container,
                ]);
                throw new Error(
                    `Container ${container.name} was not updated by this trigger (${unprocessable?.reason ?? 'unknown reason'})`,
                );
            }
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
        return (await this.classifyContainers(containers)).groups;
    }

    /**
     * Return the passed containers that cannot be updated because they do not
     * resolve to, or belong to, a managed compose file, with the reason for each.
     * @param containers
     * @returns {Promise<UnprocessableContainer[]>}
     */
    async getUnprocessableContainers(
        containers: Container[],
    ): Promise<UnprocessableContainer[]> {
        return (await this.classifyContainers(containers)).unprocessable;
    }

    /**
     * Compute the character-range edits needed to bump each container's own compose service.
     * @param loaded
     * @param containers
     * @param composeFile
     * @returns {{edits: ComposeEdit[]} & ComposeRewriteOutcome}
     */
    planComposeEdits(
        loaded: LoadedCompose,
        containers: Container[],
        composeFile: string,
    ): { edits: ComposeEdit[] } & ComposeRewriteOutcome {
        const edits: ComposeEdit[] = [];
        const editedIds = new Set<string>();
        const staleIds = new Set<string>();
        const serviceOutcome = new Map<string, 'edited' | 'stale'>();

        for (const container of containers) {
            if (container.updateKind?.kind !== 'tag') {
                this.log.debug(
                    `Skipping ${container.name}: ${container.updateKind?.kind ?? 'unknown'} update does not change the compose image`,
                );
                continue;
            }

            const currentImageRef: string | undefined =
                getCurrentImageRef(container);
            const resolution: ServiceResolution = resolveComposeServiceName(
                loaded.compose,
                container,
                currentImageRef,
            );
            if (resolution.status === 'not-found') {
                this.log.warn(
                    `Could not find a service for container ${container.name} (image ${currentImageRef ?? 'unknown'}) in ${composeFile}`,
                );
                staleIds.add(container.id);
                continue;
            }
            if (resolution.status === 'ambiguous') {
                this.log.warn(
                    `Refusing to update ${composeFile} for container ${container.name}: image ${currentImageRef} matches multiple services (${resolution.candidates.join(', ')}) and the container carries no usable '${COMPOSE_SERVICE_LABEL}' label`,
                );
                staleIds.add(container.id);
                continue;
            }

            const serviceName: string = resolution.serviceName;
            const planned: 'edited' | 'stale' | undefined =
                serviceOutcome.get(serviceName);
            if (planned !== undefined) {
                this.log.debug(
                    `Service ${serviceName} already planned (scaled service / duplicate container)`,
                );
                if (planned === 'edited') {
                    editedIds.add(container.id);
                } else {
                    staleIds.add(container.id);
                }
                continue;
            }

            const node: unknown = loaded.doc.getIn(
                ['services', serviceName, 'image'],
                true,
            );
            if (
                !isScalar(node) ||
                typeof node.value !== 'string' ||
                node.value.trim() === '' ||
                !node.range
            ) {
                this.log.warn(
                    `Service ${serviceName} in ${composeFile} has no literal 'image:' scalar (alias, anchor-inherited, build-only, or empty) — skipping ${container.name}`,
                );
                serviceOutcome.set(serviceName, 'stale');
                staleIds.add(container.id);
                continue;
            }

            if (node.anchor) {
                this.log.warn(
                    `Service ${serviceName} in ${composeFile} anchors its image as '&${node.anchor}'; other services may alias it, so rewriting it in place could bump them too — skipping ${container.name}`,
                );
                serviceOutcome.set(serviceName, 'stale');
                staleIds.add(container.id);
                continue;
            }

            const fileRef: string = node.value;
            const newRef: string | undefined = buildUpdatedImageRef(
                fileRef,
                container.updateKind.remoteValue,
            );
            if (newRef === undefined) {
                this.log.warn(
                    `Cannot derive an updated reference for ${fileRef} in service ${serviceName} — skipping`,
                );
                serviceOutcome.set(serviceName, 'stale');
                staleIds.add(container.id);
                continue;
            }
            if (newRef === fileRef) {
                serviceOutcome.set(serviceName, 'edited');
                editedIds.add(container.id);
                continue;
            }

            const text: string | undefined = renderScalarValue(
                newRef,
                node.type,
            );
            if (text === undefined) {
                this.log.warn(
                    `Service ${serviceName} uses an 'image:' scalar style that cannot be rewritten in place — skipping`,
                );
                serviceOutcome.set(serviceName, 'stale');
                staleIds.add(container.id);
                continue;
            }

            edits.push({
                serviceName,
                start: node.range[0],
                end: node.range[1],
                text,
                from: fileRef,
                to: newRef,
            });
            serviceOutcome.set(serviceName, 'edited');
            editedIds.add(container.id);
        }

        return { edits, editedIds, staleIds };
    }

    /**
     * Rewrite a compose file, splicing only each container's own service image.
     * Assumes non-dry-run (the caller guards dry-run). Does not swap containers.
     * @param composeFile
     * @param containers
     * @returns {Promise<ComposeRewriteOutcome>}
     */
    async rewriteComposeFile(
        composeFile: string,
        containers: Container[],
    ): Promise<ComposeRewriteOutcome> {
        this.log.info(`Processing compose file: ${composeFile}`);

        // Deliberate re-read: the pull barrier sits between grouping and rewriting.
        const loaded: LoadedCompose = await this.loadComposeFile(composeFile);
        const { edits, editedIds, staleIds } = this.planComposeEdits(
            loaded,
            containers,
            composeFile,
        );

        if (edits.length === 0) {
            this.log.info(`No compose service to update in ${composeFile}`);
            return { editedIds, staleIds };
        }

        if (this.configuration.backup) {
            const backupFile = `${composeFile}.back`;
            await this.backup(composeFile, backupFile);
        }

        for (const edit of edits) {
            this.log.info(
                `Updating service ${edit.serviceName}: ${edit.from} -> ${edit.to}`,
            );
        }

        await this.writeComposeFile(
            composeFile,
            applyComposeEdits(loaded.source, edits),
        );
        return { editedIds, staleIds };
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
        const editedIds = new Set<string>();
        const staleIds = new Set<string>();
        for (const [composeFile, groupContainers] of groups) {
            const outcome = await this.rewriteComposeFile(
                composeFile,
                groupContainers,
            );
            outcome.editedIds.forEach((id) => editedIds.add(id));
            outcome.staleIds.forEach((id) => staleIds.add(id));
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
        const members: MemberOutcome[] = this.toMemberOutcomes(swaps).map(
            (member: MemberOutcome): MemberOutcome => {
                if (staleIds.has(member.id)) {
                    return { ...member, fileUpdated: false };
                }
                if (editedIds.has(member.id)) {
                    return { ...member, fileUpdated: true };
                }
                return member;
            },
        );
        return { members, dependents };
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
     * Read and parse a compose file once. `source` is the exact string the edit
     * offsets index.
     * @param composeFile
     * @returns {Promise<LoadedCompose>}
     */
    async loadComposeFile(composeFile: string): Promise<LoadedCompose> {
        let source: string;
        try {
            source = (await this.getComposeFile(composeFile)).toString();
        } catch (e) {
            this.log.error(
                `Error when reading the docker-compose yaml file ${composeFile} (${e.message})`,
            );
            throw e;
        }
        const doc: Document.Parsed = parseDocument(source);
        if (doc.errors.length > 0) {
            const first = doc.errors[0];
            this.log.error(
                `Error when parsing the docker-compose yaml file ${composeFile} (${first.message})`,
            );
            throw first;
        }
        let parsed: Partial<ComposeFile> | null;
        try {
            parsed = doc.toJS({
                maxAliasCount: 10000,
            }) as Partial<ComposeFile> | null;
        } catch (e) {
            this.log.error(
                `Error when parsing the docker-compose yaml file ${composeFile} (${e.message})`,
            );
            throw e;
        }
        const compose: ComposeFile = { services: parsed?.services ?? {} };
        return { source, doc, compose };
    }

    /**
     * Read docker-compose file as an object.
     * @param file - Optional file path, defaults to configuration file
     * @returns {Promise<ComposeFile>}
     */
    async getComposeFileAsObject(file = null): Promise<ComposeFile> {
        return (await this.loadComposeFile(file ?? this.configuration.file))
            .compose;
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
