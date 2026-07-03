import Dockerode from 'dockerode';
import type Registry from '../../../registries/Registry';

/**
 * Handoff object returned by pullContainer and consumed by swapContainer.
 * Both phases derive their own child logger, so it is intentionally not part of the context.
 */
export interface ContainerUpdateContext {
    dockerApi: Dockerode;
    registry: Registry;
    newImage: string;
    currentContainer: Dockerode.Container;
    currentContainerSpec: Dockerode.ContainerInspectInfo;
    state: Dockerode.ContainerInspectInfo['State'];
}
