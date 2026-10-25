/**
 * Refresh the persisted GHCR tag lists so every e2e run starts from a warm oracle cache.
 *
 * Run by the scheduled CI warm-up: ORACLE_TAG_CACHE_DIR=<dir> npm run oracle:warmup
 */
import registryOracle, { errorMessage, listCachedGhcrImages } from './registry_oracle';

// Only needed for a cold start; anything else the suite caches is picked up from the cache itself.
const SEED_IMAGES = ['linuxserver/radarr', 'stefanprodan/podinfo'];

async function main(): Promise<void> {
    if (!process.env.ORACLE_TAG_CACHE_DIR) {
        throw new Error('ORACLE_TAG_CACHE_DIR must be set; without it there is nothing to warm');
    }
    const images = [...new Set([...SEED_IMAGES, ...listCachedGhcrImages()])].sort();
    let failed = 0;
    // eslint-disable-next-line no-restricted-syntax -- sequential keeps GHCR load minimal
    for (const image of images) {
        try {
            // eslint-disable-next-line no-await-in-loop -- sequential keeps GHCR load minimal
            await registryOracle.getLatestVersion('ghcr.public', image, '.*');
            console.log(`[warmup] ${image}: tag cache refreshed`);
        } catch (e) {
            failed += 1;
            console.error(`[warmup] ${image}: ${errorMessage(e)}`);
        }
    }
    console.log(`[warmup] ${images.length - failed}/${images.length} GHCR tag lists refreshed`);
    if (failed > 0) {
        process.exitCode = 1;
    }
}

// cucumber's --require globs this directory, so importing must stay inert.
if (require.main === module) {
    main().catch((e) => {
        console.error(`oracle warm-up crashed: ${errorMessage(e)}`);
        process.exitCode = 1;
    });
}
