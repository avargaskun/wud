import { createHash, randomBytes } from 'crypto';
import fs from 'fs';
import joi from 'joi';
import path from 'path';
import logger from '../log';
import { getTagCacheConfiguration } from '../configuration';

const log = logger.child({ component: 'tagcache' });

const DEFAULT_PATH = '/tagcache';
const TAG_CACHE_SCHEMA_VERSION = 1;
const SLUG_MAX_LENGTH = 100;
const HASH_LENGTH = 16;

export interface TagCacheConfiguration {
    enabled: boolean;
    path: string;
}

export interface TagCacheInitOptions {
    enabled?: boolean;
    path?: string;
}

interface TagCacheFile {
    version: number;
    key: string;
    tags: string[];
    updatedAt: number;
}

const configurationSchema = joi.object().keys({
    enabled: joi.boolean().default(false),
    path: joi.string().default(DEFAULT_PATH),
});

const memory: Map<string, string[]> = new Map();

/**
 * What was last successfully written to disk, per key -- not what the memory tier holds.
 */
const persisted: Map<string, string[]> = new Map();

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

function fileNameFor(key: string): string {
    const slug = key.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, SLUG_MAX_LENGTH);
    const hash = createHash('sha256')
        .update(key)
        .digest('hex')
        .slice(0, HASH_LENGTH);
    return `${slug}-${hash}.json`;
}

function pathFor(key: string): string {
    return path.join(configuration.path, fileNameFor(key));
}

async function readFromDisk(key: string): Promise<string[] | undefined> {
    try {
        const raw = await fs.promises.readFile(pathFor(key), 'utf-8');
        const parsed = JSON.parse(raw) as Partial<TagCacheFile>;
        if (
            parsed?.version !== TAG_CACHE_SCHEMA_VERSION ||
            parsed.key !== key ||
            !Array.isArray(parsed.tags)
        ) {
            return undefined;
        }
        return parsed.tags;
    } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
            log.debug(
                `Unable to read the tag cache entry for ${key} (${(e as Error).message})`,
            );
        }
        return undefined;
    }
}

async function writeAtomic(file: string, payload: TagCacheFile): Promise<void> {
    const tmp = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
    try {
        await fs.promises.writeFile(tmp, JSON.stringify(payload), 'utf-8');
        await fs.promises.rename(tmp, file);
    } catch (e) {
        await fs.promises.rm(tmp, { force: true });
        throw e;
    }
}

/**
 * Init the tag cache.
 */
export async function init(options?: TagCacheInitOptions): Promise<void> {
    memory.clear();
    persisted.clear();
    configuration = resolveConfiguration(options);
    if (!configuration.enabled) {
        return;
    }
    await fs.promises.mkdir(configuration.path, { recursive: true });
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
    const inMemory = memory.get(key);
    if (inMemory !== undefined) {
        return inMemory;
    }
    if (!configuration.enabled) {
        return undefined;
    }
    const fromDisk = await readFromDisk(key);
    if (fromDisk !== undefined) {
        memory.set(key, fromDisk);
        persisted.set(key, fromDisk);
    }
    return fromDisk;
}

/**
 * Cache the tag list for a key.
 */
export async function setTagList(key: string, tags: string[]): Promise<void> {
    memory.set(key, tags);
    if (!configuration.enabled) {
        return;
    }
    const lastPersisted = persisted.get(key);
    const unchanged =
        lastPersisted === tags ||
        (lastPersisted !== undefined &&
            lastPersisted.length === tags.length &&
            lastPersisted.every((t, i) => t === tags[i]));
    if (unchanged) {
        return;
    }
    await writeAtomic(pathFor(key), {
        version: TAG_CACHE_SCHEMA_VERSION,
        key,
        tags,
        updatedAt: Date.now(),
    });
    persisted.set(key, tags);
}

/**
 * Drop the cached tag list for a key.
 */
export async function deleteTagList(key: string): Promise<void> {
    memory.delete(key);
    persisted.delete(key);
    if (!configuration.enabled) {
        return;
    }
    try {
        await fs.promises.unlink(pathFor(key));
    } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT') {
            log.debug(
                `Unable to delete the tag cache entry for ${key} (${(e as Error).message})`,
            );
        }
    }
}
