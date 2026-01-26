// @ts-nocheck
import Docker from './Docker';
import * as event from '../../../event';
import * as storeContainer from '../../../store/container';
import * as registry from '../../../registry';
import { fullName } from '../../../model/container';
import * as utils from './utils';

// Mock all dependencies
jest.mock('dockerode');
jest.mock('node-cron');
jest.mock('just-debounce');
jest.mock('../../../event');
jest.mock('../../../store/container');
jest.mock('../../../registry');
jest.mock('../../../model/container');
jest.mock('../../../tag');
jest.mock('../../../prometheus/watcher');
jest.mock('parse-docker-image-name');
jest.mock('fs');
jest.mock('./utils');

import mockDockerode from 'dockerode';
import mockCron from 'node-cron';
import mockDebounce from 'just-debounce';
import mockFs from 'fs';
import mockParse from 'parse-docker-image-name';
import * as mockTag from '../../../tag';
import * as mockPrometheus from '../../../prometheus/watcher';

describe('Docker Watcher', () => {
    let docker;
    let mockDockerApi;
    let mockSchedule;
    let mockContainer;
    let mockImage;

    beforeEach(async () => {
        jest.clearAllMocks();

        // Setup dockerode mock
        mockDockerApi = {
            listContainers: jest.fn(),
            getContainer: jest.fn(),
            getEvents: jest.fn(),
            getImage: jest.fn(),
        };
        mockDockerode.mockImplementation(() => mockDockerApi);

        // Setup cron mock
        mockSchedule = {
            stop: jest.fn(),
        };
        mockCron.schedule.mockReturnValue(mockSchedule);

        // Setup debounce mock
        mockDebounce.mockImplementation((fn) => fn);

        // Setup container mock
        mockContainer = {
            inspect: jest.fn(),
        };
        mockDockerApi.getContainer.mockReturnValue(mockContainer);

        // Setup image mock
        mockImage = {
            inspect: jest.fn(),
        };
        mockDockerApi.getImage.mockReturnValue(mockImage);

        // Setup store mock
        storeContainer.getContainers.mockReturnValue([]);
        storeContainer.getContainer.mockReturnValue(undefined);
        storeContainer.insertContainer.mockImplementation((c) => c);
        storeContainer.updateContainer.mockImplementation((c) => c);
        storeContainer.deleteContainer.mockImplementation(() => {});

        // Setup registry mock
        registry.getState.mockReturnValue({ registry: {} });

        // Setup event mock
        event.emitWatcherStart.mockImplementation(() => {});
        event.emitWatcherStop.mockImplementation(() => {});
        event.emitContainerReport.mockImplementation(() => {});
        event.emitContainerReports.mockImplementation(() => {});

        // Setup tag mock
        mockTag.parse.mockReturnValue({ major: 1, minor: 0, patch: 0 });
        mockTag.isGreater.mockReturnValue(false);
        mockTag.transform.mockImplementation((transform, tag) => tag);

        // Setup prometheus mock
        const mockGauge = { set: jest.fn() };
        mockPrometheus.getWatchContainerGauge.mockReturnValue(mockGauge);

        // Setup parse mock
        mockParse.mockReturnValue({
            domain: 'docker.io',
            path: 'library/nginx',
            tag: '1.0.0',
        });

        // Setup fullName mock
        fullName.mockReturnValue('test_container');

        // Setup utils mock
        utils.findNewVersion.mockResolvedValue({ tag: '1.0.0' });
        utils.normalizeContainer.mockImplementation((c) => c);
        utils.getContainerName.mockReturnValue('test-container');
        utils.getRepoDigest.mockReturnValue('sha256:123');
        utils.isContainerToWatch.mockReturnValue(true);
        utils.isDigestToWatch.mockReturnValue(false);

        docker = new Docker();
        docker.dockerApi = mockDockerApi;
    });

    afterEach(async () => {
        if (docker) {
            await docker.deregisterComponent();
        }
    });

    describe('Initialization', () => {
        test('should initialize docker client', async () => {
            await docker.register('watcher', 'docker', 'test', {
                socket: '/var/run/docker.sock',
            });
            expect(mockDockerode).toHaveBeenCalledWith({
                socketPath: '/var/run/docker.sock',
            });
        });

        test('should initialize with host configuration', async () => {
            await docker.register('watcher', 'docker', 'test', {
                host: 'localhost',
                port: 2376,
            });
            expect(mockDockerode).toHaveBeenCalledWith({
                host: 'localhost',
                port: 2376,
            });
        });

        test('should initialize with SSL configuration', async () => {
            mockFs.readFileSync.mockReturnValue('cert-content');
            await docker.register('watcher', 'docker', 'test', {
                host: 'localhost',
                port: 2376,
                cafile: '/ca.pem',
                certfile: '/cert.pem',
                keyfile: '/key.pem',
            });
            expect(mockFs.readFileSync).toHaveBeenCalledTimes(3);
            expect(mockDockerode).toHaveBeenCalledWith({
                host: 'localhost',
                port: 2376,
                ca: 'cert-content',
                cert: 'cert-content',
                key: 'cert-content',
            });
        });

        test('should schedule cron job on init', async () => {
            await docker.register('watcher', 'docker', 'test', {
                cron: '0 * * * *',
            });
            docker.init();
            expect(mockCron.schedule).toHaveBeenCalledWith(
                '0 * * * *',
                expect.any(Function),
                { maxRandomDelay: 60000 },
            );
        });

        test('should warn about deprecated watchdigest', async () => {
            await docker.register('watcher', 'docker', 'test', {
                watchdigest: true,
            });
            const mockLog = { warn: jest.fn(), info: jest.fn() };
            docker.log = mockLog;
            docker.init();
            expect(mockLog.warn).toHaveBeenCalledWith(
                expect.stringContaining('deprecated'),
            );
        });

        test('should setup docker events listener', async () => {
            await docker.register('watcher', 'docker', 'test', {
                watchevents: true,
            });
            docker.init();
            expect(mockDebounce).toHaveBeenCalled();
        });

        test('should not setup events when disabled', async () => {
            await docker.register('watcher', 'docker', 'test', {
                watchevents: false,
            });
            docker.init();
            expect(mockDebounce).not.toHaveBeenCalled();
        });

        test('should set watchatstart based on store state', async () => {
            storeContainer.getContainers.mockReturnValue([{ id: 'existing' }]);
            await docker.register('watcher', 'docker', 'test', {
                watchatstart: true,
            });
            docker.init();
            expect(docker.configuration.watchatstart).toBe(false);
        });
    });

    describe('Deregistration', () => {
        test('should stop cron and clear timeouts on deregister', async () => {
            await docker.register('watcher', 'docker', 'test', {});
            docker.init();
            await docker.deregisterComponent();
            expect(mockSchedule.stop).toHaveBeenCalled();
        });
    });

    describe('Docker Events', () => {
        test('should listen to docker events', async () => {
            const mockStream = { on: jest.fn() };
            mockDockerApi.getEvents.mockImplementation((options, callback) => {
                callback(null, mockStream);
            });
            await docker.register('watcher', 'docker', 'test', {});
            await docker.listenDockerEvents();
            expect(mockDockerApi.getEvents).toHaveBeenCalledWith(
                {
                    filters: {
                        type: ['container'],
                        event: [
                            'create',
                            'destroy',
                            'start',
                            'stop',
                            'pause',
                            'unpause',
                            'die',
                            'update',
                        ],
                    },
                },
                expect.any(Function),
            );
        });

        test('should handle docker events error', async () => {
            await docker.register('watcher', 'docker', 'test', {});
            const mockLog = {
                warn: jest.fn(),
                debug: jest.fn(),
                info: jest.fn(),
            };
            docker.log = mockLog;
            mockDockerApi.getEvents.mockImplementation((options, callback) => {
                callback(new Error('Connection failed'));
            });
            await docker.listenDockerEvents();
            expect(mockLog.warn).toHaveBeenCalledWith(
                expect.stringContaining('Connection failed'),
            );
        });

        test('should handle docker events parsing error', async () => {
            await docker.register('watcher', 'docker', 'test', {});
            const mockLog = {
                warn: jest.fn(),
                debug: jest.fn(),
                info: jest.fn(),
            };
            docker.log = mockLog;
            await docker.onDockerEvent(Buffer.from('{"Action":"create"'));
            expect(mockLog.warn).toHaveBeenCalledWith(
                expect.stringContaining('Unable to parse Docker event'),
            );
        });

        test('should process create/destroy events', async () => {
            docker.watchCronDebounced = jest.fn();
            const event = JSON.stringify({
                Action: 'create',
                id: 'container123',
            });
            await docker.onDockerEvent(Buffer.from(event));
            expect(docker.watchCronDebounced).toHaveBeenCalled();
        });

        test('should process chunked create/destroy events', async () => {
            const mockStream = { on: jest.fn() };
            mockDockerApi.getEvents.mockImplementation((options, callback) => {
                callback(null, mockStream);
            });
            docker.onDockerEvent = jest.fn();

            await docker.register('watcher', 'docker', 'test', {});
            await docker.listenDockerEvents();

            const dataHandler = mockStream.on.mock.calls.find(
                (c) => c[0] === 'data',
            )[1];
            dataHandler(Buffer.from('{"Action":"create"'));
            dataHandler(Buffer.from(',"id":"container123"}'));
            expect(docker.onDockerEvent).not.toHaveBeenCalled();

            dataHandler(Buffer.from('\n'));
            expect(docker.onDockerEvent).toHaveBeenCalledTimes(1);

            const calledWith = docker.onDockerEvent.mock.calls[0][0].toString();
            expect(calledWith).toBe(
                '{"Action":"create","id":"container123"}\n',
            );
        });

        test('should update container status on other events', async () => {
            await docker.register('watcher', 'docker', 'test', {});
            const mockLog = {
                child: jest.fn().mockReturnValue({ info: jest.fn() }),
                debug: jest.fn(),
            };
            docker.log = mockLog;
            mockContainer.inspect.mockResolvedValue({
                State: { Status: 'running' },
            });
            const existingContainer = { id: 'container123', status: 'stopped' };
            storeContainer.getContainer.mockReturnValue(existingContainer);

            const event = JSON.stringify({
                Action: 'start',
                id: 'container123',
            });
            await docker.onDockerEvent(Buffer.from(event));

            expect(mockContainer.inspect).toHaveBeenCalled();
            expect(storeContainer.updateContainer).toHaveBeenCalled();
        });

        test('should handle container not found during event processing', async () => {
            const mockLog = { debug: jest.fn() };
            docker.log = mockLog;
            mockDockerApi.getContainer.mockImplementation(() => {
                throw new Error('No such container');
            });

            const event = JSON.stringify({
                Action: 'start',
                id: 'nonexistent',
            });
            await docker.onDockerEvent(Buffer.from(event));

            expect(mockLog.debug).toHaveBeenCalledWith(
                expect.stringContaining('Unable to get container'),
            );
        });
    });

    describe('Container Watching', () => {
        test('should watch containers', async () => {
            docker.getContainers = jest.fn().mockResolvedValue([{ id: '1' }]);
            docker.watchContainer = jest.fn().mockResolvedValue({});

            await docker.watch();

            expect(docker.getContainers).toHaveBeenCalled();
            expect(docker.watchContainer).toHaveBeenCalled();
        });

        test('should filter store containers by agent when pruning', async () => {
            docker.name = 'docker-local';
            docker.configuration = { watchall: false, watchbydefault: true };
            mockDockerApi.listContainers.mockResolvedValue([]);

            await docker.getContainers();

            expect(storeContainer.getContainers).toHaveBeenCalledWith({
                watcher: 'docker-local',
            });
        });
    });

    describe('Container Processing', () => {
        test('should watch individual container', async () => {
            const container = { id: 'test123', name: 'test' };
            const mockLog = {
                child: jest
                    .fn()
                    .mockReturnValue({ debug: jest.fn(), warn: jest.fn() }),
            };
            docker.log = mockLog;
            docker.configuration = { discoveryonly: false };
            utils.findNewVersion.mockResolvedValue({ tag: '2.0.0' });
            docker.mapContainerToContainerReport = jest
                .fn()
                .mockReturnValue({ container, changed: false });

            await docker.watchContainer(container);

            expect(utils.findNewVersion).toHaveBeenCalledWith(
                container,
                expect.anything(),
                expect.anything(),
            );
            expect(event.emitContainerReport).toHaveBeenCalled();
        });
    });

    describe('Container Details', () => {
        test('should add image details', async () => {
            const container = { Id: '123', Image: 'nginx:latest', Labels: {} };
            const imageDetails = { RepoTags: ['nginx:latest'] };
            mockImage.inspect.mockResolvedValue(imageDetails);
            await docker.addImageDetailsToContainer(container);
            expect(utils.normalizeContainer).toHaveBeenCalled();
        });
    });
});
