import joi from 'joi';
import logger from '../log';
import { getTagCacheConfiguration } from '../configuration';

const log = logger.child({ component: 'tagcache' });

const DEFAULT_PATH = '/tagcache';

export interface TagCacheConfiguration {
    enabled: boolean;
    path: string;
}

export interface TagCacheInitOptions {
    enabled?: boolean;
    path?: string;
}

const configurationSchema = joi.object().keys({
    enabled: joi.boolean().default(false),
    path: joi.string().default(DEFAULT_PATH),
});

const memory: Map<string, string[]> = new Map();
let configuration: TagCacheConfiguration = {
    enabled: false,
    path: DEFAULT_PATH,
};

function resolveConfiguration(
    options: TagCacheInitOptions = {},
): TagCacheConfiguration {
    const merged: Record<string, unknown> = {
        ...(getTagCacheConfiguration() || {}),
    };
    if (options.enabled !== undefined) {
        merged.enabled = options.enabled;
    }
    if (options.path !== undefined) {
        merged.path = options.path;
    }
    const validated = configurationSchema.validate(merged);
    if (validated.error) {
        log.warn(
            `Invalid tag cache configuration (${validated.error.message}); tag cache persistence is disabled`,
        );
        return { enabled: false, path: DEFAULT_PATH };
    }
    return validated.value as TagCacheConfiguration;
}

/**
 * Init the tag cache.
 */
export async function init(options?: TagCacheInitOptions): Promise<void> {
    memory.clear();
    configuration = resolveConfiguration(options);
    if (!configuration.enabled) {
        return;
    }
}

/**
 * Get the resolved tag cache configuration.
 */
export function getConfiguration(): TagCacheConfiguration {
    return configuration;
}

/**
 * Get the cached tag list for a key.
 */
export async function getTagList(key: string): Promise<string[] | undefined> {
    return memory.get(key);
}

/**
 * Cache the tag list for a key.
 */
export async function setTagList(key: string, tags: string[]): Promise<void> {
    memory.set(key, tags);
}

/**
 * Drop the cached tag list for a key.
 */
export async function deleteTagList(key: string): Promise<void> {
    memory.delete(key);
}
