import fs from 'fs';
import os from 'os';
import path from 'path';
import * as tagcache from './index';

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
