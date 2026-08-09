import parse from 'parse-docker-image-name';
import Dockerode from 'dockerode';
import Trigger from '../Trigger';
import { getState } from '../../../registry';
import { Container, ContainerImage, fullName } from '../../../model/container';
import type DockerWatcher from '../../../watchers/providers/docker/Docker';
import type Registry from '../../../registries/Registry';
import Logger from 'bunyan';
import { wudPostupdateRestart } from '../../../watchers/providers/docker/label';
import { getPostupdateBounceCounter } from '../../../prometheus/postupdate';
import { ContainerGoneError, SwapFailedError } from './errors';
import type {
    ContainerUpdateContext,
    DependentOutcome,
    DependentOutcomeStatus,
    MemberOutcome,
    SwapOutcome,
    TriggerRunResult,
} from './types';

/** docker-modem URL-encodes the whole payload into the request line unless _query/_body are set. */
interface CreateEnvelope {
    _query: { name?: string };
    _body: Omit<Dockerode.ContainerCreateOptions, 'name'>;
}

type RollbackOptions = {
    asideName?: string;
    newContainer?: Dockerode.Container;
    wasRunning: boolean;
    originalName: string;
    original: 'present' | 'removed' | 'unknown';
};

type RollbackResult = {
    disposition: 'rolled_back' | 'left_stopped' | 'destroyed';
    rollbackError?: string;
};

/**
 * Replace a Docker container with an updated one.
 */
class Docker extends Trigger {
    public strictAgentMatch = true;

    /**
     * Get the Trigger configuration schema.
     */
    getConfigurationSchema() {
        return this.joi.object().keys({
            prune: this.joi.boolean().default(false),
            dryrun: this.joi.boolean().default(false),
            autoremovetimeout: this.joi.number().default(10_000),
            postupdatetimeout: this.joi
                .number()
                .integer()
                .min(0)
                .default(300_000),
            multinetworkfallback: this.joi.boolean().default(true),
        });
    }

    /**
     * Get watcher responsible for the container.
     */

    getWatcher(container: Container): DockerWatcher {
        return getState().watcher[
            `docker.${container.watcher}`
        ] as DockerWatcher;
    }

    /**
     * Get current container.
     */
    async getCurrentContainer(
        dockerApi: Dockerode,
        container: Container,
    ): Promise<Dockerode.Container> {
        this.log.debug(`Get container ${container.id}`);
        try {
            return await dockerApi.getContainer(container.id);
        } catch (e) {
            this.log.warn(`Error when getting container ${container.id}`);
            throw e;
        }
    }

    /**
     * Inspect container.
     */
    async inspectContainer(
        container: Dockerode.Container,
        logContainer: Logger,
    ): Promise<Dockerode.ContainerInspectInfo> {
        this.log.debug(`Inspect container ${container.id}`);
        try {
            return await container.inspect();
        } catch (e) {
            logContainer.warn(
                `Error when inspecting container ${container.id}`,
            );
            throw e;
        }
    }

    /**
     * Prune previous image versions.
     */
    async pruneImages(
        dockerApi: Dockerode,
        registry: Registry,
        container: Container,
        logContainer: Logger,
    ): Promise<void> {
        logContainer.info('Pruning previous tags');
        try {
            // Get all pulled images
            const images = await dockerApi.listImages();

            // Find all pulled images to remove
            const imagesToRemove = images
                .filter((image) => {
                    // Exclude images without repo tags
                    if (!image.RepoTags || image.RepoTags.length === 0) {
                        return false;
                    }
                    const imageParsed = parse(image.RepoTags[0]);
                    const imageNormalized = registry.normalizeImage({
                        registry: {
                            url: imageParsed.domain ? imageParsed.domain : '',
                        },
                        tag: {
                            value: imageParsed.tag,
                        },
                        name: imageParsed.path,
                    } as ContainerImage);

                    // Exclude different registries
                    if (
                        imageNormalized.registry.name !==
                        container.image.registry.name
                    ) {
                        return false;
                    }

                    // Exclude different names
                    if (imageNormalized.name !== container.image.name) {
                        return false;
                    }

                    // Exclude current container image
                    if (
                        imageNormalized.tag.value ===
                        container.updateKind.localValue
                    ) {
                        return false;
                    }

                    // Exclude candidate image
                    if (
                        imageNormalized.tag.value ===
                        container.updateKind.remoteValue
                    ) {
                        return false;
                    }
                    return true;
                })
                .map((imageToRemove) => dockerApi.getImage(imageToRemove.Id));
            await Promise.all(
                imagesToRemove.map((imageToRemove) => {
                    logContainer.info(
                        `Prune image ${(imageToRemove as any).name || imageToRemove.id}`,
                    );
                    return imageToRemove.remove();
                }),
            );
        } catch (e: any) {
            logContainer.warn(
                `Some errors occurred when trying to prune previous tags (${e.message})`,
            );
        }
    }

    /**
     * Pull new image.
     */
    async pullImage(
        dockerApi: Dockerode,
        auth: Dockerode.AuthConfig | undefined,
        newImage: string,
        logContainer: Logger,
    ): Promise<void> {
        logContainer.info(`Pull image ${newImage}`);
        try {
            const pullStream = await dockerApi.pull(newImage, {
                authconfig: auth,
            });

            await new Promise((res) =>
                dockerApi.modem.followProgress(pullStream, res),
            );
            logContainer.info(`Image ${newImage} pulled with success`);
        } catch (e: any) {
            logContainer.warn(
                `Error when pulling image ${newImage} (${e.message})`,
            );
            throw e;
        }
    }

