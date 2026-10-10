import type Dockerode from 'dockerode';
import type Logger from 'bunyan';
import { PullError } from './errors';

const mockInc = jest.fn();
const mockRecordRetry = jest.fn();

jest.mock('../../../prometheus/pull', () => ({
    getPullRetryCounter: () => ({ inc: mockInc }),
}));

jest.mock('../../../registries/retryStats', () => ({
    recordRetry: () => mockRecordRetry(),
    getRetryCount: () => 0,
}));

jest.mock('../../../registry', () => ({
    getState: () => ({ watcher: {}, registry: {} }),
}));

import Docker from './Docker';

type FollowProgressCallback = (err: Error | null, output?: unknown[]) => void;

class TestDocker extends Docker {
    readonly sleeps: number[] = [];

    constructor() {
        super();
        this.type = 'dockercompose';
        this.name = 'default';
    }

    protected async sleep(ms: number): Promise<void> {
        this.sleeps.push(ms);
    }
}

const IMAGE = 'ghcr.io/immich-app/immich-machine-learning:v3.3.1-openvino';
const GHCR_429 =
    'toomanyrequests: retry-after: 306.189µs, allowed: 44000/minute';

const dockerodeError = (statusCode: number, message: string) =>
    Object.assign(
        new Error(`(HTTP code ${statusCode}) unexpected - ${message} `),
        { statusCode, reason: 'unexpected', json: { message } },
    );

const fakeDockerApi = (
    pull: jest.Mock,
    finish: (callback: FollowProgressCallback) => void = (callback) =>
        callback(null, []),
): Dockerode =>
    ({
        pull,
        modem: {
            followProgress: (
                _stream: unknown,
                callback: FollowProgressCallback,
            ) => finish(callback),
        },
    }) as unknown as Dockerode;

const fakeLog = () => {
    const calls = { info: jest.fn(), warn: jest.fn(), debug: jest.fn() };
    return { calls, logger: calls as unknown as Logger };
};

beforeEach(() => {
    jest.clearAllMocks();
});

