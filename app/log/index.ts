// @ts-nocheck
import bunyan from 'bunyan';
import { AxiosInstance } from 'axios';
import { getLogLevel } from '../configuration';

// Init Bunyan logger
const logger = bunyan.createLogger({
    name: 'whats-up-docker',
    level: getLogLevel(),
});

export const registerAxiosErrorLogging = (
    axiosInstance: AxiosInstance,
    getLog?: () => bunyan = () => logger,
) => {
    axiosInstance.interceptors.response.use(
        (response) => response,
        (error) => {
            if (error.response) {
                const log = getLog();
                const status = error.response.status;
                if (status >= 400) {
                    log.warn(
                        `Request failed with status code [${status}] on [${error.config.method} ${error.config.url}]`,
                    );
                    log.warn(
                        `Request headers [${JSON.stringify(error.config.headers)}]`,
                    );
                    log.warn(
                        `Response body [${JSON.stringify(error.response.data)}]`,
                    );
                }
            }
            return Promise.reject(error);
        },
    );
};

export default logger;
