const LEVEL_NAMES: Record<number, string> = {
    10: 'TRACE',
    20: 'DEBUG',
    30: ' INFO',
    40: ' WARN',
    50: 'ERROR',
    60: 'FATAL',
};

const FORMATTED_FIELDS = new Set([
    'name',
    'hostname',
    'pid',
    'level',
    'time',
    'v',
    'msg',
    'component',
]);

export interface LogRecord {
    name: string;
    hostname: string;
    pid: number;
    level: number;
    time: Date | string;
    msg: string;
    component?: string;
    err?: { stack?: string };
    [key: string]: unknown;
}

interface Writable {
    write(chunk: string): unknown;
}

const pad = (value: number, length = 2) => String(value).padStart(length, '0');

function toLocalIsoString(date: Date): string {
    const offset = -date.getTimezoneOffset();
    const sign = offset >= 0 ? '+' : '-';
    const absOffset = Math.abs(offset);
    return (
        `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
        `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
        `.${pad(date.getMilliseconds(), 3)}` +
        `${sign}${pad(Math.floor(absOffset / 60))}:${pad(absOffset % 60)}`
    );
}

const indent = (text: string) => `    ${text.split(/\r?\n/).join('\n    ')}`;

/**
 * Render a bunyan record the way `bunyan -L -o long` does.
 */
export function formatRecord(record: LogRecord): string {
    const time = toLocalIsoString(new Date(record.time));
    const level = LEVEL_NAMES[record.level] || `LVL${record.level}`;
    const name = [record.name, record.component, record.pid]
        .filter((part) => part !== undefined)
        .join('/');

    const extras: string[] = [];
    const details: string[] = [];

    let onelineMsg = ` ${record.msg}`;
    if (record.msg.includes('\n')) {
        onelineMsg = '';
        details.push(indent(record.msg));
    }

    const hasStack = Boolean(record.err?.stack);
    if (hasStack) {
        details.push(indent(String(record.err.stack)));
    }

    Object.entries(record)
        .filter(([key]) => !FORMATTED_FIELDS.has(key))
        .filter(([key]) => !(key === 'err' && hasStack))
        .forEach(([key, rawValue]) => {
            const stringified = typeof rawValue !== 'string';
            const value = stringified
                ? String(JSON.stringify(rawValue, null, 2))
                : (rawValue as string);
            if (value.includes('\n') || value.length > 50) {
                details.push(indent(`${key}: ${value}`));
            } else if (
                !stringified &&
                (value.includes(' ') || value.length === 0)
            ) {
                extras.push(`${key}=${JSON.stringify(value)}`);
            } else {
                extras.push(`${key}=${value}`);
            }
        });

    const extrasStr = extras.length ? ` (${extras.join(', ')})` : '';
    const detailsStr = details.length ? `${details.join('\n    --\n')}\n` : '';
    return `[${time}] ${level}: ${name} on ${record.hostname}:${onelineMsg}${extrasStr}\n${detailsStr}`;
}

/**
 * Bunyan raw stream printing human-readable records.
 */
export class PrettyStream {
    constructor(private readonly output: Writable = process.stdout) {}

    write(record: LogRecord): void {
        this.output.write(formatRecord(record));
    }
}
