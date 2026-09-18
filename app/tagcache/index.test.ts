import bunyan from 'bunyan';
import fs from 'fs';
import os from 'os';
import path from 'path';
import logger from '../log';
import * as tagcache from './index';

const TAG_CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const TMP_GRACE_MS = 60 * 60 * 1000;

describe('memory tier', () => {
    beforeEach(async () => {
        await tagcache.init({ enabled: false });
    });

    test('getTagList should return undefined for an unknown key', async () => {
        expect(await tagcache.getTagList('unknown')).toBeUndefined();
    });

    test('setTagList should make the very same array available to getTagList', async () => {
        const tags = ['v1', 'v2'];
        await tagcache.setTagList('key', tags);
        expect(await tagcache.getTagList('key')).toBe(tags);
    });

    test('deleteTagList should drop the entry', async () => {
        await tagcache.setTagList('key', ['v1']);
        await tagcache.deleteTagList('key');
        expect(await tagcache.getTagList('key')).toBeUndefined();
    });

    test('init should clear the memory tier', async () => {
        await tagcache.setTagList('key', ['v1']);
        await tagcache.init({ enabled: false });
        expect(await tagcache.getTagList('key')).toBeUndefined();
    });

    test('getConfiguration should default to disabled on the default path', async () => {
        await tagcache.init();
        expect(tagcache.getConfiguration()).toStrictEqual({
            enabled: false,
            path: '/tagcache',
        });
    });

    test('should not write anything to disk when disabled', async () => {
        const tmp = await fs.promises.mkdtemp(
            path.join(os.tmpdir(), 'wud-tagcache-'),
        );
        const never = path.join(tmp, 'never');
        try {
            await tagcache.init({ enabled: false, path: never });
            await tagcache.setTagList('key', ['v1']);
            expect(fs.existsSync(never)).toEqual(false);
        } finally {
            await fs.promises.rm(tmp, { recursive: true, force: true });
        }
    });
});

