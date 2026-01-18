import axios from 'axios';
import https from 'https';
import logger from '../log';
import * as storeContainer from '../store/container';
import { findNewVersion } from '../watchers/providers/docker/utils';

export class AgentClient {
    name;
    config;
    log;
    baseUrl;
    axiosOptions;
    isConnected;
    watchers;

    constructor(name, config) {
        this.name = name;
        this.config = config;
        this.watchers = {};
        this.log = logger.child({ component: `agent-client.${name}` });
        this.baseUrl = `${this.config.host}:${this.config.port || 3000}`;
        // Add protocol if not present
        if (!this.baseUrl.startsWith('http')) {
             this.baseUrl = `http${this.config.certfile ? 's' : ''}://${this.baseUrl}`;
        }
        
        this.axiosOptions = {
            headers: {
                'X-Wud-Agent-Secret': this.config.secret,
            },
        };

        if (this.config.certfile) {
            this.axiosOptions.httpsAgent = new https.Agent({
                ca: this.config.cafile ? require('fs').readFileSync(this.config.cafile) : undefined,
                cert: this.config.certfile ? require('fs').readFileSync(this.config.certfile) : undefined,
                key: this.config.keyfile ? require('fs').readFileSync(this.config.keyfile) : undefined,
                rejectUnauthorized: false,
            });
        }
        
        this.isConnected = false;
    }

    async init() {
        this.log.info(`Connecting to agent ${this.name} at ${this.baseUrl}`);
        try {
            await this.handshake();
            this.startSse();
        } catch (e) {
            this.log.error(`Failed to connect to agent: ${e.message}`);
            setTimeout(() => this.init(), 5000);
        }
    }

    async handshake() {
        const response = await axios.get(`${this.baseUrl}/api/containers`, this.axiosOptions);
        const containers = response.data;
        this.log.info(`Handshake successful. Received ${containers.length} containers.`);
        
        for (const container of containers) {
            await this.processContainer(container);
        }

        try {
            const responseWatchers = await axios.get(`${this.baseUrl}/api/watchers`, this.axiosOptions);
            this.watchers = responseWatchers.data;
        } catch (e) {
            this.log.warn(`Failed to fetch watchers: ${e.message}`);
        }

        this.isConnected = true;
    }

    async processContainer(container) {
        container.agent = this.name;
        const logContainer = this.log.child({ container: container.name });
        
        try {
            // Check for updates using local Registry logic
            // Pass null as dockerApi because we can't check legacy v1 digests remotely easily
            const result = await findNewVersion(container, null, logContainer);
            container.result = result;
        } catch (e) {
            this.log.warn(`Error checking update for ${container.name}: ${e.message}`);
            container.error = { message: e.message };
        }

        // Save to store
        const existing = storeContainer.getContainer(container.id);
        
        if (!existing) {
            storeContainer.insertContainer(container);
        } else {
            storeContainer.updateContainer(container);
        }
    }

    startSse() {
        axios({
            method: 'get',
            url: `${this.baseUrl}/api/events`,
            responseType: 'stream',
            ...this.axiosOptions
        }).then(response => {
            const stream = response.data;
            stream.on('data', (chunk) => {
                const lines = chunk.toString().split('\n');
                let eventName = null;
                for (const line of lines) {
                    if (line.startsWith('event: ')) {
                        eventName = line.substring(7).trim();
                    } else if (line.startsWith('data: ') && eventName) {
                        try {
                            const data = JSON.parse(line.substring(6));
                            this.handleEvent(eventName, data);
                        } catch (e) {
                            this.log.warn(`Error parsing SSE data: ${e.message}`);
                        }
                        eventName = null;
                    }
                }
            });
            stream.on('end', () => {
                this.log.warn('SSE stream ended. Reconnecting...');
                setTimeout(() => this.startSse(), 1000);
            });
        }).catch(e => {
            this.log.error(`SSE Connection failed: ${e.message}. Retrying...`);
            setTimeout(() => this.startSse(), 5000);
        });
    }

    async handleEvent(eventName, data) {
        if (eventName === 'wud:container-added' || eventName === 'wud:container-updated') {
            await this.processContainer(data);
        } else if (eventName === 'wud:container-removed') {
            storeContainer.deleteContainer(data.id);
        }
    }

    async runRemoteTrigger(containerId, triggerType, triggerName) {
        try {
            await axios.post(
                `${this.baseUrl}/api/containers/${containerId}/triggers/${triggerType}/${triggerName}`,
                {},
                this.axiosOptions
            );
        } catch (e) {
            this.log.error(`Error running remote trigger: ${e.message}`);
            throw e;
        }
    }
}
