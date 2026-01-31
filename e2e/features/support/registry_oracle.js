const https = require('https');
const semver = require('semver');

/**
 * Perform an HTTPS GET request and return the body as a string.
 */
function fetch(url, options = {}) {
    return new Promise((resolve, reject) => {
        https.get(url, options, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(data);
                } else {
                    reject(new Error(`Status: ${res.statusCode}, Body: ${data}`));
                }
            });
        }).on('error', (err) => {
            reject(err);
        });
    });
}

/**
 * Registry Oracle for fetching latest tags and digests.
 */
const registryOracle = {
    /**
     * Get the latest version for an image.
     */
    async getLatestVersion(registry, image, pattern = '.*') {
        if (registry === 'ecr.private') {
            return '2.0.0';
        }

        const regex = new RegExp(pattern);
        let tags = [];

        try {
            if (registry === 'hub.public') {
                const url = `https://hub.docker.com/v2/repositories/${image.includes('/') ? image : `library/${image}`}/tags?page_size=100`;
                const data = JSON.parse(await fetch(url));
                tags = data.results.map(r => r.name);
            } else if (registry === 'ghcr.public' || registry === 'gitlab.private' || registry === 'lscr.private') {
                let url;
                let headers = {};

                if (registry === 'ghcr.public' || registry === 'lscr.private') {
                    const tokenUrl = `https://ghcr.io/token?scope=repository:${image}:pull`;
                    const tokenData = JSON.parse(await fetch(tokenUrl));
                    headers.Authorization = `Bearer ${tokenData.token}`;
                    url = `https://ghcr.io/v2/${image}/tags/list?n=1000`;
                } else if (registry === 'gitlab.private') {
                    const tokenUrl = `https://gitlab.com/jwt/auth?service=container_registry&scope=repository:${image}:pull`;
                    const tokenData = JSON.parse(await fetch(tokenUrl));
                    headers.Authorization = `Bearer ${tokenData.token}`;
                    url = `https://registry.gitlab.com/v2/${image}/tags/list?n=1000`;
                }

                // Simple loop for up to 50 pages if tags not found
                let page = 0;
                while (url && page < 50) {
                    const res = await new Promise((resolve, reject) => {
                        https.get(url, { headers }, (res) => {
                            let data = '';
                            res.on('data', (chunk) => data += chunk);
                            res.on('end', () => resolve({ data, headers: res.headers, statusCode: res.statusCode }));
                        }).on('error', reject);
                    });

                    if (res.statusCode !== 200) break;
                    const data = JSON.parse(res.data);
                    tags = tags.concat(data.tags);

                    // Check for next page in Link header
                    const link = res.headers.link;
                    if (link && link.includes('rel="next"')) {
                        const match = link.match(/<(.*)>; rel="next"/);
                        if (match) {
                            const nextUrl = match[1];
                            // Reconstruct full URL if relative
                            if (nextUrl.startsWith('/')) {
                                const base = url.split('/v2')[0];
                                url = `${base}${nextUrl}`;
                            } else {
                                url = nextUrl;
                            }
                        } else {
                            url = null;
                        }
                    } else {
                        url = null;
                    }
                    page++;
                }
            } else if (registry === 'quay.public') {
                let url = `https://quay.io/api/v1/repository/${image}/tag/?limit=100`;
                let page = 0;
                while (url && page < 50) {
                    const data = JSON.parse(await fetch(url));
                    tags = tags.concat(data.tags.map(t => t.name));
                    if (data.has_additional) {
                        url = `https://quay.io/api/v1/repository/${image}/tag/?limit=100&page=${page + 2}`;
                    } else {
                        url = null;
                    }
                    page++;
                }
            } else {
                throw new Error(`Unsupported registry: ${registry}`);
            }

            const filteredTags = tags.filter(t => regex.test(t));
            
            // Sort tags using semver
            const sortedTags = filteredTags.sort((a, b) => {
                const cleanA = semver.clean(a) || semver.coerce(a);
                const cleanB = semver.clean(b) || semver.coerce(b);
                
                if (!cleanA && !cleanB) return b.localeCompare(a);
                if (!cleanA) return 1;
                if (!cleanB) return -1;
                
                const cmp = semver.rcompare(cleanA, cleanB);
                if (cmp !== 0) return cmp;

                return b.localeCompare(a);
            });

            if (sortedTags.length === 0) {
                throw new Error(`No tags found matching pattern ${pattern} for ${image}`);
            }

            return sortedTags[0];
        } catch (e) {
            console.error(`Error fetching latest version for ${image} on ${registry}: ${e.message}`);
            throw e;
        }
    },

    /**
     * Get the latest digest for an image.
     */
    async getLatestDigest(registry, image, tag = 'latest') {
        try {
            if (registry === 'ghcr.public') {
                const tokenUrl = `https://ghcr.io/token?scope=repository:${image}:pull`;
                const tokenData = JSON.parse(await fetch(tokenUrl));
                const token = tokenData.token;

                const url = `https://ghcr.io/v2/${image}/manifests/${tag}`;
                const options = {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        Accept: 'application/vnd.docker.distribution.manifest.v2+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json'
                    }
                };
                const response = JSON.parse(await fetch(url, options));
                
                // If it's a manifest list / index, find the linux/amd64 manifest
                if (response.manifests) {
                    const manifest = response.manifests.find(m => 
                        m.platform && m.platform.architecture === 'amd64' && m.platform.os === 'linux'
                    );
                    if (manifest) {
                        return manifest.digest;
                    }
                }
                
                // Otherwise return the digest from the header or body (if it was a single manifest)
                // When we fetch the manifest, we can't easily get the digest from the body itself (it's the hash of the body)
                // So we do a HEAD request to get the docker-content-digest header
                return new Promise((resolve, reject) => {
                    const headOptions = { ...options, method: 'HEAD' };
                    const req = https.request(url, headOptions, (res) => {
                        if (res.headers['docker-content-digest']) {
                            resolve(res.headers['docker-content-digest']);
                        } else {
                            reject(new Error(`Digest header not found for ${image}:${tag}`));
                        }
                    });
                    req.on('error', reject);
                    req.end();
                });
            }
            throw new Error(`getLatestDigest not implemented for registry: ${registry}`);
        } catch (e) {
            console.error(`Error fetching latest digest for ${image}:${tag} on ${registry}: ${e.message}`);
            throw e;
        }
    }
};

module.exports = registryOracle;
