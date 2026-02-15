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

    describe('Docker Events', () => {
        beforeEach(() => {
            // Mock logger for event tests
            docker.log = {
                info: jest.fn(),
                warn: jest.fn(),
                debug: jest.fn(),
                error: jest.fn(),
                child: jest.fn().mockReturnThis(),
            };
            docker.ensureLogger = jest.fn();

            // Mock watchCronDebounced
            docker.watchCronDebounced = jest.fn();

            // Initialize configuration
            docker.configuration = {
                watchall: false,
                watchbydefault: true,
            };

            // Mock helper methods
            docker.addImageDetailsToContainer = jest.fn();
            docker.watchContainer = jest.fn();
        });

        describe('onDockerEvent - Destroy', () => {
            test('should remove container from store on destroy event', async () => {
                const eventChunk = JSON.stringify({
                    Action: 'destroy',
                    id: 'container123',
                });

                await docker.onDockerEvent(eventChunk);

                expect(docker.log.info).toHaveBeenCalledWith(
                    expect.stringContaining(
                        'Container destroyed [id=container123]',
                    ),
                );
                expect(storeContainer.deleteContainer).toHaveBeenCalledWith(
                    'container123',
                );
                expect(docker.watchCronDebounced).not.toHaveBeenCalled();
            });
        });

        describe('onDockerEvent - Create', () => {
            test('should watch newly created container if it should be watched', async () => {
                const eventChunk = JSON.stringify({
                    Action: 'create',
                    id: 'container123',
                });

                const mockContainerEvent = {
                    Id: 'container123',
                    Labels: {
                        'wud.watch': 'true',
                    },
                };

                mockDockerApi.listContainers.mockResolvedValue([
                    mockContainerEvent,
                ]);
                utils.isContainerToWatch.mockReturnValue(true);
                const mockContainerWithDetails = {
                    ...mockContainerEvent,
                    image: {},
                };
                docker.addImageDetailsToContainer.mockResolvedValue(
                    mockContainerWithDetails,
                );

                await docker.onDockerEvent(eventChunk);

                expect(docker.log.debug).toHaveBeenCalledWith(
                    expect.stringContaining(
                        'Container created [id=container123]',
                    ),
                );
                expect(mockDockerApi.listContainers).toHaveBeenCalledWith({
                    filters: { id: ['container123'] },
                });
                expect(docker.log.info).toHaveBeenCalledWith(
                    expect.stringContaining('Watching newly created container'),
                );
                expect(docker.addImageDetailsToContainer).toHaveBeenCalled();
                expect(docker.watchContainer).toHaveBeenCalledWith(
                    mockContainerWithDetails,
                );
                expect(docker.watchCronDebounced).not.toHaveBeenCalled();
            });

            test('should ignore newly created container if it should NOT be watched', async () => {
                const eventChunk = JSON.stringify({
                    Action: 'create',
                    id: 'container123',
                });

                const mockContainerEvent = {
                    Id: 'container123',
                    Labels: {
                        'wud.watch': 'false',
                    },
                };

                mockDockerApi.listContainers.mockResolvedValue([
                    mockContainerEvent,
                ]);
                utils.isContainerToWatch.mockReturnValue(false);

                await docker.onDockerEvent(eventChunk);

                expect(docker.log.debug).toHaveBeenCalledWith(
                    expect.stringContaining(
                        'Container created [id=container123]',
                    ),
                );
                expect(docker.log.debug).toHaveBeenCalledWith(
                    expect.stringContaining('ignored (not to watch)'),
                );
                expect(
                    docker.addImageDetailsToContainer,
                ).not.toHaveBeenCalled();
                expect(docker.watchContainer).not.toHaveBeenCalled();
                expect(docker.watchCronDebounced).not.toHaveBeenCalled();
            });

            test('should fallback to debounced scan if container not found', async () => {
                const eventChunk = JSON.stringify({
                    Action: 'create',
                    id: 'container123',
                });

                mockDockerApi.listContainers.mockResolvedValue([]); // Empty list

                await docker.onDockerEvent(eventChunk);

                expect(docker.log.warn).toHaveBeenCalledWith(
                    expect.stringContaining('not found in list'),
                );
                expect(docker.watchCronDebounced).toHaveBeenCalled();
            });

            test('should fallback to debounced scan on error', async () => {
                const eventChunk = JSON.stringify({
                    Action: 'create',
                    id: 'container123',
                });

                mockDockerApi.listContainers.mockRejectedValue(
                    new Error('Docker API Error'),
                );

                await docker.onDockerEvent(eventChunk);

                expect(docker.log.warn).toHaveBeenCalledWith(
                    expect.stringContaining(
                        'Error when processing container create event',
                    ),
                );
                expect(docker.watchCronDebounced).toHaveBeenCalled();
            });
        });
    });
});