    /**
     * Stop a container.
     */
    async stopContainer(
        container: Dockerode.Container,
        containerName: string,
        containerId: string,
        logContainer: Logger,
    ): Promise<void> {
        logContainer.info(
            `Stop container ${containerName} with id ${containerId}`,
        );
        try {
            await container.stop();
            logContainer.info(
                `Container ${containerName} with id ${containerId} stopped with success`,
            );
        } catch (e: any) {
            logContainer.warn(
                `Error when stopping container ${containerName} with id ${containerId}`,
            );
            throw e;
        }
    }

    /**
     * Remove a container.
     */
    async removeContainer(
        container: Dockerode.Container,
        containerName: string,
        containerId: string,
        logContainer: Logger,
    ): Promise<void> {
        logContainer.info(
            `Remove container ${containerName} with id ${containerId}`,
        );
        try {
            await container.remove();
            logContainer.info(
                `Container ${containerName} with id ${containerId} removed with success`,
            );
        } catch (e: any) {
            logContainer.warn(
                `Error when removing container ${containerName} with id ${containerId}`,
            );
            throw e;
        }
    }

    /**
     * Rename a container.
     */
    async renameContainer(
        container: Dockerode.Container,
        containerName: string,
        newName: string,
        containerId: string,
        logContainer: Logger,
    ): Promise<void> {
        logContainer.info(
            `Rename container ${containerName} with id ${containerId} to ${newName}`,
        );
        try {
            await container.rename({ name: newName });
            logContainer.info(
                `Container ${containerName} with id ${containerId} renamed to ${newName} with success`,
            );
        } catch (e: any) {
            logContainer.warn(
                `Error when renaming container ${containerName} with id ${containerId} to ${newName} (${e.message})`,
            );
            throw e;
        }
    }

    /** Suffix, not prefix: resolveDependent strips a ^[a-f0-9]{8,12}_ prefix and would resolve a tombstone as live. */
    buildAsideName(containerName: string, containerId: string): string {
        return `${containerName}_wud_old_${containerId.slice(0, 12)}`;
    }

    /**
     * Wait for a container to be removed.
     */
    async waitContainerRemoved(
        container: Dockerode.Container,
        containerName: string,
        containerId: string,
        logContainer: Logger,
    ): Promise<void> {
        logContainer.info(
            `Wait container ${containerName} with id ${containerId}`,
        );
        try {
            await container.wait({
                condition: 'removed',
                abortSignal: AbortSignal.timeout(
                    this.configuration.autoremovetimeout,
                ),
            });
            logContainer.info(
                `Container ${containerName} with id ${containerId} auto-removed successfully`,
            );
        } catch (e: any) {
            logContainer.warn(
                `Error while waiting for container ${containerName} with id ${containerId}`,
            );
            throw e;
        }
    }

    /**
     * Create a new container.
     */
    async createContainer(
        dockerApi: Dockerode,
        containerToCreate: Dockerode.ContainerCreateOptions,
        containerName: string,
        logContainer: Logger,
    ): Promise<Dockerode.Container> {
        logContainer.info(`Create container ${containerName}`);
        const { name, ...body } = containerToCreate;
        const envelope: CreateEnvelope = {
            _query: name === undefined ? {} : { name },
            _body: body,
        };
        try {
            const newContainer = await dockerApi.createContainer(
                envelope as unknown as Dockerode.ContainerCreateOptions,
            );
            logContainer.info(
                `Container ${containerName} recreated on new image with success`,
            );
            return newContainer;
        } catch (e: any) {
            logContainer.warn(
                `Error when creating container ${containerName} (${e.message})`,
            );
            throw e;
        }
    }

    /**
     * Sanitize endpoint config so it can be reused on create/connect calls.
     */
    sanitizeEndpointConfig(
        endpointConfig: Dockerode.EndpointSettings | undefined,
        currentContainerId: string | undefined,
    ) {
        if (!endpointConfig) {
            return {};
        }
        const sanitized: Dockerode.EndpointSettings = {};

        if (endpointConfig.IPAMConfig) {
            sanitized.IPAMConfig = endpointConfig.IPAMConfig;
        }
        if (endpointConfig.Links && endpointConfig.Links.length > 0) {
            sanitized.Links = endpointConfig.Links;
        }
        if (endpointConfig.DriverOpts) {
            sanitized.DriverOpts = endpointConfig.DriverOpts;
        }
        if (endpointConfig.MacAddress) {
            sanitized.MacAddress = endpointConfig.MacAddress;
        }
        const linkLocalIPs = (endpointConfig as any).LinkLocalIPs;
        if (linkLocalIPs && linkLocalIPs.length) {
            (sanitized as any).LinkLocalIPs = linkLocalIPs;
        }
        if (endpointConfig.Aliases && endpointConfig.Aliases.length > 0) {
            sanitized.Aliases = endpointConfig.Aliases.filter(
                (alias: string) =>
                    !(
                        alias &&
                        ((currentContainerId &&
                            currentContainerId.startsWith(alias)) ||
                            /^[a-f0-9]{12,64}$/i.test(alias))
                    ),
            );
        }

        return sanitized;
    }

