import * as postupdate from './postupdate';

test('postupdate bounce counter should be properly configured', async () => {
    postupdate.init();
    const counter = postupdate.getPostupdateBounceCounter();
    expect(counter).toBeDefined();
    const metric = await counter!.get();
    expect(metric.name).toStrictEqual('wud_postupdate_bounce_count');
    expect(metric.help).toStrictEqual(
        'Total count of post-update dependent bounce outcomes',
    );
});

test('postupdate bounce counter should expose type/name/status labels', async () => {
    postupdate.init();
    const counter = postupdate.getPostupdateBounceCounter();
    counter!.inc({ type: 'docker', name: 'local', status: 'bounced' });
    const metric = await counter!.get();
    expect(metric.values).toHaveLength(1);
    expect(metric.values[0].labels).toStrictEqual({
        type: 'docker',
        name: 'local',
        status: 'bounced',
    });
});

test('postupdate init should be idempotent', async () => {
    postupdate.init();
    expect(() => postupdate.init()).not.toThrow();
    expect(postupdate.getPostupdateBounceCounter()).toBeDefined();
});
