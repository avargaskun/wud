import fs from 'fs';
import path from 'path';
import express from 'express';
import { getServerConfiguration } from '../configuration';

const indexHtmlPath = path.join(__dirname, '..', '..', 'ui', 'index.html');

function serveIndex(res: express.Response) {
    const basePath = getServerConfiguration().basepath;
    // <base> makes the relative publicPath assets (including async chunks) resolve from the basepath at any route depth
    const baseHref = basePath.endsWith('/') ? basePath : `${basePath}/`;
    const html = fs.readFileSync(indexHtmlPath, 'utf-8');
    const injected = html
        .replace('<head>', `<head><base href="${baseHref}">`)
        .replace(
            '<div id="app">',
            `<script>window.__WUD_BASE_PATH__='${basePath}'</script><div id="app">`,
        );
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Cache-Control', 'no-store');
    res.send(injected);
}

/**
 * Init the UI router.
 * @returns {*|Router}
 */
export function init() {
    const router = express.Router();
    router.use(
        express.static(path.join(__dirname, '..', '..', 'ui'), {
            index: false,
        }),
    );

    // Redirect all 404 to index.html (for vue history mode)
    router.get('*', (req, res) => {
        serveIndex(res);
    });
    return router;
}