    /**
     * Build fallback plan for multi-network containers.
     */
    buildMultiNetworkFallbackPlan(
        containerToCreate: Dockerode.ContainerCreateOptions,
        currentContainerId: string | undefined,
    ) {
        const endpointsConfig =
            containerToCreate?.NetworkingConfig?.EndpointsConfig;
        if (!endpointsConfig) {
            return null;
        }
        const networkNames = Object.keys(endpointsConfig);
        if (networkNames.length <= 1) {
            return null;
        }

        const sanitizedEndpoints: Record<string, Dockerode.EndpointSettings> =
            {};
        networkNames.forEach((networkName) => {
            sanitizedEndpoints[networkName] = this.sanitizeEndpointConfig(
                endpointsConfig[networkName],
                currentContainerId,
            );
        });

        const networkMode = containerToCreate?.HostConfig?.NetworkMode;
        const primaryNetwork = sanitizedEndpoints[networkMode]
            ? networkMode
            : networkNames[0];

        return {
            primaryNetwork,
            primaryEndpointConfig: sanitizedEndpoints[primaryNetwork],
            secondaryNetworks: networkNames
                .filter((networkName) => networkName !== primaryNetwork)
                .map((networkName) => ({
                    networkName,
                    endpointConfig: sanitizedEndpoints[networkName],
                })),
        };
    }

    /**
     * Create a container and fallback to sequential network attach for daemon/API combinations
     * that reject multiple endpoints in createContainer.
     */
    async createContainerWithMultiNetworkFallback(
        dockerApi: Dockerode,
        containerToCreate: Dockerode.ContainerCreateOptions,
        currentContainerSpec: Dockerode.ContainerInspectInfo,
        containerName: string,
        logContainer: Logger,
    ): Promise<Dockerode.Container> {
        try {
            return await this.createContainer(
                dockerApi,
                containerToCreate,
                containerName,
                logContainer,
            );
        } catch (createError: any) {
            if (
                this.configuration.multinetworkfallback !== true ||
                !(
                    createError instanceof Error &&
                    createError.message
                        .toLowerCase()
                        .includes('cannot be connected to network endpoints')
                )
            ) {
                throw createError;
            }

            logContainer.info(
                `create-primary: failed for ${containerName} on multiple networks, trying fallback with sequential network attach...`,
            );
            const fallbackPlan = this.buildMultiNetworkFallbackPlan(
                containerToCreate,
                currentContainerSpec?.Id,
            );
            if (!fallbackPlan) {
                throw createError;
            }

            logContainer.warn(
                `create-primary: retry create for ${containerName} on network ${fallbackPlan.primaryNetwork} after multi-network create failure`,
            );

            const containerToCreatePrimary = {
                ...containerToCreate,
                NetworkingConfig: {
                    EndpointsConfig: {
                        [fallbackPlan.primaryNetwork]:
                            fallbackPlan.primaryEndpointConfig,
                    },
                },
            };

            let newContainer: Dockerode.Container;
            try {
                newContainer = await this.createContainer(
                    dockerApi,
                    containerToCreatePrimary,
                    containerName,
                    logContainer,
                );
            } catch (primaryCreateError: any) {
                logContainer.warn(
                    `create-primary: failed for ${containerName} (${primaryCreateError.message})`,
                );
                throw primaryCreateError;
            }

            const newContainerIdOrName = newContainer.id || containerName;
            for (const secondaryNetwork of fallbackPlan.secondaryNetworks) {
                const { networkName, endpointConfig } = secondaryNetwork;
                logContainer.info(
                    `connect-secondary:${networkName}: attach ${containerName}`,
                );
                try {
                    const network = dockerApi.getNetwork(networkName);
                    await network.connect({
                        Container: newContainerIdOrName,
                        EndpointConfig: endpointConfig,
                    });
                } catch (connectError: any) {
                    logContainer.warn(
                        `connect-secondary:${networkName}: failed for ${containerName} (${connectError.message})`,
                    );
                    try {
                        await newContainer.remove({ force: true });
                    } catch (cleanupError: any) {
                        logContainer.warn(
                            `connect-secondary:${networkName}: could not remove the partially created container ${containerName} (${cleanupError.message})`,
                        );
                    }
                    throw connectError;
                }
            }

            return newContainer;
        }
    }

    /**
     * Start container.
     */
    async startContainer(
        container: Dockerode.Container,
        containerName: string,
        logContainer: Logger,
    ): Promise<void> {
        logContainer.info(`Start container ${containerName}`);
        try {
            await container.start();
            logContainer.info(
                `Container ${containerName} started with success`,
            );
        } catch (e: any) {
            logContainer.warn(`Error when starting container ${containerName}`);
            throw e;
        }
    }

    /**
     * Remove an image.
     */
    async removeImage(
        dockerApi: Dockerode,
        imageToRemove: string,
        logContainer: Logger,
    ): Promise<void> {
        logContainer.info(`Remove image ${imageToRemove}`);
        try {
            const image = await dockerApi.getImage(imageToRemove);
            await image.remove();
            logContainer.info(`Image ${imageToRemove} removed with success`);
        } catch (e: any) {
            logContainer.warn(`Error when removing image ${imageToRemove}`);
            throw e;
        }
    }

