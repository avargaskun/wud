import * as pull from './pull';

test('pull retry counter should be properly configured', async () => {
    pull.init();
    const counter = pull.getPullRetryCounter();
    expect(counter).toBeDefined();
    const metric = await counter!.get();
    expect(metric.name).toStrictEqual('wud_trigger_pull_retry_count');
    expect(metric.help).toStrictEqual(
        'Total count of image pulls retried after a throttled or transient response',
    );
});

test('pull retry counter should expose type/name/status labels', async () => {
    pull.init();
    const counter = pull.getPullRetryCounter();
    counter!.inc({ type: 'dockercompose', name: 'default', status: '429' });
    const metric = await counter!.get();
    expect(metric.values).toHaveLength(1);
    expect(metric.values[0].labels).toStrictEqual({
        type: 'dockercompose',
        name: 'default',
        status: '429',
    });
});

test('pull init should replace the counter when called again', () => {
    pull.init();
    const first = pull.getPullRetryCounter();
    expect(() => pull.init()).not.toThrow();
    expect(pull.getPullRetryCounter()).not.toBe(first);
});
