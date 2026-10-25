import { formatRecord, PrettyStream } from './pretty';

const baseRecord = () => ({
    name: 'whats-up-docker',
    hostname: 'host',
    pid: 42,
    level: 30,
    time: new Date('2026-10-24T10:00:00.123Z'),
    v: 0,
    msg: 'Server listening',
});

const withoutTime = (line: string) => line.replace(/^\[[^\]]+\]/, '[T]');

describe('formatRecord', () => {
    test('should render a single-line record like bunyan -o long', () => {
        expect(withoutTime(formatRecord(baseRecord()))).toEqual(
            '[T]  INFO: whats-up-docker/42 on host: Server listening\n',
        );
    });

    test('should render the time as local ISO 8601 with an offset', () => {
        const [, time] = formatRecord(baseRecord()).match(/^\[([^\]]+)\]/)!;
        expect(time).toMatch(
            /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}[+-]\d\d:\d\d$/,
        );
        expect(new Date(time).getTime()).toEqual(
            Date.parse('2026-10-24T10:00:00.123Z'),
        );
    });

    test('should accept a string time', () => {
        const [, time] = formatRecord({
            ...baseRecord(),
            time: '2026-10-24T10:00:00.123Z',
        }).match(/^\[([^\]]+)\]/)!;
        expect(new Date(time).getTime()).toEqual(
            Date.parse('2026-10-24T10:00:00.123Z'),
        );
    });

    test('should pad four-letter level names', () => {
        expect(
            withoutTime(formatRecord({ ...baseRecord(), level: 40 })),
        ).toMatch(/^\[T\] {2}WARN: /);
        expect(
            withoutTime(formatRecord({ ...baseRecord(), level: 20 })),
        ).toMatch(/^\[T\] DEBUG: /);
    });

    test('should append the component to the name', () => {
        expect(
            withoutTime(formatRecord({ ...baseRecord(), component: 'store' })),
        ).toEqual(
            '[T]  INFO: whats-up-docker/store/42 on host: Server listening\n',
        );
    });

    test('should render short extra fields inline', () => {
        expect(
            withoutTime(
                formatRecord({
                    ...baseRecord(),
                    container: 'nginx',
                    label: 'two words',
                    count: 3,
                }),
            ),
        ).toEqual(
            '[T]  INFO: whats-up-docker/42 on host: Server listening (container=nginx, label="two words", count=3)\n',
        );
    });

    test('should render long and multi-line extra fields as details', () => {
        const long = 'x'.repeat(51);
        expect(
            withoutTime(
                formatRecord({
                    ...baseRecord(),
                    long,
                    obj: { a: 1 },
                }),
            ),
        ).toEqual(
            `[T]  INFO: whats-up-docker/42 on host: Server listening\n    long: ${long}\n    --\n    obj: {\n      "a": 1\n    }\n`,
        );
    });

    test('should move a multi-line message into the details', () => {
        expect(
            withoutTime(formatRecord({ ...baseRecord(), msg: 'one\ntwo' })),
        ).toEqual('[T]  INFO: whats-up-docker/42 on host:\n    one\n    two\n');
    });

    test('should render an error stack as details', () => {
        const err = new Error('boom');
        err.stack = 'Error: boom\n    at here';
        expect(
            withoutTime(formatRecord({ ...baseRecord(), msg: 'Failed', err })),
        ).toEqual(
            '[T]  INFO: whats-up-docker/42 on host: Failed\n    Error: boom\n        at here\n',
        );
    });

    test('should not mutate the record', () => {
        const record = { ...baseRecord(), component: 'store', extra: 'a' };
        const copy = { ...record };
        formatRecord(record);
        expect(record).toEqual(copy);
    });
});

describe('PrettyStream', () => {
    test('should write formatted records to its output', () => {
        const output = { write: jest.fn() };
        new PrettyStream(output).write(baseRecord());
        expect(output.write).toHaveBeenCalledTimes(1);
        expect(withoutTime(output.write.mock.calls[0][0])).toEqual(
            '[T]  INFO: whats-up-docker/42 on host: Server listening\n',
        );
    });
});