    /**
     * Clone container specs.
     */
    cloneContainer(
        currentContainer: Dockerode.ContainerInspectInfo,
        newImage: string,
    ): Dockerode.ContainerCreateOptions {
        const containerName = currentContainer.Name.replace('/', '');
        const endpointsConfig = currentContainer.NetworkSettings.Networks;
        const sanitizedEndpoints: Record<string, Dockerode.EndpointSettings> =
            {};
        if (endpointsConfig) {
            Object.entries(endpointsConfig).forEach(
                ([networkName, endpoint]) => {
                    sanitizedEndpoints[networkName] =
                        this.sanitizeEndpointConfig(
                            endpoint,
                            currentContainer.Id,
                        );
                },
            );
        }
        const containerClone = {
            ...currentContainer.Config,
            name: containerName,
            Image: newImage,
            HostConfig: currentContainer.HostConfig,
            NetworkingConfig: {
                EndpointsConfig: sanitizedEndpoints,
            },
        };

        // Handle situation when container is using network_mode: service:other_service
        if (
            containerClone.HostConfig &&
            containerClone.HostConfig.NetworkMode &&
            containerClone.HostConfig.NetworkMode.startsWith('container:')
        ) {
            delete containerClone.Hostname;
            delete containerClone.ExposedPorts;
        }

        return containerClone;
    }

    /**
     * Get image full name.
     */
    getNewImageFullName(registry: Registry, container: Container): string {
        // Tag to pull/run is
        // either the same (when updateKind is digest)
        // or the new one (when updateKind is tag)
        const tagOrDigest =
            container.updateKind.kind === 'digest'
                ? container.image.tag.value
                : container.updateKind.remoteValue;

        // Rebuild image definition string
        return registry.getImageFullName(container.image, tagOrDigest);
    }

    /**
     * Pull phase: everything up to and including the image pull.
     * Returns the per-container context, or undefined if the container no longer exists.
     * @param container the container
     * @returns {Promise<ContainerUpdateContext | undefined>}
     */
    async pullContainer(
        container: Container,
    ): Promise<ContainerUpdateContext | undefined> {
        // Child logger for the container to process
        const logContainer = this.log.child({ container: fullName(container) });

        // Get dockerApi from watcher
        const { dockerApi } = this.getWatcher(container);

        // Get registry configuration
        logContainer.debug(
            `Get ${container.image.registry.name} registry manager`,
        );
        const registry = getState().registry[container.image.registry.name];

        logContainer.debug(
            `Get ${container.image.registry.name} registry credentials`,
        );
        const auth = await registry.getAuthPull();

        // Rebuild image definition string
        const newImage = this.getNewImageFullName(registry, container);

        // Get current container
        const currentContainer = await this.getCurrentContainer(
            dockerApi,
            container,
        );

        if (!currentContainer) {
            logContainer.warn(
                'Unable to update the container because it does not exist',
            );
            return undefined;
        }

        const currentContainerSpec = await this.inspectContainer(
            currentContainer,
            logContainer,
        );

        // Try to remove previous pulled images
        if (this.configuration.prune) {
            await this.pruneImages(
                dockerApi,
                registry,
                container,
                logContainer,
            );
        }

        // Pull new image ahead of time
        await this.pullImage(dockerApi, auth, newImage, logContainer);

        return {
            dockerApi,
            registry,
            newImage,
            currentContainer,
            currentContainerSpec,
            state: currentContainerSpec.State,
        };
    }

    /**
     * Start a container that is already restored, reporting how far the rollback got.
     */
    private async restartRolledBack(
        target: Dockerode.Container,
        targetName: string,
        wasRunning: boolean,
        logContainer: Logger,
    ): Promise<RollbackResult> {
        if (!wasRunning) {
            return { disposition: 'rolled_back' };
        }
        try {
            await this.startContainer(target, targetName, logContainer);
        } catch (e: any) {
            logContainer.error(
                `Rollback incomplete for ${targetName}: restored but not started (${e.message})`,
            );
            return { disposition: 'left_stopped', rollbackError: e.message };
        }
        return { disposition: 'rolled_back' };
    }

    /**
     * Undo a failed swap, cheapest and most reliable rung first.
     */
    protected async rollbackSwap(
        ctx: ContainerUpdateContext,
        options: RollbackOptions,
        logContainer: Logger,
    ): Promise<RollbackResult> {
        const { asideName, newContainer, wasRunning, originalName } = options;

        if (newContainer) {
            try {
                await newContainer.remove({ force: true });
            } catch (e: any) {
                logContainer.error(
                    `Rollback failed for ${originalName}: could not remove the replacement container (${e.message})`,
                );
                return { disposition: 'destroyed', rollbackError: e.message };
            }
        }

        if (asideName) {
            try {
                await this.renameContainer(
                    ctx.currentContainer,
                    asideName,
                    originalName,
                    ctx.currentContainerSpec.Id,
                    logContainer,
                );
            } catch (e: any) {
                logContainer.error(
                    `Rollback failed for ${originalName}: could not rename ${asideName} back (${e.message})`,
                );
                return { disposition: 'destroyed', rollbackError: e.message };
            }
            return this.restartRolledBack(
                ctx.currentContainer,
                originalName,
                wasRunning,
                logContainer,
            );
        }

        let original = options.original;
        if (original === 'unknown') {
            try {
                await ctx.currentContainer.inspect();
                original = 'present';
            } catch {
                original = 'removed';
            }
        }
        if (original === 'present') {
            return this.restartRolledBack(
                ctx.currentContainer,
                originalName,
                wasRunning,
                logContainer,
            );
        }

        try {
            const respec = this.cloneContainer(
                ctx.currentContainerSpec,
                ctx.currentContainerSpec.Config.Image,
            );
            const restored = await this.createContainerWithMultiNetworkFallback(
                ctx.dockerApi,
                respec,
                ctx.currentContainerSpec,
                originalName,
                logContainer,
            );
            if (wasRunning) {
                await this.startContainer(restored, originalName, logContainer);
            }
        } catch (e: any) {
            logContainer.error(
                `Rollback failed for ${originalName}: could not recreate the original container (${e.message})`,
            );
            return { disposition: 'destroyed', rollbackError: e.message };
        }
        return { disposition: 'rolled_back' };
    }

