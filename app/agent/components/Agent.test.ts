import Agent from './Agent';

describe('Agent', () => {
    let agent: Agent;

    beforeEach(() => {
        agent = new Agent();
    });

    test('should validate configuration', () => {
        const config = {
            host: 'localhost',
            port: 3000,
            secret: 'mysecret',
        };
        const validated = agent.validateConfiguration(config);
        expect(validated.host).toBe('localhost');
        expect(validated.port).toBe(3000);
        expect(validated.secret).toBe('mysecret');
    });

    test('should throw error if host is missing', () => {
        const config = {
            port: 3000,
            secret: 'mysecret',
        };
        expect(() => agent.validateConfiguration(config)).toThrow();
    });

    test('should throw error if secret is missing', () => {
        const config = {
            host: 'localhost',
            port: 3000,
        };
        expect(() => agent.validateConfiguration(config)).toThrow();
    });

    test('should mask configuration', () => {
        const config = {
            host: 'localhost',
            port: 3000,
            secret: 'mysecret',
        };
        const masked = agent.maskConfiguration(config);
        expect(masked.secret).toBe('m******t');
        expect(masked.host).toBe('localhost');
    });

    test('should use default port if not provided', () => {
        const config = {
            host: 'localhost',
            secret: 'mysecret',
        };
        const validated = agent.validateConfiguration(config);
        expect(validated.port).toBe(3000);
    });
});
