import type { Container } from '../../../model/container';
import type { SwapDisposition } from './types';

export class ContainerGoneError extends Error {
    readonly containerId: string;

    constructor(container: Container) {
        super(`Container ${container.name} no longer exists`);
        this.name = 'ContainerGoneError';
        this.containerId = container.id;
    }
}

export class SwapFailedError extends Error {
    readonly disposition: SwapDisposition;

    constructor(message: string, disposition: SwapDisposition) {
        super(message);
        this.name = 'SwapFailedError';
        this.disposition = disposition;
    }
}
