const fs = require('fs/promises');
const path = require('path');
const yaml = require('yaml');
const { Mutex } = require('async-mutex');
const Docker = require('../docker/Docker');
const { getState } = require('../../../registry');

// Static mutex map to handle concurrent access to compose files
const fileMutexes = new Map();

/**
 * Return true if the container belongs to the compose file.
 * @param compose
 * @param container
 * @returns true/false
 */
function doesContainerBelongToCompose(compose, container) {
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
        // Force mode=batch only if using global file mode
        if (this.configuration.file) {
            this.configuration.mode = 'batch';

            // Check default docker-compose file exists if specified
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
     * Check if container must trigger.
     * Overrides Trigger.mustTrigger to support implicit label-based triggering.
     * @param containerResult
     * @returns {boolean}
     */
    mustTrigger(containerResult) {
        // Standard check (explicit triggers)
        const explicitTrigger = super.mustTrigger(containerResult);
        if (explicitTrigger) {
            return true;
        }

        // Only default implicit label trigger if we are in the default "labels" mode (no file configured)
        // If file is configured, we are in legacy mode and should strictly follow explicit rules
        if (this.configuration.file) {
            return false;
        }

        // Check for implicit label trigger
        const composeFileLabel = this.configuration.composeFileLabel || 'wud.compose.file';
        if (containerResult.labels && containerResult.labels[composeFileLabel]) {
            // Check for explicit auto disable
            const autoLabel = 'wud.compose.auto';
            if (containerResult.labels[autoLabel] &&
                containerResult.labels[autoLabel].toLowerCase() === 'false') {
                return false;
            }
            return true;
        }

        return false;
    }

    /**
     * Get the compose file path for a specific container.
     * First checks for a label, then falls back to default configuration.
     * @param container
     * @param configuration
     * @returns {string|null}
     */
    getComposeFileForContainer(container, configuration = this.configuration) {
        // Check if container has a compose file label
        const composeFileLabel = configuration.composeFileLabel || 'wud.compose.file';
        if (container.labels && container.labels[composeFileLabel]) {
            const labelValue = container.labels[composeFileLabel];
            // Convert relative paths to absolute paths
            return path.isAbsolute(labelValue) ? labelValue : path.resolve(labelValue);
        }

        // Fall back to default configuration file
        return configuration.file || null;
    }

    /**
     * Update the container.
     * @param container the container
     * @returns {Promise<void>}
     */
    async trigger(container) {
        // Determine effective configuration
        const composeFileLabel = this.configuration.composeFileLabel || 'wud.compose.file';
        const hasComposeLabel = container.labels && container.labels[composeFileLabel];

        if (hasComposeLabel) {
            // "Simple" mode with label-derived configuration
            const labels = container.labels;

            // Helper to parse boolean labels
            const getBoolLabel = (key, def) => {
                if (labels[key] !== undefined) {
                    return labels[key].toLowerCase() === 'true';
                }
                return def;
            };

            const mergedConfiguration = {
                ...this.configuration,
                file: this.getComposeFileForContainer(container),
                dryrun: getBoolLabel('wud.compose.dryrun', this.configuration.dryrun),
                prune: getBoolLabel('wud.compose.prune', this.configuration.prune),
                backup: getBoolLabel('wud.compose.backup', this.configuration.backup),
            };

            const composeFile = mergedConfiguration.file;

            // Filter on containers running on local host
            const watcher = this.getWatcher(container);
            if (watcher.dockerApi.modem.socketPath === '') {
                this.log.warn(
                    `Cannot update container ${container.name} because not running on local host`,
                );
                return;
            }

            // Get or create mutex for this file
            if (!fileMutexes.has(composeFile)) {
                fileMutexes.set(composeFile, new Mutex());
            }
            const mutex = fileMutexes.get(composeFile);

            return await mutex.runExclusive(async () => {
                try {
                    await fs.access(composeFile);
                } catch (e) {
                    this.log.warn(
                        `Compose file ${composeFile} for container ${container.name} does not exist`,
                    );
                    return;
                }

                await this.processComposeFile(composeFile, [container], mergedConfiguration);
            });

        } else {
            // Fallback to legacy batch mode
            return this.triggerBatch([container]);
        }
    }

    /**
     * Update the docker-compose stack.
     * @param containers the containers
     * @returns {Promise<void>}
     */
    async triggerBatch(containers) {
        // Group containers by their compose file
        const containersByComposeFile = new Map();

        for (const container of containers) {
            // Filter on containers running on local host
            const watcher = this.getWatcher(container);
            if (watcher.dockerApi.modem.socketPath === '') {
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
            } catch (e) {
                this.log.warn(
                    `Compose file ${composeFile} for container ${container.name} does not exist`,
                );
                continue;
            }

            if (!containersByComposeFile.has(composeFile)) {
                containersByComposeFile.set(composeFile, []);
            }
            containersByComposeFile.get(composeFile).push(container);
        }

        // Process each compose file group
        for (const [composeFile, containersInFile] of containersByComposeFile) {
            await this.processComposeFile(composeFile, containersInFile);
        }
    }

    /**
     * Process a specific compose file with its associated containers.
     * @param composeFile
     * @param containers
     * @param configuration Optional configuration override
     * @returns {Promise<void>}
     */
    async processComposeFile(composeFile, containers, configuration = this.configuration) {
        this.log.info(`Processing compose file: ${composeFile}`);
        
        const compose = await this.getComposeFileAsObject(composeFile, configuration);

        // Filter containers that belong to this compose file
        const containersFiltered = containers.filter((container) =>
            doesContainerBelongToCompose(compose, container),
        );

        if (containersFiltered.length === 0) {
            this.log.warn(
                `No containers found in compose file ${composeFile}`,
            );
            return;
        }

        // [{ current: '1.0.0', update: '2.0.0' }, {...}]
        const currentVersionToUpdateVersionArray = containersFiltered
            .map((container) =>
                this.mapCurrentVersionToUpdateVersion(compose, container),
            )
            .filter((map) => map !== undefined);

        // Dry-run?
        if (configuration.dryrun) {
            this.log.info(
                `Do not replace existing docker-compose file ${composeFile} (dry-run mode enabled)`,
            );
        } else {
            // Backup docker-compose file
            if (configuration.backup) {
                const backupFile = `${composeFile}.back`;
                await this.backup(composeFile, backupFile);
            }

            // Read the compose file as a string
            let composeFileStr = (await this.getComposeFile(composeFile, configuration)).toString();

            // Replace all versions
            currentVersionToUpdateVersionArray.forEach(
                ({ current, update }) => {
                    composeFileStr = composeFileStr.replaceAll(current, update);
                },
            );

            // Write docker-compose.yml file back
            await this.writeComposeFile(composeFile, composeFileStr);
        }

        // Update all containers
        // (super.notify will take care of the dry-run mode for each container as well)
        await Promise.all(
            containersFiltered.map((container) => super.trigger(container, configuration)),
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
    async writeComposeFile(file, data) {
        try {
            await fs.writeFile(file, data);
        } catch (e) {
            this.log.error(`Error when writing ${file} (${e.message})`);
            this.log.debug(e);
        }
    }

    /**
     * Read docker-compose file as a buffer.
     * @param file - Optional file path, defaults to configuration file
     * @param configuration - Optional configuration object
     * @returns {Promise<any>}
     */
    getComposeFile(file = null, configuration = this.configuration) {
        const filePath = file || configuration.file;
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
     * @param configuration - Optional configuration object
     * @returns {Promise<any>}
     */
    async getComposeFileAsObject(file = null, configuration = this.configuration) {
        try {
            return yaml.parse((await this.getComposeFile(file, configuration)).toString());
        } catch (e) {
            const filePath = file || configuration.file;
            this.log.error(
                `Error when parsing the docker-compose yaml file ${filePath} (${e.message})`,
            );
            throw e;
        }
    }
}

module.exports = Dockercompose;
