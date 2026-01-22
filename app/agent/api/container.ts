import { Request, Response } from 'express';
import * as storeContainer from '../../store/container';

/**
 * Get Containers (Handshake).
 */
export function getContainers(req: Request, res: Response) {
    const containers = storeContainer.getContainers();
    res.json(containers);
}
