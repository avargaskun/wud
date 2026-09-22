import bunyan from 'bunyan';
import { AxiosError } from 'axios';
import { getLogLevel } from '../configuration';

// Init Bunyan logger
const logger = bunyan.createLogger({
    name: 'whats-up-docker',
    level: getLogLevel(),
});

export const logAxiosError = (
    log: bunyan,
    error: unknown,
    level: 'warn' | 'debug',
): void => {
    const { response, config } = (error ?? {}) as Partial<AxiosError>;
    if (!response || response.status < 400) {
        return;
    }
    log[level](
        `Request failed with status code [${response.status}] on [${config?.method} ${config?.url}]`,
    );
    log[level](`Request headers [${JSON.stringify(config?.headers)}]`);
    log[level](`Response body [${JSON.stringify(response.data)}]`);
};

export default logger;
