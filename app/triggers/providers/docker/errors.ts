import type { Container } from '../../../model/container';

export class ContainerGoneError extends Error {
    readonly containerId: string;

    constructor(container: Container) {
        super(`Container ${container.name} no longer exists`);
        this.name = 'ContainerGoneError';
        this.containerId = container.id;
    }
}