    /**
     * Roll a failed swap back and build the error describing what survived.
     */
    private async buildSwapFailure(
        ctx: ContainerUpdateContext,
        cause: Error,
        options: RollbackOptions,
        logContainer: Logger,
    ): Promise<SwapFailedError> {
        const { disposition, rollbackError } = await this.rollbackSwap(
            ctx,
            options,
            logContainer,
        );
        if (disposition === 'rolled_back') {
            return new SwapFailedError(
                `Update failed and the container was rolled back: ${cause.message}`,
                disposition,
            );
        }
        if (disposition === 'left_stopped') {
            return new SwapFailedError(
                `Update failed; the container was restored but could not be started: ${cause.message}`,
                disposition,
            );
        }
        return new SwapFailedError(
            `Update failed and the container could NOT be restored: ${cause.message} (rollback: ${rollbackError})`,
            disposition,
        );
    }

    /**
     * Swap phase: stop/remove the current container and recreate it on the new image.
     * @param container the container
     * @param ctx the context returned by pullContainer
     * @returns {Promise<SwapOutcome>}
     */
    async swapContainer(
        container: Container,
        ctx: ContainerUpdateContext,
    ): Promise<SwapOutcome> {
        // Child logger for the container to process
        const logContainer = this.log.child({ container: fullName(container) });

        const {
            dockerApi,
            registry,
            newImage,
            currentContainer,
            currentContainerSpec,
            state,
        } = ctx;

        // Clone current container spec
        const containerToCreateInspect = this.cloneContainer(
            currentContainerSpec,
            newImage,
        );

        const originalName = currentContainerSpec.Name.replace('/', '');
        const autoRemove = currentContainerSpec.HostConfig?.AutoRemove === true;
        const wasRunning = state.Running === true;
        let asideName: string | undefined;
        let original: 'present' | 'removed' | 'unknown' = 'present';

        if (wasRunning) {
            try {
                await this.stopContainer(
                    currentContainer,
                    originalName,
                    container.id,
                    logContainer,
                );
            } catch (stopError: any) {
                throw new SwapFailedError(stopError.message, 'unchanged');
            }
        }

        if (autoRemove) {
            try {
                await this.waitContainerRemoved(
                    currentContainer,
                    originalName,
                    container.id,
                    logContainer,
                );
                original = 'removed';
            } catch (waitError: any) {
                throw await this.buildSwapFailure(
                    ctx,
                    waitError,
                    {
                        asideName: undefined,
                        newContainer: undefined,
                        wasRunning,
                        originalName,
                        original: 'unknown',
                    },
                    logContainer,
                );
            }
        } else {
            const candidate = this.buildAsideName(
                originalName,
                currentContainerSpec.Id,
            );
            try {
                await this.renameContainer(
                    currentContainer,
                    originalName,
                    candidate,
                    container.id,
                    logContainer,
                );
                asideName = candidate;
            } catch {
                try {
                    await this.removeContainer(
                        currentContainer,
                        originalName,
                        container.id,
                        logContainer,
                    );
                    original = 'removed';
                } catch (removeError: any) {
                    throw await this.buildSwapFailure(
                        ctx,
                        removeError,
                        {
                            asideName,
                            newContainer: undefined,
                            wasRunning,
                            originalName,
                            original: 'unknown',
                        },
                        logContainer,
                    );
                }
            }
        }

        let newContainer: Dockerode.Container | undefined;
        try {
            newContainer = await this.createContainerWithMultiNetworkFallback(
                dockerApi,
                containerToCreateInspect,
                currentContainerSpec,
                originalName,
                logContainer,
            );
            if (wasRunning) {
                await this.startContainer(
                    newContainer,
                    originalName,
                    logContainer,
                );
            }
        } catch (e: any) {
            throw await this.buildSwapFailure(
                ctx,
                e,
                {
                    asideName,
                    newContainer,
                    wasRunning,
                    originalName,
                    original,
                },
                logContainer,
            );
        }

        if (asideName) {
            try {
                await currentContainer.remove({ force: true });
            } catch (e: any) {
                logContainer.warn(
                    `Container ${asideName} could not be removed after a successful update (${e.message})`,
                );
            }
        }

        // Remove previous image (only when updateKind is tag)
        if (this.configuration.prune) {
            const tagOrDigestToRemove =
                container.updateKind.kind === 'tag'
                    ? container.image.tag.value
                    : container.image.digest.repo;

            // Rebuild image definition string
            const oldImage = registry.getImageFullName(
                container.image,
                tagOrDigestToRemove,
            );
            try {
                await this.removeImage(dockerApi, oldImage, logContainer);
            } catch (e: any) {
                logContainer.warn(
                    `Image ${oldImage} could not be removed after a successful update (${e.message})`,
                );
            }
        }

        return {
            container,
            success: true,
            newContainerId: newContainer.id,
            startedAfterSwap: state.Running,
            oldContainerId: currentContainerSpec.Id,
        };
    }

    /**
     * Interval between two health-gate polls. Overridable in tests.
     */
    protected getPostupdatePollIntervalMs(): number {
        return 2000;
    }