describe('disk tier', () => {
    let tmp: string;

    beforeEach(async () => {
        tmp = await fs.promises.mkdtemp(
            path.join(os.tmpdir(), 'wud-tagcache-'),
        );
        await tagcache.init({ enabled: true, path: tmp });
    });

    afterEach(async () => {
        await fs.promises.rm(tmp, { recursive: true, force: true });
    });

    const listDir = async () => (await fs.promises.readdir(tmp)).sort();

    const readEntry = async (name: string) =>
        JSON.parse(await fs.promises.readFile(path.join(tmp, name), 'utf-8'));

    const backDate = async (name: string, ms: number) => {
        const when = new Date(Date.now() - ms);
        await fs.promises.utimes(path.join(tmp, name), when, when);
        return (await fs.promises.stat(path.join(tmp, name))).mtimeMs;
    };

    const mtimeOf = async (name: string) =>
        (await fs.promises.stat(path.join(tmp, name))).mtimeMs;

    test('setTagList should write exactly one json file and leave no temp file', async () => {
        await tagcache.setTagList('key', ['v1', 'v10', 'v2']);
        const entries = await listDir();
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatch(/\.json$/);
    });

    test('setTagList should write the tags in the order given', async () => {
        await tagcache.setTagList('key', ['v1', 'v10', 'v2']);
        const [name] = await listDir();
        expect(await readEntry(name)).toStrictEqual({
            version: 1,
            key: 'key',
            tags: ['v1', 'v10', 'v2'],
            updatedAt: expect.any(Number),
        });
    });

    test('getTagList should hydrate the memory tier from disk after a restart', async () => {
        await tagcache.setTagList('key', ['v1', 'v2']);
        await tagcache.init({ enabled: true, path: tmp });
        expect(await tagcache.getTagList('key')).toEqual(['v1', 'v2']);
    });

    test('init should create a nested non existing path', async () => {
        const nested = path.join(tmp, 'a', 'b');
        await tagcache.init({ enabled: true, path: nested });
        expect(fs.existsSync(nested)).toEqual(true);
    });

    test('deleteTagList should unlink the file', async () => {
        await tagcache.setTagList('key', ['v1']);
        await tagcache.deleteTagList('key');
        expect(await listDir()).toEqual([]);
    });

    test('deleteTagList should not throw when the key is unknown', async () => {
        await expect(
            tagcache.deleteTagList('unknown'),
        ).resolves.toBeUndefined();
    });

    test('setTagList should not rewrite the file when the tag list is unchanged', async () => {
        await tagcache.setTagList('key', ['a', 'b']);
        const [name] = await listDir();
        const backDated = await backDate(name, 60000);
        await tagcache.setTagList('key', ['a', 'b']);
        expect(await mtimeOf(name)).toEqual(backDated);
    });

    test('setTagList should not rewrite the file when given the same array reference', async () => {
        const tags = ['a', 'b'];
        await tagcache.setTagList('key', tags);
        const [name] = await listDir();
        const backDated = await backDate(name, 60000);
        await tagcache.setTagList('key', tags);
        expect(await mtimeOf(name)).toEqual(backDated);
    });

    test('setTagList should rewrite the file when a tag is appended', async () => {
        await tagcache.setTagList('key', ['a', 'b']);
        const [name] = await listDir();
        const backDated = await backDate(name, 60000);
        await tagcache.setTagList('key', ['a', 'b', 'c']);
        expect(await mtimeOf(name)).toBeGreaterThan(backDated);
        expect((await readEntry(name)).tags).toEqual(['a', 'b', 'c']);
    });

    test('setTagList should write the file again after a restart even when the tag list is unchanged', async () => {
        await tagcache.setTagList('key', ['a', 'b']);
        const [name] = await listDir();
        const backDated = await backDate(name, 60000);
        await tagcache.init({ enabled: true, path: tmp });
        await tagcache.setTagList('key', ['a', 'b']);
        expect(await mtimeOf(name)).toBeGreaterThan(backDated);
    });

    test('setTagList should not rewrite the file after hydrating it from disk', async () => {
        await tagcache.setTagList('key', ['a', 'b']);
        const [name] = await listDir();
        const backDated = await backDate(name, 60000);
        await tagcache.init({ enabled: true, path: tmp });
        const hydrated = await tagcache.getTagList('key');
        expect(hydrated).toEqual(['a', 'b']);
        await tagcache.setTagList('key', hydrated as string[]);
        expect(await mtimeOf(name)).toEqual(backDated);
    });

    test('getTagList should treat a corrupted file as a miss', async () => {
        await tagcache.setTagList('key', ['v1']);
        const [name] = await listDir();
        await fs.promises.writeFile(path.join(tmp, name), 'not json', 'utf-8');
        await tagcache.init({ enabled: true, path: tmp });
        expect(await tagcache.getTagList('key')).toBeUndefined();
    });

    test('getTagList should treat an unknown schema version as a miss', async () => {
        await tagcache.setTagList('key', ['v1']);
        const [name] = await listDir();
        await fs.promises.writeFile(
            path.join(tmp, name),
            JSON.stringify({
                version: 2,
                key: 'key',
                tags: ['v1'],
                updatedAt: Date.now(),
            }),
            'utf-8',
        );
        await tagcache.init({ enabled: true, path: tmp });
        expect(await tagcache.getTagList('key')).toBeUndefined();
    });

    test('getTagList should treat a key mismatch as a miss', async () => {
        await tagcache.setTagList('key', ['v1']);
        const [name] = await listDir();
        await fs.promises.writeFile(
            path.join(tmp, name),
            JSON.stringify({
                version: 1,
                key: 'another key',
                tags: ['v1'],
                updatedAt: Date.now(),
            }),
            'utf-8',
        );
        await tagcache.init({ enabled: true, path: tmp });
        expect(await tagcache.getTagList('key')).toBeUndefined();
    });

    test('should derive a filesystem safe file name from the key', async () => {
        await tagcache.setTagList(
            'ghcr.private|https://ghcr.io/v2|immich-app/immich-server',
            ['v1'],
        );
        const [name] = await listDir();
        expect(name).toMatch(/^[A-Za-z0-9._-]+-[0-9a-f]{16}\.json$/);
    });

    test('should derive different file names for keys sharing their slug', async () => {
        await tagcache.setTagList(`${'x'.repeat(120)}|a`, ['v1']);
        await tagcache.setTagList(`${'x'.repeat(120)}|b`, ['v2']);
        expect(await listDir()).toHaveLength(2);
    });

    describe('failure modes', () => {
        test('init should disable the disk tier when the path is not usable', async () => {
            await fs.promises.writeFile(path.join(tmp, 'blocker'), 'x');
            await expect(
                tagcache.init({
                    enabled: true,
                    path: path.join(tmp, 'blocker', 'cache'),
                }),
            ).resolves.toBeUndefined();
            expect(tagcache.getConfiguration().enabled).toEqual(false);
            const tags = ['v1'];
            await tagcache.setTagList('key', tags);
            expect(await tagcache.getTagList('key')).toBe(tags);
        });

        test('setTagList should not throw when the write fails', async () => {
            await fs.promises.rm(tmp, { recursive: true, force: true });
            const tags = ['v1'];
            await expect(
                tagcache.setTagList('key', tags),
            ).resolves.toBeUndefined();
            expect(await tagcache.getTagList('key')).toBe(tags);
        });

        test('setTagList should retry a write that previously failed', async () => {
            await tagcache.setTagList('key', ['a', 'b']);
            await fs.promises.rm(tmp, { recursive: true, force: true });
            await tagcache.setTagList('key', ['a', 'b', 'c']);
            await fs.promises.mkdir(tmp, { recursive: true });
            await tagcache.setTagList('key', ['a', 'b', 'c']);
            const entries = await listDir();
            expect(entries).toHaveLength(1);
            expect((await readEntry(entries[0])).tags).toEqual(['a', 'b', 'c']);
        });
    });

    describe('pruning', () => {
        test('init should remove expired entries and keep fresh ones', async () => {
            await tagcache.setTagList('stale', ['v1']);
            await tagcache.setTagList('fresh', ['v2']);
            const [staleName] = (await listDir()).filter((name) =>
                name.startsWith('stale-'),
            );
            await backDate(staleName, TAG_CACHE_TTL_MS + 1000);
            await tagcache.init({ enabled: true, path: tmp });
            const entries = await listDir();
            expect(entries).toHaveLength(1);
            expect(entries[0]).toMatch(/^fresh-/);
        });

        test('init should remove abandoned temp files', async () => {
            const name = 'key.json.1.abcdef.tmp';
            await fs.promises.writeFile(path.join(tmp, name), 'x');
            await backDate(name, TMP_GRACE_MS + 1000);
            await tagcache.init({ enabled: true, path: tmp });
            expect(await listDir()).toEqual([]);
        });

        test('init should keep a temp file that may still be in flight', async () => {
            const name = 'key.json.1.abcdef.tmp';
            await fs.promises.writeFile(path.join(tmp, name), 'x');
            await tagcache.init({ enabled: true, path: tmp });
            expect(await listDir()).toEqual([name]);
        });

        test('init should log how many entries were pruned', async () => {
            await tagcache.setTagList('key', ['v1']);
            const [name] = await listDir();
            await backDate(name, TAG_CACHE_TTL_MS + 1000);
            const info = jest.spyOn(
                Object.getPrototypeOf(logger) as bunyan,
                'info',
            );
            try {
                await tagcache.init({ enabled: true, path: tmp });
                expect(info).toHaveBeenCalledWith(
                    'Pruned 1 stale tag cache file(s)',
                );
            } finally {
                info.mockRestore();
            }
            expect(await listDir()).toEqual([]);
        });
    });
});
