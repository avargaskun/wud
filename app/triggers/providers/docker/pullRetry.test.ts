import { PullError } from './errors';
import { classifyPullError } from './pullRetry';

const GHCR_429 =
    'toomanyrequests: retry-after: 306.189µs, allowed: 44000/minute';
const IMAGE = 'ghcr.io/immich-app/immich-machine-learning:v3.3.1-openvino';

const dockerodeError = (
    statusCode: number,
    message: string,
    options: { withJson?: boolean } = {},
) =>
    Object.assign(
        new Error(`(HTTP code ${statusCode}) unexpected - ${message} `),
        {
            statusCode,
            reason: 'unexpected',
            json: options.withJson ? { message } : null,
        },
    );

describe('classifyPullError', () => {
    test('should classify a dockerode 429 with its in-message hint', () => {
        const decision = classifyPullError(dockerodeError(429, GHCR_429));
        expect(decision?.status).toBe(429);
        expect(decision?.hint?.source).toBe('message');
        expect(decision?.hint?.ms).toBeCloseTo(0.306189);
    });

    test('should read the hint from json.message when provided', () => {
        const decision = classifyPullError(
            dockerodeError(429, GHCR_429, { withJson: true }),
        );
        expect(decision?.hint?.ms).toBeCloseTo(0.306189);
    });

    test.each([502, 503, 504])('should classify a dockerode %i', (status) => {
        expect(
            classifyPullError(dockerodeError(status, 'bad gateway')),
        ).toEqual({ status, hint: undefined });
    });

    test('should classify a daemon 500 wrapping an upstream 503 by its text', () => {
        expect(
            classifyPullError(
                dockerodeError(
                    500,
                    'received unexpected HTTP status: 503 Service Unavailable',
                ),
            ),
        ).toEqual({ status: 503, hint: undefined });
    });

    test('should classify a daemon 500 wrapping a throttle as 429', () => {
        expect(classifyPullError(dockerodeError(500, GHCR_429))?.status).toBe(
            429,
        );
    });

    test('should classify a throttled progress-stream line', () => {
        const decision = classifyPullError(new PullError(IMAGE, GHCR_429));
        expect(decision?.status).toBe(429);
        expect(decision?.hint?.ms).toBeCloseTo(0.306189);
    });

    test('should classify a progress-stream line reporting an upstream 502', () => {
        expect(
            classifyPullError(
                new PullError(
                    IMAGE,
                    'received unexpected HTTP status: 502 Bad Gateway',
                ),
            )?.status,
        ).toBe(502);
    });

    test('should classify a daemon 500 wrapping a containerd-wording upstream 503', () => {
        expect(
            classifyPullError(
                dockerodeError(
                    500,
                    'unexpected status from HEAD request to https://ghcr.io/v2/immich-app/immich-server/manifests/v3.3.1: 503 Service Unavailable',
                ),
            ),
        ).toEqual({ status: 503, hint: undefined });
    });

    test('should classify a containerd-wording progress-stream line reporting an upstream 502', () => {
        expect(
            classifyPullError(
                new PullError(
                    IMAGE,
                    'unexpected status from GET request to https://ghcr.io/v2/x/blobs/sha256:abc: 502 Bad Gateway',
                ),
            )?.status,
        ).toBe(502);
    });

    test('should classify a distribution-wording status with no reason phrase', () => {
        expect(
            classifyPullError(
                new PullError(IMAGE, 'received unexpected HTTP status: 504'),
            )?.status,
        ).toBe(504);
    });

    test.each([
        ['manifest unknown', dockerodeError(404, 'manifest unknown')],
        [
            'unauthorized',
            dockerodeError(401, 'unauthorized: authentication required'),
        ],
        [
            'no space left',
            new PullError(
                IMAGE,
                'write /var/lib/docker/tmp/GetImageBlob: no space left on device',
            ),
        ],
        [
            'digest mismatch',
            new PullError(
                IMAGE,
                'filesystem layer verification failed for digest sha256:abc',
            ),
        ],
        [
            'digest containing a retryable status code',
            new PullError(
                IMAGE,
                'filesystem layer verification failed for digest sha256:5035030',
            ),
        ],
        [
            'daemon 500 matching neither upstream-status pattern',
            dockerodeError(
                500,
                'failed to register layer: Error processing tar file(exit status 1): unexpected EOF',
            ),
        ],
        [
            'socket error',
            Object.assign(
                new Error('connect ECONNREFUSED /var/run/docker.sock'),
                { code: 'ECONNREFUSED' },
            ),
        ],
        ['plain Error mentioning a throttle', new Error(GHCR_429)],
        ['non-object', 'boom'],
    ])('should fail fast on %s', (_label, error) => {
        expect(classifyPullError(error)).toBeUndefined();
    });
});

describe('PullError', () => {
    test('should carry the image, message and detail', () => {
        const error = new PullError(IMAGE, 'boom', { message: 'boom' });
        expect(error).toBeInstanceOf(Error);
        expect(error.name).toBe('PullError');
        expect(error.image).toBe(IMAGE);
        expect(error.message).toBe('boom');
        expect(error.detail).toEqual({ message: 'boom' });
    });
});