    /**
     * Wait for an updated container to be ready before bouncing its dependents.
     * @param dockerApi the docker api of the watcher owning the container
     * @param swap the outcome of the swap phase
     * @param timeoutMs the maximum time to wait
     */
    protected async waitForPostUpdateReady(
        dockerApi: Dockerode,
        swap: SwapOutcome,
        timeoutMs: number,
    ): Promise<{ ready: boolean; reason?: string }> {
        if (!swap.startedAfterSwap) {
            return {
                ready: false,
                reason: 'container not started after update',
            };
        }
        const deadline = Date.now() + timeoutMs;
        for (;;) {
            try {
                const spec = await dockerApi
                    .getContainer(swap.newContainerId as string)
                    .inspect();
                const health = spec?.State?.Health;
                if (health) {
                    if (health.Status === 'healthy') {
                        return { ready: true };
                    }
                    if (health.Status === 'unhealthy') {
                        return { ready: false, reason: 'unhealthy' };
                    }
                } else if (spec?.State?.Running === true) {
                    return { ready: true };
                }
            } catch (e: any) {
                return { ready: false, reason: e.message };
            }
            if (Date.now() >= deadline) {
                return {
                    ready: false,
                    reason: `health gate timeout after ${timeoutMs}ms`,
                };
            }
            await new Promise((resolve) =>
                setTimeout(resolve, this.getPostupdatePollIntervalMs()),
            );
        }
    }

    /**
     * Get the dependent container names declared by the wud.postupdate.restart label.
     * @param container the updated container
     */
    protected getPostupdateRestartNames(container: Container): string[] {
        const label = container.labels?.[wudPostupdateRestart];
        if (!label) {
            return [];
        }
        return label
            .split(/\s*,\s*/)
            .map((name: string) => name.trim())
            .filter((name: string) => name.length > 0);
    }

