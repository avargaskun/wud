import { Given, When, Then } from '@cucumber/cucumber';
import * as assert from 'assert';
import registryOracle from '../support/registry_oracle';

interface Container {
    id: string;
    name: string;
    status: string;
    agent?: any;
    image: {
        registry: { name: string };
        name: string;
        tag: { value: string };
    };
    updateAvailable: boolean;
}

Given(/^I resolve the latest version for image "([^"]*)" on registry "([^"]*)" with strategy "([^"]*)" and pattern "([^"]*)" and value "([^"]*)" as "([^"]*)"$/, async function (this: any, imageName: string, registry: string, strategy: string, pattern: string, value: string, varName: string) {
    let version;
    if (strategy === 'static') {
        version = value;
    } else {
        version = await registryOracle.getLatestVersion(registry, imageName, pattern);
    }
    this.apickli.setGlobalVariable(varName, version);
});

Given(/^I get the latest version for image "([^"]*)" on registry "([^"]*)" with pattern "([^"]*)" and store it in "([^"]*)"$/, async function (this: any, imageName: string, registry: string, pattern: string, varName: string) {
    const version = await registryOracle.getLatestVersion(registry, imageName, pattern);
    this.apickli.setGlobalVariable(varName, version);
});

Given(/^I get the latest digest for image "([^"]*)" on registry "([^"]*)" with tag "([^"]*)" and store it in "([^"]*)"$/, async function (this: any, imageName: string, registry: string, tag: string, varName: string) {
    const digest = await registryOracle.getLatestDigest(registry, imageName, tag);
    this.apickli.setGlobalVariable(varName, digest);
});

Then(/^response body path (.*) should equal variable "([^"]*)"$/, function (this: any, path: string, varName: string) {
    const expectedValue = this.apickli.getGlobalVariable(varName);
    const actualValue = this.apickli.evaluatePathInResponseBody(path);
    assert.strictEqual(String(actualValue), String(expectedValue), `Expected ${expectedValue} at ${path}, but got ${actualValue}`);
});

