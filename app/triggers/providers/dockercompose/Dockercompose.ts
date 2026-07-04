import fs from 'fs/promises';
import path from 'path';
import yaml from 'yaml';
import Docker from '../docker/Docker';
import { getState } from '../../../registry';
import { Container } from '../../../model/container';
import type { ContainerUpdateContext } from '../docker/types';

/**
 * Return true if the container belongs to the compose file.
 * @param compose
 * @param container
 * @returns true/false
 */
function doesContainerBelongToCompose(compose: any, container: Container) {
    // Get registry configuration
    const registry = getState().registry[container.image.registry.name];

    // Rebuild image definition string
    const currentImage = registry.getImageFullName(
        container.image,
        container.image.tag.value,
    );
    return Object.keys(compose.services).some((key) => {
        const service = compose.services[key];
        return service.image.includes(currentImage);
    });
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
        // Check if container has a compose file label
        const composeFileLabel = this.configuration.composeFileLabel;
        if (container.labels && container.labels[composeFileLabel]) {
            const labelValue = container.labels[composeFileLabel];
            // Convert relative paths to absolute paths
            return path.isAbsolute(labelValue)
                ? labelValue
                : path.resolve(labelValue);
        }

        // Fall back to default configuration file
        return this.configuration.file || null;
    }

    /**
     * Update the container.
     * @param container the container
     * @returns {Promise<void>}
     */
    async trigger(container: Container): Promise<void> {
        return this.triggerBatch([container]);
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

        // [{ current: '1.0.0', update: '2.0.0' }, {...}]
        const currentVersionToUpdateVersionArray = containers
            .map((container) =>
                this.mapCurrentVersionToUpdateVersion(compose, container),
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
     * @returns {Promise<void>}
     */
    async triggerBatch(containers: Container[]): Promise<void> {
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

        // Swap phase — barrier across ALL containers. Skip any that vanished.
        await Promise.all(
            valid.map((container) => {
                const ctx = ctxByContainer.get(container);
                return ctx ? this.swapContainer(container, ctx) : undefined;
            }),
        );
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
     * @returns {{current, update}|undefined}
     */
    mapCurrentVersionToUpdateVersion(compose, container) {
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
                return service.image.includes(currentImage);
            },
        );

        if (!serviceKeyToUpdate) {
            this.log.warn(
                `Could not find service for container ${container.name} with image ${currentImage}`,
            );
            return undefined;
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
    async getComposeFileAsObject(file = null) {
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
