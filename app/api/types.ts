import { UpdateBucketKey } from '../model/container';

/**
 * Request body for the single-container trigger endpoint.
 */
export interface TriggerRequestBody {
    bucket?: UpdateBucketKey;
}

/**
 * Request body for the batch trigger endpoint.
 */
export interface BatchTriggerRequestBody {
    containerIds: string[];
    bucket?: UpdateBucketKey;
}
