import { emptyHints } from '../docker/config';
import type {
    HintedField,
    HintedHealthcheckField,
    UserConfigHints,
} from '../docker/config';

type UnknownRecord = Record<string, unknown>;

const PRESENCE_FIELDS: ReadonlyArray<[string, HintedField]> = [
    ['command', 'Cmd'],
    ['entrypoint', 'Entrypoint'],
    ['user', 'User'],
    ['working_dir', 'WorkingDir'],
    ['stop_signal', 'StopSignal'],
    ['hostname', 'Hostname'],
];

const HEALTHCHECK_FIELDS: ReadonlyArray<[string, HintedHealthcheckField]> = [
    ['test', 'Test'],
    ['interval', 'Interval'],
    ['timeout', 'Timeout'],
    ['retries', 'Retries'],
    ['start_period', 'StartPeriod'],
    ['start_interval', 'StartInterval'],
];

function asRecord(value: unknown): UnknownRecord | undefined {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return undefined;
    }
    return value as UnknownRecord;
}

function collectKeys(value: unknown, target: Set<string>): void {
    if (Array.isArray(value)) {
        value.forEach((item) => {
            if (typeof item === 'string') {
                const separator = item.indexOf('=');
                target.add(separator === -1 ? item : item.slice(0, separator));
            }
        });
        return;
    }
    const map = asRecord(value);
    if (map !== undefined) {
        Object.keys(map).forEach((key) => target.add(key));
    }
}

/** Keys a compose service declares for itself. Values are never read, so interpolation is irrelevant. */
export function collectComposeHints(service: unknown): UserConfigHints {
    const source = asRecord(service);
    if (source === undefined) {
        return emptyHints();
    }

    const envKeys = new Set<string>();
    const labelKeys = new Set<string>();
    const fields = new Set<HintedField>();
    const healthcheck = new Set<HintedHealthcheckField>();

    collectKeys(source.environment, envKeys);
    collectKeys(source.labels, labelKeys);

    PRESENCE_FIELDS.forEach(([key, field]) => {
        const value = source[key];
        if (value !== undefined && value !== null) {
            fields.add(field);
        }
    });

    if (Array.isArray(source.expose) && source.expose.length > 0) {
        fields.add('ExposedPorts');
    }

    const health = asRecord(source.healthcheck);
    if (health !== undefined) {
        HEALTHCHECK_FIELDS.forEach(([key, field]) => {
            if (health[key] !== undefined) {
                healthcheck.add(field);
            }
        });
        if (health.disable === true) {
            healthcheck.add('Test');
        }
    }

    return { envKeys, labelKeys, fields, healthcheck };
}
