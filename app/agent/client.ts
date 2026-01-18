// @ts-nocheck
import axios from 'axios';
import https from 'https';
import fs from 'fs';
import logger from '../log';
import * as storeContainer from '../store/container';
import { getAgentConfigurations, isAgent } from '../configuration';
import { getRegistry, getTagCandidates, normalizeContainer } from '../watchers/providers/docker/Docker';

const log = logger.child({ component: 'agent-client' });

async function findNewVersion(container) {
    const result = { tag: container.image.tag.value };
    let registryProvider;
    try {
        registryProvider = getRegistry(container.image.registry.name);
    } catch (e) {
        log.warn(`Unsupported registry (${container.image.registry.name}) for container ${container.id}`);
        return result;
    }

    const tags = await registryProvider.getTags(container.image);
    const tagsCandidates = getTagCandidates(container, tags, log);

    if (container.image.digest.watch && container.image.digest.repo) {
        const imageToGetDigestFrom = JSON.parse(JSON.stringify(container.image));
        if (tagsCandidates.length > 0) {
            [imageToGetDigestFrom.tag.value] = tagsCandidates;
        }
        const remoteDigest = await registryProvider.getImageManifestDigest(imageToGetDigestFrom);
        result.digest = remoteDigest.digest;
        result.created = remoteDigest.created;

        if (remoteDigest.version === 2) {
            const digestV2 = await registryProvider.getImageManifestDigest(imageToGetDigestFrom, container.image.digest.repo);
            container.image.digest.value = digestV2.digest;
        }
    }

    if (tagsCandidates && tagsCandidates.length > 0) {
        [result.tag] = tagsCandidates;
    }
    return result;
}

class AgentClient {
    constructor(name, config) {
        this.name = name;
        this.config = config;

        const isHttps = !!(config.cafile || config.certfile || config.keyfile);
        this.baseUrl = `${isHttps ? 'https' : 'http'}://${config.host}:${config.port || 3000}/api`;

        const agentOptions = {
            rejectUnauthorized: false,
        };
        if (config.cafile) agentOptions.ca = fs.readFileSync(config.cafile);
        if (config.certfile) agentOptions.cert = fs.readFileSync(config.certfile);
        if (config.keyfile) agentOptions.key = fs.readFileSync(config.keyfile);

        this.axiosConfig = {
            headers: {
                'X-Wud-Agent-Secret': config.secret || (config.secret_file ? fs.readFileSync(config.secret_file, 'utf8').trim() : ''),
            },
            httpsAgent: isHttps ? new https.Agent(agentOptions) : undefined
        };
        this.connected = false;
        this.watchers = [];
    }

    async init() {
        log.info(`Initializing Agent Client [${this.name}]`);
        this.sync();
    }

    async sync() {
        try {
            // Snapshot Containers
            log.debug(`Fetching snapshot from Agent [${this.name}]`);
            const response = await axios.get(`${this.baseUrl}/containers`, this.axiosConfig);
            const containers = response.data;
            log.info(`Fetched ${containers.length} containers from Agent [${this.name}]`);

            // Process containers
            await Promise.all(containers.map(c => this.processContainer(c)));

            // Snapshot Watchers
            try {
                const responseWatchers = await axios.get(`${this.baseUrl}/watchers`, this.axiosConfig);
                this.watchers = responseWatchers.data.map(w => ({
                    ...w,
                    agent: this.name,
                }));
            } catch (e) {
                log.warn(`Failed to sync watchers from Agent [${this.name}]: ${e.message}`);
            }

            this.connected = true;
            // Start SSE
            this.startSSE();
        } catch (e) {
            this.connected = false;
            log.error(`Failed to sync with Agent [${this.name}]: ${e.message}`);
            setTimeout(() => this.sync(), 10000);
        }
    }

    async startSSE() {
        log.info(`Starting SSE connection to Agent [${this.name}]`);
        try {
            const response = await axios.get(`${this.baseUrl}/events`, {
                ...this.axiosConfig,
                responseType: 'stream',
                timeout: 0
            });
            const stream = response.data;
            stream.on('data', chunk => {
                const lines = chunk.toString().split('\n');
                lines.forEach(line => {
                    if (line.startsWith('data: ')) {
                        try {
                            const payload = JSON.parse(line.substring(6));
                            this.handleEvent(payload);
                        } catch (e) {
                            // ignore
                        }
                    }
                });
            });
            stream.on('end', () => {
                this.connected = false;
                log.warn(`SSE stream ended for Agent [${this.name}]. Reconnecting...`);
                setTimeout(() => this.startSSE(), 5000);
            });
            stream.on('error', (e) => {
                this.connected = false;
                log.error(`SSE stream error for Agent [${this.name}]: ${e.message}`);
            });
        } catch (e) {
             this.connected = false;
             log.error(`Failed to start SSE for Agent [${this.name}]: ${e.message}`);
             setTimeout(() => this.startSSE(), 10000);
        }
    }

    handleEvent(payload) {
        const { type, data } = payload;
        if (type === 'removed') {
            this.processRemove(data);
        } else if (type === 'added' || type === 'updated') {
            this.processContainer(data);
        }
    }

    async processContainer(container) {
        const originalId = container.id;
        container.id = `${this.name}:${originalId}`;
        container.agent = this.name;

        // Re-normalize to attach local Registry Provider
        try {
            container = normalizeContainer(container);
        } catch (e) {
             // If local registry doesn't match, it stays unknown.
        }

        // Find New Version (using local registries)
        try {
            container.result = await findNewVersion(container);
        } catch (e) {
            log.warn(`Error checking version for remote container ${container.id}: ${e.message}`);
        }

        const containerInDb = storeContainer.getContainer(container.id);
        if (!containerInDb) {
            storeContainer.insertContainer(container);
        } else {
            storeContainer.updateContainer(container);
        }
    }

    processRemove(container) {
        const id = `${this.name}:${container.id}`;
        storeContainer.deleteContainer(id);
    }

    async runTrigger(containerId, type, name) {
        // containerId is namespaced
        const realId = containerId.split(':')[1];
        await axios.post(`${this.baseUrl}/triggers/${type}/${name}/${realId}`, {}, this.axiosConfig);
    }
}

let clients = [];

export async function init() {
    if (isAgent()) return;
    const configs = getAgentConfigurations();
    Object.keys(configs).forEach(name => {
        const client = new AgentClient(name, configs[name]);
        clients.push(client);
        client.init();
    });
}

export function getClient(name) {
    return clients.find(c => c.name === name);
}

export function getClients() {
    return clients;
}

export function getRemoteWatchers() {
    return clients.reduce((acc, client) => [...acc, ...client.watchers], []);
}
