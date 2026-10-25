import bunyan from 'bunyan';
import { AxiosError } from 'axios';
import { getLogFormat, getLogLevel } from '../configuration';
import { PrettyStream } from './pretty';

// Init Bunyan logger
const logger = bunyan.createLogger({
    name: 'whats-up-docker',
    streams: [
        getLogFormat() === 'json'
            ? { level: getLogLevel(), stream: process.stdout }
            : { level: getLogLevel(), type: 'raw', stream: new PrettyStream() },
    ],
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
