import Dockerode from 'dockerode';
import type Registry from '../../../registries/Registry';
import type { Container } from '../../../model/container';

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

/**
 * Result of a single container swap.
 */
export interface SwapOutcome {
    container: Container;
    success: boolean;
    newContainerId?: string;
    startedAfterSwap: boolean;
    oldContainerId: string;
    error?: string;
    gone?: boolean;
}

export type DependentOutcomeStatus = 'bounced' | 'skipped' | 'failed';

/**
 * Outcome of the post-update bounce of a single dependent container.
 */
export interface DependentOutcome {
    name: string;
    host: string;
    status: DependentOutcomeStatus;
    method?: 'restart' | 'recreate';
    reason?: string;
}

/**
 * Outcome of a single batch member update.
 */
export interface MemberOutcome {
    id: string;
    name: string;
    status: 'updated' | 'failed';
    error?: string;
    fileUpdated?: boolean; // omitted unless a compose image line was expected to change
    gone?: boolean; // omitted unless the container no longer exists in Docker
}

/**
 * Structured result returned by trigger providers that support it.
 */
export interface TriggerRunResult {
    members?: MemberOutcome[];
    dependents?: DependentOutcome[];
}