    /**
     * Find a dependent container by name on the watcher docker daemon.
     * @param dockerApi the docker api of the watcher owning the updated container
     * @param name the dependent name as declared on the label
     * @param logContainer the child logger of the updated container
     */
    protected async resolveDependent(
        dockerApi: Dockerode,
        name: string,
        logContainer: Logger,
    ): Promise<{ id: string; name: string } | undefined> {
        let containers: Dockerode.ContainerInfo[];
        try {
            containers = await dockerApi.listContainers({ all: true });
        } catch (e: any) {
            logContainer.warn(
                `Error when listing containers to resolve dependent ${name} (${e.message})`,
            );
            return undefined;
        }
        const candidates = (containers ?? []).map((containerInfo) => ({
            id: containerInfo.Id,
            name: (containerInfo.Names?.[0] ?? '').replace(/\//, ''),
        }));
        const exactMatch = candidates.find(
            (candidate) => candidate.name === name,
        );
        if (exactMatch) {
            return exactMatch;
        }
        // Compose recreates containers under a <hash>_<name> temporary name
        const prefixedMatch = candidates.find(
            (candidate) =>
                candidate.name.replace(/^[a-f0-9]{8,12}_/i, '') === name,
        );
        return prefixedMatch;
    }

    /**
     * Restart (or recreate, when it references the updated container namespace)
     * a dependent container.
     * @param dockerApi the docker api of the watcher owning the updated container
     * @param resolved the resolved dependent
     * @param swap the outcome of the swap phase of the updated container
     * @param hostName the name of the updated container
     * @param logContainer the child logger of the updated container
     */
    protected async bounceDependent(
        dockerApi: Dockerode,
        resolved: { id: string; name: string },
        swap: SwapOutcome,
        hostName: string,
        logContainer: Logger,
    ): Promise<DependentOutcome> {
        const outcome = { name: resolved.name, host: hostName };
        try {
            const dependent = dockerApi.getContainer(resolved.id);
            const depSpec = await dependent.inspect();
            const ref = depSpec.HostConfig?.NetworkMode;
            const refTarget = ref?.startsWith('container:')
                ? ref.slice('container:'.length)
                : undefined;
            const referencesHost =
                refTarget !== undefined &&
                (refTarget === swap.oldContainerId ||
                    // Hex guard: a short container NAME prefixing the old id must not recreate
                    (/^[a-f0-9]{8,64}$/i.test(refTarget) &&
                        swap.oldContainerId.startsWith(refTarget)) ||
                    refTarget === hostName);
            const running = depSpec.State?.Running === true;

            if (!referencesHost) {
                if (!running) {
                    return {
                        ...outcome,
                        status: 'skipped',
                        reason: 'not running',
                    };
                }
                logContainer.info(
                    `Restart dependent container ${resolved.name} with id ${resolved.id}`,
                );
                await dependent.restart();
                return { ...outcome, status: 'bounced', method: 'restart' };
            }

            const specToCreate = this.cloneContainer(
                depSpec,
                depSpec.Config.Image,
            );
            specToCreate.HostConfig = {
                ...(specToCreate.HostConfig ?? {}),
                NetworkMode: `container:${swap.newContainerId}`,
            };

            const depAutoRemove = depSpec.HostConfig?.AutoRemove === true;
            const failedReason = (cause: string, restored: boolean) =>
                restored
                    ? `recreate failed, dependent rolled back: ${cause}`
                    : `recreate failed and the dependent could NOT be restored: ${cause}`;
            let depAsideName: string | undefined;

            if (running) {
                await this.stopContainer(
                    dependent,
                    resolved.name,
                    resolved.id,
                    logContainer,
                );
            }
            if (depAutoRemove) {
                await this.waitContainerRemoved(
                    dependent,
                    resolved.name,
                    resolved.id,
                    logContainer,
                );
            } else {
                const candidate = this.buildAsideName(
                    resolved.name,
                    resolved.id,
                );
                try {
                    await this.renameContainer(
                        dependent,
                        resolved.name,
                        candidate,
                        resolved.id,
                        logContainer,
                    );
                    depAsideName = candidate;
                } catch {
                    await this.removeContainer(
                        dependent,
                        resolved.name,
                        resolved.id,
                        logContainer,
                    );
                }
            }

            let newDependent: Dockerode.Container | undefined;
            try {
                newDependent =
                    await this.createContainerWithMultiNetworkFallback(
                        dockerApi,
                        specToCreate,
                        depSpec,
                        resolved.name,
                        logContainer,
                    );
                if (running) {
                    await this.startContainer(
                        newDependent,
                        resolved.name,
                        logContainer,
                    );
                }
            } catch (e: any) {
                if (!depAsideName) {
                    logContainer.error(
                        `Dependent container ${resolved.name} could NOT be restored after a failed recreate (${e.message})`,
                    );
                    return {
                        ...outcome,
                        status: 'failed',
                        reason: failedReason(e.message, false),
                    };
                }
                try {
                    if (newDependent) {
                        await newDependent.remove({ force: true });
                    }
                    await this.renameContainer(
                        dependent,
                        depAsideName,
                        resolved.name,
                        resolved.id,
                        logContainer,
                    );
                } catch (rollbackError: any) {
                    logContainer.error(
                        `Dependent container ${resolved.name} could NOT be restored (${rollbackError.message})`,
                    );
                    return {
                        ...outcome,
                        status: 'failed',
                        reason: failedReason(e.message, false),
                    };
                }
                const { disposition } = await this.restartRolledBack(
                    dependent,
                    resolved.name,
                    running,
                    logContainer,
                );
                return {
                    ...outcome,
                    status: 'failed',
                    reason: failedReason(
                        e.message,
                        disposition === 'rolled_back',
                    ),
                };
            }

            if (depAsideName) {
                try {
                    await dependent.remove({ force: true });
                } catch (cleanupError: any) {
                    logContainer.warn(
                        `Container ${depAsideName} could not be removed after a successful dependent recreate (${cleanupError.message})`,
                    );
                }
            }

            logContainer.warn(
                `Dependent container ${resolved.name} was recreated with id ${newDependent.id} to re-attach to ${hostName}`,
            );
            return running
                ? { ...outcome, status: 'bounced', method: 'recreate' }
                : {
                      ...outcome,
                      status: 'bounced',
                      method: 'recreate',
                      reason: 'recreated but left stopped',
                  };
        } catch (e: any) {
            return { ...outcome, status: 'failed', reason: e.message };
        }
    }

    /**
     * Increase the Prometheus post-update bounce counter with the provided status.
     * @param status the dependent bounce outcome status
     */
    protected increasePostupdateBounceCounter(
        status: DependentOutcomeStatus,
    ): void {
        const bounceCounter = getPostupdateBounceCounter();
        if (bounceCounter) {
            bounceCounter.inc({
                type: this.type,
                name: this.name,
                status,
            });
        }
    }

    /**
     * Post-update epilogue: bounce the dependents declared by the
     * wud.postupdate.restart label of every successfully updated container.
     * @param swaps the outcome of every member that reached the swap phase
     * @param memberNames the normalized names of the effective batch members
     */
    protected async runPostUpdate(
        swaps: SwapOutcome[],
        memberNames: Set<string>,
    ): Promise<DependentOutcome[]> {
        const entries: {
            name: string;
            swap: SwapOutcome;
            outcome?: DependentOutcome;
        }[] = [];
        const collectedNames = new Set<string>();

        // Collection pass — member order, then label order within a member.
        for (const swap of swaps) {
            if (!swap.success) {
                continue;
            }
            const hostName = swap.container.name.trim();
            for (const name of this.getPostupdateRestartNames(swap.container)) {
                if (name === hostName) {
                    entries.push({
                        name,
                        swap,
                        outcome: {
                            name,
                            host: hostName,
                            status: 'skipped',
                            reason: 'self-reference',
                        },
                    });
                    continue;
                }
                if (memberNames.has(name)) {
                    const memberSwap = swaps.find(
                        (candidate) => candidate.container.name.trim() === name,
                    );
                    entries.push({
                        name,
                        swap,
                        outcome: {
                            name,
                            host: hostName,
                            status: 'skipped',
                            reason:
                                memberSwap && !memberSwap.success
                                    ? 'batch member, update failed'
                                    : 'batch member, already updated',
                        },
                    });
                    continue;
                }
                // First host naming a dependent wins
                if (collectedNames.has(name)) {
                    continue;
                }
                collectedNames.add(name);
                entries.push({ name, swap });
            }
        }

        if (entries.length === 0) {
            return [];
        }

        const loggers = new Map<SwapOutcome, Logger>();
        const loggerFor = (swap: SwapOutcome): Logger => {
            let logContainer = loggers.get(swap);
            if (!logContainer) {
                logContainer = this.log.child({
                    container: fullName(swap.container),
                });
                loggers.set(swap, logContainer);
            }
            return logContainer;
        };

        // Health gate pass — once per host that has dependents to bounce.
        for (const swap of swaps) {
            const gated = entries.filter(
                (entry) => entry.swap === swap && !entry.outcome,
            );
            if (gated.length === 0) {
                continue;
            }
            const { dockerApi } = this.getWatcher(swap.container);
            const gate = await this.waitForPostUpdateReady(
                dockerApi,
                swap,
                this.configuration.postupdatetimeout,
            );
            if (!gate.ready) {
                gated.forEach((entry) => {
                    entry.outcome = {
                        name: entry.name,
                        host: swap.container.name.trim(),
                        status: 'skipped',
                        reason: `health gate: ${gate.reason}`,
                    };
                });
            }
        }

        // Bounce pass — collection order; a failure never aborts the loop.
        for (const entry of entries) {
            if (entry.outcome) {
                continue;
            }
            const { swap } = entry;
            const hostName = swap.container.name.trim();
            const logContainer = loggerFor(swap);
            const { dockerApi } = this.getWatcher(swap.container);
            const resolved = await this.resolveDependent(
                dockerApi,
                entry.name,
                logContainer,
            );
            if (!resolved) {
                entry.outcome = {
                    name: entry.name,
                    host: hostName,
                    status: 'skipped',
                    reason: 'unresolved',
                };
                continue;
            }
            const outcome = await this.bounceDependent(
                dockerApi,
                resolved,
                swap,
                hostName,
                logContainer,
            );
            // Report the dependent under the name declared on the label
            entry.outcome = { ...outcome, name: entry.name };
        }

        return entries.map((entry) => {
            const outcome = entry.outcome as DependentOutcome;
            const logContainer = loggerFor(entry.swap);
            if (outcome.status === 'bounced') {
                logContainer.info(
                    `Dependent container ${outcome.name} bounced with method ${outcome.method}${outcome.reason ? ` (${outcome.reason})` : ''}`,
                );
            } else {
                logContainer.warn(
                    `Dependent container ${outcome.name} ${outcome.status} (${outcome.reason})`,
                );
            }
            this.increasePostupdateBounceCounter(outcome.status);
            return outcome;
        });
    }

    /**
     * Swap every member that has a context and convert rejections into failed
     * swap outcomes, so a failing member never strands its siblings.
     * @param containers the batch members
     * @param contexts the contexts returned by the pull phase, member-aligned
     */
    protected async swapAll(
        containers: Container[],
        contexts: (ContainerUpdateContext | undefined)[],
    ): Promise<SwapOutcome[]> {
        const settled = await Promise.allSettled(
            containers.map((container, index) => {
                const ctx = contexts[index];
                if (!ctx) {
                    return Promise.reject(new ContainerGoneError(container));
                }
                return this.swapContainer(container, ctx);
            }),
        );
        return settled.map((result, index) => {
            if (result.status === 'fulfilled') {
                return result.value;
            }
            const error = String(result.reason?.message ?? result.reason);
            const container = containers[index];
            this.log.warn(
                `Error when updating container ${container.name} (${error})`,
            );
            return {
                container,
                success: false,
                startedAfterSwap: false,
                oldContainerId:
                    contexts[index]?.currentContainerSpec?.Id ?? container.id,
                error,
                ...(result.reason instanceof ContainerGoneError
                    ? { gone: true }
                    : {}),
                ...(result.reason instanceof SwapFailedError
                    ? { disposition: result.reason.disposition }
                    : {}),
            };
        });
    }

    /**
     * Convert swap outcomes into the batch member outcomes reported by the API.
     * @param swaps the swap outcomes
     */
    protected toMemberOutcomes(swaps: SwapOutcome[]): MemberOutcome[] {
        return swaps.map((swap) => ({
            id: swap.container.id,
            name: swap.container.name,
            status: swap.success ? 'updated' : 'failed',
            ...(swap.error ? { error: swap.error } : {}),
            ...(swap.gone ? { gone: true } : {}),
        }));
    }

    /**
     * Update the container.
     * @param container the container
     * @returns {Promise<TriggerRunResult | undefined>}
     */
    async trigger(container: Container): Promise<TriggerRunResult | undefined> {
        const ctx = await this.pullContainer(container);
        if (!ctx) {
            throw new ContainerGoneError(container);
        }

        // Dry-run?
        if (this.configuration.dryrun) {
            const logContainer = this.log.child({
                container: fullName(container),
            });
            logContainer.info(
                'Do not replace the existing container because dry-run mode is enabled',
            );
            return;
        }

        const swap = await this.swapContainer(container, ctx);
        const dependents = await this.runPostUpdate(
            [swap],
            new Set([container.name.trim()]),
        );
        return { members: this.toMemberOutcomes([swap]), dependents };
    }

    /**
     * Update the containers as a two-phase lockstep operation: pull ALL images
     * (the barrier), then swap ALL containers back-to-back.
     * @param containers
     * @returns {Promise<TriggerRunResult | undefined>}
     */
    async triggerBatch(
        containers: Container[],
    ): Promise<TriggerRunResult | undefined> {
        // Phase 1 — pull ALL. A pull rejection aborts here, so no swap happens.
        const contexts = await Promise.all(
            containers.map((container) => this.pullContainer(container)),
        );

        // Dry-run pulls all, swaps none.
        if (this.configuration.dryrun) {
            return;
        }

        // Phase 2 — swap ALL. A member that vanished before the pull fails.
        const swaps = await this.swapAll(containers, contexts);

        const dependents = await this.runPostUpdate(
            swaps,
            new Set(containers.map((container) => container.name.trim())),
        );
        return { members: this.toMemberOutcomes(swaps), dependents };
    }
}

export default Docker;