describe('pullImage', () => {
    test('should log success when the stream ends cleanly', async () => {
        const docker = new TestDocker();
        const pull = jest.fn().mockResolvedValue({});
        const { calls, logger } = fakeLog();
        await expect(
            docker.pullImage(fakeDockerApi(pull), undefined, IMAGE, logger),
        ).resolves.toBeUndefined();
        expect(pull).toHaveBeenCalledWith(IMAGE, { authconfig: undefined });
        expect(calls.info).toHaveBeenCalledWith(
            `Image ${IMAGE} pulled with success`,
        );
        expect(calls.warn).not.toHaveBeenCalled();
        expect(docker.sleeps).toEqual([]);
    });

    test('should tolerate a callback without output', async () => {
        const docker = new TestDocker();
        const pull = jest.fn().mockResolvedValue({});
        const { logger } = fakeLog();
        await expect(
            docker.pullImage(
                fakeDockerApi(pull, (callback) => callback(null)),
                undefined,
                IMAGE,
                logger,
            ),
        ).resolves.toBeUndefined();
    });

    test('should reject when the progress stream errors', async () => {
        const docker = new TestDocker();
        const pull = jest.fn().mockResolvedValue({});
        const { calls, logger } = fakeLog();
        await expect(
            docker.pullImage(
                fakeDockerApi(pull, (callback) =>
                    callback(new Error('socket hang up'), []),
                ),
                undefined,
                IMAGE,
                logger,
            ),
        ).rejects.toThrow('socket hang up');
        expect(calls.info).not.toHaveBeenCalledWith(
            `Image ${IMAGE} pulled with success`,
        );
        expect(calls.warn).toHaveBeenCalledTimes(1);
        expect(pull).toHaveBeenCalledTimes(1);
    });

    test('should reject with a PullError when the output carries an error line', async () => {
        const docker = new TestDocker();
        const pull = jest.fn().mockResolvedValue({});
        const { calls, logger } = fakeLog();
        const message =
            'write /var/lib/docker/tmp/GetImageBlob: no space left on device';
        const promise = docker.pullImage(
            fakeDockerApi(pull, (callback) =>
                callback(null, [
                    { status: 'Downloading' },
                    { error: message, errorDetail: { message } },
                ]),
            ),
            undefined,
            IMAGE,
            logger,
        );
        await expect(promise).rejects.toBeInstanceOf(PullError);
        await expect(promise).rejects.toThrow(message);
        expect(calls.info).not.toHaveBeenCalledWith(
            `Image ${IMAGE} pulled with success`,
        );
        expect(calls.warn).toHaveBeenCalledWith(
            `Error when pulling image ${IMAGE} (${message})`,
        );
        expect(pull).toHaveBeenCalledTimes(1);
    });

    test('should retry a throttled pull and resolve without warning', async () => {
        const docker = new TestDocker();
        const pull = jest
            .fn()
            .mockRejectedValueOnce(dockerodeError(429, GHCR_429))
            .mockResolvedValue({});
        const { calls, logger } = fakeLog();
        await expect(
            docker.pullImage(fakeDockerApi(pull), undefined, IMAGE, logger),
        ).resolves.toBeUndefined();
        expect(pull).toHaveBeenCalledTimes(2);
        expect(docker.sleeps).toHaveLength(1);
        expect(docker.sleeps[0]).toBeGreaterThanOrEqual(250);
        expect(docker.sleeps[0]).toBeLessThan(500);
        expect(calls.warn).not.toHaveBeenCalled();
        expect(calls.debug).toHaveBeenCalledWith(
            expect.stringMatching(
                /^Retrying in \d+ ms \(attempt 2\/4, status 429, hint 0\.3061\d* ms from message\)$/,
            ),
        );
        expect(mockInc).toHaveBeenCalledTimes(1);
        expect(mockInc).toHaveBeenCalledWith({
            type: 'dockercompose',
            name: 'default',
            status: '429',
        });
        expect(mockRecordRetry).not.toHaveBeenCalled();
    });

    test('should retry a throttled progress-stream line', async () => {
        const docker = new TestDocker();
        const pull = jest.fn().mockResolvedValue({});
        const { logger } = fakeLog();
        let calls = 0;
        await expect(
            docker.pullImage(
                fakeDockerApi(pull, (callback) => {
                    calls += 1;
                    callback(
                        null,
                        calls === 1
                            ? [
                                  {
                                      error: GHCR_429,
                                      errorDetail: { message: GHCR_429 },
                                  },
                              ]
                            : [],
                    );
                }),
                undefined,
                IMAGE,
                logger,
            ),
        ).resolves.toBeUndefined();
        expect(pull).toHaveBeenCalledTimes(2);
        expect(docker.sleeps).toHaveLength(1);
    });

    test('should fail on the first attempt for a non-retryable error', async () => {
        const docker = new TestDocker();
        const error = dockerodeError(
            401,
            'unauthorized: authentication required',
        );
        const pull = jest.fn().mockRejectedValue(error);
        const { calls, logger } = fakeLog();
        await expect(
            docker.pullImage(fakeDockerApi(pull), undefined, IMAGE, logger),
        ).rejects.toBe(error);
        expect(pull).toHaveBeenCalledTimes(1);
        expect(docker.sleeps).toEqual([]);
        expect(calls.warn).toHaveBeenCalledTimes(1);
        expect(calls.warn).toHaveBeenCalledWith(
            `Error when pulling image ${IMAGE} (${error.message})`,
        );
        expect(mockInc).not.toHaveBeenCalled();
    });

    test('should give up after four attempts', async () => {
        const docker = new TestDocker();
        const pull = jest.fn().mockRejectedValue(dockerodeError(429, GHCR_429));
        const { calls, logger } = fakeLog();
        await expect(
            docker.pullImage(fakeDockerApi(pull), undefined, IMAGE, logger),
        ).rejects.toThrow('toomanyrequests');
        expect(pull).toHaveBeenCalledTimes(4);
        expect(docker.sleeps).toHaveLength(3);
        expect(calls.warn).toHaveBeenCalledTimes(1);
        expect(mockInc).toHaveBeenCalledTimes(3);
    });
});
