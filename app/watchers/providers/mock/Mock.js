const joi = require('joi-cron-expression')(require('joi'));
const Component = require('../../../registry/Component');
const storeContainer = require('../../../store/container');
const event = require('../../../event');

class Mock extends Component {
    getConfigurationSchema() {
        return joi.object().keys({
            cron: joi.string().cron().default('0 * * * *'),
            jitter: this.joi.number().integer().min(0).default(60000),
            watchbydefault: this.joi.boolean().default(true),
            watchatstart: this.joi.boolean().default(true),
        });
    }

    init() {
        // Do nothing for mock
    }

    async watch() {
        const container = {
            id: 'mock-container',
            name: 'mock-container',
            watcher: 'mock',
            image: {
                registry: { name: 'hub' },
                tag: { value: '1.0.0' },
                digest: { watch: false }
            },
            result: {
                tag: '1.0.0'
            }
        };

        // Upsert
        const containerInStore = storeContainer.getContainer(container.id);
        if (!containerInStore) {
            storeContainer.insertContainer(container);
        }

        event.emitContainerReport({
            container: container,
            changed: true
        });

        return [{
            container: container,
            changed: true
        }];
    }
}

module.exports = Mock;
