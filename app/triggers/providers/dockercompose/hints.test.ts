import { collectComposeHints } from './hints';
import { emptyHints } from '../docker/config';

describe('collectComposeHints', () => {
    describe('environment', () => {
        test('should collect every key of the map form', () => {
            const hints = collectComposeHints({
                environment: { PUID: '1000', PGID: null, TZ: 'UTC' },
            });
            expect([...hints.envKeys].sort()).toEqual(['PGID', 'PUID', 'TZ']);
        });

        test('should collect the key before the first equals sign of the list form', () => {
            const hints = collectComposeHints({
                environment: ['PUID=1000', 'FROM_HOST', 'URL=a=b=c'],
            });
            expect([...hints.envKeys].sort()).toEqual([
                'FROM_HOST',
                'PUID',
                'URL',
            ]);
        });

        test('should ignore non string items of the list form', () => {
            const hints = collectComposeHints({
                environment: ['PUID=1000', 42, null, { PGID: '1000' }],
            });
            expect([...hints.envKeys]).toEqual(['PUID']);
        });

        test('should collect nothing when absent', () => {
            expect(collectComposeHints({}).envKeys.size).toEqual(0);
        });
    });

    describe('labels', () => {
        test('should collect every key of the map form', () => {
            const hints = collectComposeHints({
                labels: { 'wud.tag.include': '^\\d+$', 'my.label': 'x' },
            });
            expect([...hints.labelKeys].sort()).toEqual([
                'my.label',
                'wud.tag.include',
            ]);
        });

        test('should collect the key before the first equals sign of the list form', () => {
            const hints = collectComposeHints({
                labels: ['org.opencontainers.image.version=5.0.0', 'bare'],
            });
            expect([...hints.labelKeys].sort()).toEqual([
                'bare',
                'org.opencontainers.image.version',
            ]);
        });

        test('should not mix label keys into env keys', () => {
            const hints = collectComposeHints({
                environment: ['PUID=1000'],
                labels: ['my.label=x'],
            });
            expect([...hints.envKeys]).toEqual(['PUID']);
            expect([...hints.labelKeys]).toEqual(['my.label']);
        });
    });

    describe('presence fields', () => {
        test.each([
            ['command', 'Cmd'],
            ['entrypoint', 'Entrypoint'],
            ['user', 'User'],
            ['working_dir', 'WorkingDir'],
            ['stop_signal', 'StopSignal'],
            ['hostname', 'Hostname'],
        ])('should map %s to %s', (key, field) => {
            const hints = collectComposeHints({ [key]: 'value' });
            expect([...hints.fields]).toEqual([field]);
        });

        test.each([
            ['a string', './podinfo --port=9898'],
            ['a list', ['./podinfo', '--port=9898']],
            ['an empty list', []],
        ])('should map a command given as %s to Cmd', (_label, command) => {
            const hints = collectComposeHints({ command });
            expect(hints.fields.has('Cmd')).toEqual(true);
        });

        test.each([
            'command',
            'entrypoint',
            'user',
            'working_dir',
            'stop_signal',
            'hostname',
        ])('should collect nothing for a null %s', (key) => {
            expect(collectComposeHints({ [key]: null }).fields.size).toEqual(0);
        });
    });

    describe('expose', () => {
        test('should map a non empty list to ExposedPorts', () => {
            const hints = collectComposeHints({ expose: ['9898'] });
            expect([...hints.fields]).toEqual(['ExposedPorts']);
        });

        test('should collect nothing for an empty list', () => {
            expect(collectComposeHints({ expose: [] }).fields.size).toEqual(0);
        });

        test('should collect nothing when not a list', () => {
            expect(collectComposeHints({ expose: '9898' }).fields.size).toEqual(
                0,
            );
        });
    });

    describe('healthcheck', () => {
        test.each([
            ['test', 'Test'],
            ['interval', 'Interval'],
            ['timeout', 'Timeout'],
            ['retries', 'Retries'],
            ['start_period', 'StartPeriod'],
            ['start_interval', 'StartInterval'],
        ])('should map %s to %s', (key, field) => {
            const hints = collectComposeHints({ healthcheck: { [key]: '1s' } });
            expect([...hints.healthcheck]).toEqual([field]);
        });

        test('should map disable true to Test', () => {
            const hints = collectComposeHints({
                healthcheck: { disable: true },
            });
            expect([...hints.healthcheck]).toEqual(['Test']);
        });

        test('should collect nothing for disable false', () => {
            const hints = collectComposeHints({
                healthcheck: { disable: false },
            });
            expect(hints.healthcheck.size).toEqual(0);
        });

        test('should collect only the sub keys actually present', () => {
            const hints = collectComposeHints({
                healthcheck: { test: ['CMD', 'curl', '-f', '/'], retries: 3 },
            });
            expect([...hints.healthcheck].sort()).toEqual(['Retries', 'Test']);
        });

        test('should collect nothing when not a map', () => {
            expect(
                collectComposeHints({ healthcheck: ['CMD'] }).healthcheck.size,
            ).toEqual(0);
        });
    });

    describe('ignored keys', () => {
        test('should collect nothing for ports, env_file and extends', () => {
            const hints = collectComposeHints({
                ports: ['9898:9898'],
                env_file: ['.env'],
                extends: { file: 'base.yml', service: 'app' },
                image: 'ghcr.io/stefanprodan/podinfo:5.0.0',
            });
            expect(hints).toEqual(emptyHints());
        });
    });

    describe('unusable input', () => {
        test.each([
            ['undefined', undefined],
            ['null', null],
            ['a string', 'service'],
            ['a number', 42],
            ['a list', ['service']],
        ])('should yield empty hints for %s', (_label, service) => {
            expect(collectComposeHints(service)).toEqual(emptyHints());
        });
    });

    test('should collect every category at once', () => {
        const hints = collectComposeHints({
            environment: ['PUID=1000'],
            labels: { 'my.label': 'x' },
            command: ['./podinfo'],
            expose: ['9898'],
            healthcheck: { interval: '30s' },
        });
        expect([...hints.envKeys]).toEqual(['PUID']);
        expect([...hints.labelKeys]).toEqual(['my.label']);
        expect([...hints.fields].sort()).toEqual(['Cmd', 'ExposedPorts']);
        expect([...hints.healthcheck]).toEqual(['Interval']);
    });
});