Given(/^I set variable "([^"]*)" to "([^"]*)"$/, function (this: any, varName: string, value: string) {
    const substitutedValue = substituteVariables(value, this.apickli);
    this.apickli.setGlobalVariable(varName, substitutedValue);
});

Then('response body should have substituted {string}', function (this: any, expectedContent: string) {
    const safeExpectedContent = substituteVariables(expectedContent, this.apickli);
    const responseBody = this.apickli.getResponseObject().body;
    assert.ok(responseBody.includes(safeExpectedContent), `Response body should contain ${safeExpectedContent}`);
});

Then(/^response body should have substituted string:$/, function (this: any, expectedString: string) {
    const safeExpectedString = substituteVariables(expectedString, this.apickli);
    const responseBody = this.apickli.getResponseObject().body;
    assert.ok(responseBody.includes(safeExpectedString), `Response body should contain ${safeExpectedString}`);
});

When(/^I find the (remote )?container with image "([^"]*)" and save its ID as "([^"]*)", version as "([^"]*)", and name as "([^"]*)"$/, async function (this: any, remoteArg: string, imageName: string, idVar: string, versionVar: string, nameVar: string) {
    await new Promise<void>((resolve, reject) => {
        this.apickli.get('/api/containers', (error: any, response: any) => {
            if (error) reject(error);
            else resolve(response);
        });
    });
    const response = this.apickli.getResponseObject();

    let containers: Container[] | any = response.body;

    if (typeof containers === 'string') {
        try {
            containers = JSON.parse(containers);
        } catch (e) {
            this.attach('Failed to parse response body:', e);
            throw new Error('Response body is not valid JSON');
        }
    }

    if (!response || !Array.isArray(containers)) {
        throw new Error('Failed to retrieve containers or invalid response format');
    }

    const isRemote = !!remoteArg;

    const found = (containers as Container[]).find(c => {
        // Filter by Agent context
        if (isRemote && !c.agent) return false;
        if (!isRemote && c.agent) return false;

        // Ignore stopped containers
        if (c.status !== 'running') {
            return false;
        }
        // Construct possible representations
        const fullImageName = `${c.image.registry.name !== 'hub' ? c.image.registry.name + '/' : ''}${c.image.name}:${c.image.tag.value}`;
        const nameAndTag = `${c.image.name}:${c.image.tag.value}`;
        const simpleName = c.image.name;

        // Try to match exact or partial
        return (
            fullImageName === imageName ||
            nameAndTag === imageName ||
            simpleName === imageName ||
            // Fallback: check if imageName is contained in full string
            fullImageName.includes(imageName)
        );
    });

    if (!found) {
        throw new Error(`Container with image "${imageName}" (remote=${isRemote}) not found. Available: ${(containers as Container[]).map(c => `${c.image.name}:${c.image.tag.value} [${c.agent || 'local'}]`).join(', ')}`);
    }

    this.apickli.setGlobalVariable(idVar, found.id);
    this.apickli.setGlobalVariable(versionVar, found.image.tag.value);
    this.apickli.setGlobalVariable(nameVar, found.name);
});

Then(/^I wait for (\d+) seconds$/, async function (seconds: string) {
    await new Promise(resolve => setTimeout(resolve, parseInt(seconds) * 1000));
});

Then(/^the container with saved name "([^"]*)" should have a version different than "([^"]*)"$/, async function (this: any, nameVar: string, oldVersionVar: string) {
    const name = this.apickli.getGlobalVariable(nameVar);
    const oldVersion = this.apickli.getGlobalVariable(oldVersionVar);

    // Refresh containers
    await new Promise<void>((resolve, reject) => {
        this.apickli.get('/api/containers', (error: any, response: any) => {
            if (error) reject(error);
            else resolve(response);
        });
    });
    const response = this.apickli.getResponseObject();
    
    let containers: Container[] | any = response.body;

    if (typeof containers === 'string') {
        try {
            containers = JSON.parse(containers);
        } catch (e) {
            this.attach('Failed to parse response body:', e);
            throw new Error('Response body is not valid JSON');
        }
    }

    if (!response || !Array.isArray(containers)) {
         throw new Error('Failed to retrieve containers or invalid response format');
    }

    // Find containers matching the name
    const matches = (containers as Container[]).filter(c => c.name === name);
    
    if (matches.length === 0) {
        throw new Error(`Container with name ${name} not found in current list`);
    }

    let container: Container;
    if (matches.length > 1) {
        // If multiple containers found (e.g. old exited + new running), prefer the running one
        const running = matches.find(c => c.status && c.status.toLowerCase() === 'running');
        if (running) {
            container = running;
            // Optionally log that we found multiple but picked running
            this.attach(`Found ${matches.length} containers with name ${name}. Selected running container (id=${container.id})`);
        } else {
            // Fallback to the first one
            container = matches[0];
            this.attach(`Found ${matches.length} containers with name ${name}, none are running. Selected first (id=${container.id})`);
        }
    } else {
        container = matches[0];
    }

    const currentVersion = container.image.tag.value;
    assert.notStrictEqual(currentVersion, oldVersion, `Container version expected to change from ${oldVersion}, but is still ${currentVersion}`);
});

Then(/^the container with saved ID "([^"]*)" should have a version different than "([^"]*)"$/, async function (this: any, idVar: string, oldVersionVar: string) {
    const id = this.apickli.getGlobalVariable(idVar);
    const oldVersion = this.apickli.getGlobalVariable(oldVersionVar);

    // Refresh containers
    await new Promise<void>((resolve, reject) => {
        this.apickli.get('/api/containers', (error: any, response: any) => {
            if (error) reject(error);
            else resolve(response);
        });
    });
    const response = this.apickli.getResponseObject();
    
    let containers: Container[] | any = response.body;

    if (typeof containers === 'string') {
        try {
            containers = JSON.parse(containers);
        } catch (e) {
            this.attach('Failed to parse response body:', e);
            throw new Error('Response body is not valid JSON');
        }
    }

    if (!response || !Array.isArray(containers)) {
         throw new Error('Failed to retrieve containers or invalid response format');
    }

    const container = (containers as Container[]).find(c => c.id === id);
    
    if (!container) {
        throw new Error(`Container with ID ${id} not found in current list`);
    }

    const currentVersion = container.image.tag.value;
    assert.notStrictEqual(currentVersion, oldVersion, `Container version expected to change from ${oldVersion}, but is still ${currentVersion}`);
});

function substituteVariables(str: string, apickli: any): string {
    return str.replace(/`([^`]*)`/g, (match, p1) => {
        return apickli.getGlobalVariable(p1) || match;
    });
}

When(/^I send POST to (.*)$/, async function (this: any, url: string) {
    const safeUrl = substituteVariables(url, this.apickli);
    await new Promise<void>((resolve, reject) => {
        this.apickli.post(safeUrl, (error: any, response: any) => {
            if (error) reject(error);
            else resolve(response);
        });
    });
});




Then(/^the container with image "([^"]*)" should have update available$/, async function (this: any, imageName: string) {
    const response = this.apickli.getResponseObject();
    let containers: Container[] | any = response.body;

    if (typeof containers === 'string') {
        try {
            containers = JSON.parse(containers);
        } catch (e) {
            this.attach('Failed to parse response body:', e);
            throw new Error('Response body is not valid JSON');
        }
    }
    
    if (!response || !Array.isArray(containers)) {
        this.attach('Invalid Response:', JSON.stringify(response, null, 2));
        throw new Error(`Failed to retrieve containers or invalid response format. Status: ${response ? response.statusCode : 'unknown'}`);
    }

    // Reuse the find logic (simplified here or extracted if possible, but copy-paste is safer for now to avoid breaking existing step if I refactor incorrectly)
    const found = (containers as Container[]).find(c => {
         const fullImageName = `${c.image.registry.name !== 'hub' ? c.image.registry.name + '/' : ''}${c.image.name}:${c.image.tag.value}`;
         const nameAndTag = `${c.image.name}:${c.image.tag.value}`;
         const simpleName = c.image.name; // e.g. 'library/nginx' or 'nginx'
 
         return (
             fullImageName === imageName ||
             nameAndTag === imageName ||
             simpleName === imageName ||
             fullImageName.includes(imageName)
         );
    });

    if (!found) {
         throw new Error(`Container with image "${imageName}" not found.`);
    }

    assert.strictEqual(found.updateAvailable, true, `Container ${imageName} should have update available, but got ${found.updateAvailable}`);
});
