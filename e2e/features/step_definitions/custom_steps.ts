import { Given, When, Then } from '@cucumber/cucumber';
import type { Apickli } from 'apickli';
import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as path from 'path';
import registryOracle from '../support/registry_oracle';
import type { ApickliWorld } from '../support/world';

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

Given(/^I resolve the latest version for image "([^"]*)" on registry "([^"]*)" with strategy "([^"]*)" and pattern "([^"]*)" and value "([^"]*)" as "([^"]*)"$/, async function (this: ApickliWorld, imageName: string, registry: string, strategy: string, pattern: string, value: string, varName: string) {
    let version;
    if (strategy === 'static') {
        version = value;
    } else {
        version = await registryOracle.getLatestVersion(registry, imageName, pattern);
    }
    this.apickli.setGlobalVariable(varName, version);
});

Given(/^I get the latest version for image "([^"]*)" on registry "([^"]*)" with pattern "([^"]*)" and store it in "([^"]*)"$/, async function (this: ApickliWorld, imageName: string, registry: string, pattern: string, varName: string) {
    const version = await registryOracle.getLatestVersion(registry, imageName, pattern);
    this.apickli.setGlobalVariable(varName, version);
});

Given(/^I get the latest digest for image "([^"]*)" on registry "([^"]*)" with tag "([^"]*)" and store it in "([^"]*)"$/, async function (this: ApickliWorld, imageName: string, registry: string, tag: string, varName: string) {
    const digest = await registryOracle.getLatestDigest(registry, imageName, tag);
    this.apickli.setGlobalVariable(varName, digest);
});

Then(/^response body path (.*) should equal variable "([^"]*)"$/, function (this: ApickliWorld, path: string, varName: string) {
    const expectedValue = this.apickli.getGlobalVariable(varName);
    const actualValue = this.apickli.evaluatePathInResponseBody(path);
    assert.strictEqual(String(actualValue), String(expectedValue), `Expected ${expectedValue} at ${path}, but got ${actualValue}`);
});

// apickli's evaluatePathInResponseBody() collapses "no match" to null (evaluateJsonPath returns
// null for an empty JSONPath result), so it cannot tell an absent key from a null value -- the
// exact distinction the update buckets encode. Resolve the dot path against the parsed body
// instead and report absence with a sentinel.
const ABSENT = Symbol('absent');

function resolveDotPath(apickli: Apickli, path: string): any {
    const { body } = apickli.getResponseObject();
    let parsed;
    try {
        parsed = typeof body === 'string' ? JSON.parse(body) : body;
    } catch (e) {
        throw new Error(`Response body is not valid JSON: ${body}`);
    }
    const segments = path.replace(/^\$\.?/, '').split('.').filter((segment: string) => segment !== '');
    let current = parsed;
    for (const segment of segments) {
        if (current === null || typeof current !== 'object' || !(segment in current)) {
            return ABSENT;
        }
        current = current[segment];
    }
    return current;
}

function describeValue(value: any): string {
    return value === ABSENT ? 'absent' : JSON.stringify(value);
}

// "must be" rather than "should be": apickli already owns /^response body path (.*) should be (.*)$/
// and cucumber fails on an ambiguous match.
Then(/^response body path (.*) must be absent$/, function (this: ApickliWorld, path: string) {
    const actual = resolveDotPath(this.apickli, path);
    assert.strictEqual(actual, ABSENT, `Expected ${path} to be absent, got ${describeValue(actual)}`);
});

Then(/^response body path (.*) must be exactly null$/, function (this: ApickliWorld, path: string) {
    const actual = resolveDotPath(this.apickli, path);
    assert.strictEqual(actual, null, `Expected ${path} to be null, got ${describeValue(actual)}`);
});

Given(/^I set variable "([^"]*)" to "([^"]*)"$/, function (this: ApickliWorld, varName: string, value: string) {
    const substitutedValue = substituteVariables(value, this.apickli);
    this.apickli.setGlobalVariable(varName, substitutedValue);
});

Then('response body should have substituted {string}', function (this: ApickliWorld, expectedContent: string) {
    const safeExpectedContent = substituteVariables(expectedContent, this.apickli);
    const responseBody = this.apickli.getResponseObject().body;
    assert.ok(responseBody.includes(safeExpectedContent), `Response body should contain ${safeExpectedContent}`);
});

Then(/^response body should have substituted string:$/, function (this: ApickliWorld, expectedString: string) {
    const safeExpectedString = substituteVariables(expectedString, this.apickli);
    const responseBody = this.apickli.getResponseObject().body;
    assert.ok(responseBody.includes(safeExpectedString), `Response body should contain ${safeExpectedString}`);
});

When(/^I find the (remote )?container with image "([^"]*)" and save its ID as "([^"]*)", version as "([^"]*)", and name as "([^"]*)"$/, async function (this: ApickliWorld, remoteArg: string, imageName: string, idVar: string, versionVar: string, nameVar: string) {
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
            this.attach('Failed to parse response body:', String(e));
            throw new Error('Response body is not valid JSON');
        }
    }

    if (!response || !Array.isArray(containers)) {
        throw new Error('Failed to retrieve containers or invalid response format');
    }

    const isRemote = !!remoteArg;

    const found = (containers as Container[]).find((c) => {
        // Filter by Agent context
        if (isRemote && !c.agent) return false;
        if (!isRemote && c.agent) return false;

        // Ignore stopped containers
        if (c.status !== 'running') {
            return false;
        }
        // Construct possible representations
        const fullImageName = `${c.image.registry.name !== 'hub' ? `${c.image.registry.name}/` : ''}${c.image.name}:${c.image.tag.value}`;
        const nameAndTag = `${c.image.name}:${c.image.tag.value}`;
        const simpleName = c.image.name;

        // Try to match exact or partial
        return (
            fullImageName === imageName
            || nameAndTag === imageName
            || simpleName === imageName
            // Fallback: check if imageName is contained in full string
            || fullImageName.includes(imageName)
        );
    });

    if (!found) {
        throw new Error(`Container with image "${imageName}" (remote=${isRemote}) not found. Available: ${(containers as Container[]).map((c) => `${c.image.name}:${c.image.tag.value} [${c.agent || 'local'}]`).join(', ')}`);
    }

    this.apickli.setGlobalVariable(idVar, found.id);
    this.apickli.setGlobalVariable(versionVar, found.image.tag.value);
    this.apickli.setGlobalVariable(nameVar, found.name);
});

When(/^I find the (remote )?container with name "([^"]*)" and save its ID as "([^"]*)", version as "([^"]*)", and name as "([^"]*)"$/, async function (this: ApickliWorld, remoteArg: string, name: string, idVar: string, versionVar: string, nameVar: string) {
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
            this.attach('Failed to parse response body:', String(e));
            throw new Error('Response body is not valid JSON');
        }
    }

    if (!response || !Array.isArray(containers)) {
        throw new Error('Failed to retrieve containers or invalid response format');
    }

    const isRemote = !!remoteArg;

    const found = (containers as Container[]).find((c) => {
        // Filter by Agent context
        if (isRemote && !c.agent) return false;
        if (!isRemote && c.agent) return false;

        // Ignore stopped containers
        if (c.status !== 'running') {
            return false;
        }
        return c.name === name;
    });

    if (!found) {
        throw new Error(`Container with name "${name}" (remote=${isRemote}) not found. Available: ${(containers as Container[]).map((c) => `${c.name} [${c.agent || 'local'}]`).join(', ')}`);
    }

    this.apickli.setGlobalVariable(idVar, found.id);
    this.apickli.setGlobalVariable(versionVar, found.image.tag.value);
    this.apickli.setGlobalVariable(nameVar, found.name);
});

Then(/^I wait for (\d+) seconds$/, async (seconds: string) => {
    await new Promise((resolve) => setTimeout(resolve, parseInt(seconds) * 1000));
});

Then(/^the container with saved name "([^"]*)" should have a version different than "([^"]*)"$/, async function (this: ApickliWorld, nameVar: string, oldVersionVar: string) {
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
            this.attach('Failed to parse response body:', String(e));
            throw new Error('Response body is not valid JSON');
        }
    }

    if (!response || !Array.isArray(containers)) {
        throw new Error('Failed to retrieve containers or invalid response format');
    }

    // Find containers matching the name
    const matches = (containers as Container[]).filter((c) => c.name === name);

    if (matches.length === 0) {
        throw new Error(`Container with name ${name} not found in current list`);
    }

    let container: Container;
    if (matches.length > 1) {
        // If multiple containers found (e.g. old exited + new running), prefer the running one
        const running = matches.find((c) => c.status && c.status.toLowerCase() === 'running');
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

Then(/^the container with saved name "([^"]*)" should have version equal to variable "([^"]*)"$/, async function (this: ApickliWorld, nameVar: string, versionVar: string) {
    const name = this.apickli.getGlobalVariable(nameVar);
    const expectedVersion = this.apickli.getGlobalVariable(versionVar);

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
            this.attach('Failed to parse response body:', String(e));
            throw new Error('Response body is not valid JSON');
        }
    }

    if (!response || !Array.isArray(containers)) {
        throw new Error('Failed to retrieve containers or invalid response format');
    }

    // Find containers matching the name
    const matches = (containers as Container[]).filter((c) => c.name === name);

    if (matches.length === 0) {
        throw new Error(`Container with name ${name} not found in current list`);
    }

    let container: Container;
    if (matches.length > 1) {
        // If multiple containers found (e.g. old exited + new running), prefer the running one
        const running = matches.find((c) => c.status && c.status.toLowerCase() === 'running');
        if (running) {
            container = running;
            this.attach(`Found ${matches.length} containers with name ${name}. Selected running container (id=${container.id})`);
        } else {
            container = matches[0];
            this.attach(`Found ${matches.length} containers with name ${name}, none are running. Selected first (id=${container.id})`);
        }
    } else {
        container = matches[0];
    }

    const currentVersion = container.image.tag.value;
    assert.strictEqual(currentVersion, expectedVersion, `Container version expected to be ${expectedVersion}, but is ${currentVersion}`);
});

Then(/^the container with saved ID "([^"]*)" should have a version different than "([^"]*)"$/, async function (this: ApickliWorld, idVar: string, oldVersionVar: string) {
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
            this.attach('Failed to parse response body:', String(e));
            throw new Error('Response body is not valid JSON');
        }
    }

    if (!response || !Array.isArray(containers)) {
        throw new Error('Failed to retrieve containers or invalid response format');
    }

    const container = (containers as Container[]).find((c) => c.id === id);

    if (!container) {
        throw new Error(`Container with ID ${id} not found in current list`);
    }

    const currentVersion = container.image.tag.value;
    assert.notStrictEqual(currentVersion, oldVersion, `Container version expected to change from ${oldVersion}, but is still ${currentVersion}`);
});

function substituteVariables(str: string, apickli: Apickli): string {
    return str.replace(/`([^`]*)`/g, (match, p1) => apickli.getGlobalVariable(p1) || match);
}

When(/^I send POST to (\S+)$/, async function (this: ApickliWorld, url: string) {
    const safeUrl = substituteVariables(url, this.apickli);
    await new Promise<void>((resolve, reject) => {
        this.apickli.post(safeUrl, (error: any, response: any) => {
            if (error) reject(error);
            else resolve(response);
        });
    });
});

When(/^I send POST to (.*) with container IDs "([^"]*)"$/, async function (this: ApickliWorld, url: string, idVars: string) {
    const containerIds = idVars.split(',').map((v) => this.apickli.getGlobalVariable(v.trim()));
    const body = { containerIds };
    this.apickli.setRequestBody(JSON.stringify(body));
    this.apickli.addRequestHeader('Content-Type', 'application/json');
    const safeUrl = substituteVariables(url, this.apickli);
    await new Promise<void>((resolve, reject) => {
        this.apickli.post(safeUrl, (error: any, response: any) => {
            if (error) reject(error);
            else resolve(response);
        });
    });
});

When(/^I send POST to (.*) with container IDs "([^"]*)" and bucket "([^"]*)"$/, async function (this: ApickliWorld, url: string, idVars: string, bucket: string) {
    const containerIds = idVars.split(',').map((v) => this.apickli.getGlobalVariable(v.trim()));
    const body = { containerIds, bucket };
    this.apickli.setRequestBody(JSON.stringify(body));
    this.apickli.addRequestHeader('Content-Type', 'application/json');
    const safeUrl = substituteVariables(url, this.apickli);
    await new Promise<void>((resolve, reject) => {
        this.apickli.post(safeUrl, (error: any, response: any) => {
            if (error) reject(error);
            else resolve(response);
        });
    });
});

When(/^I send POST to (.*) with bucket "([^"]*)"$/, async function (this: ApickliWorld, url: string, bucket: string) {
    const body = { bucket };
    this.apickli.setRequestBody(JSON.stringify(body));
    this.apickli.addRequestHeader('Content-Type', 'application/json');
    const safeUrl = substituteVariables(url, this.apickli);
    await new Promise<void>((resolve, reject) => {
        this.apickli.post(safeUrl, (error: any, response: any) => {
            if (error) reject(error);
            else resolve(response);
        });
    });
});

Then(/^the container with image "([^"]*)" should have update available$/, async function (this: ApickliWorld, imageName: string) {
    const response = this.apickli.getResponseObject();
    let containers: Container[] | any = response.body;

    if (typeof containers === 'string') {
        try {
            containers = JSON.parse(containers);
        } catch (e) {
            this.attach('Failed to parse response body:', String(e));
            throw new Error('Response body is not valid JSON');
        }
    }

    if (!response || !Array.isArray(containers)) {
        this.attach('Invalid Response:', JSON.stringify(response, null, 2));
        throw new Error(`Failed to retrieve containers or invalid response format. Status: ${response ? response.statusCode : 'unknown'}`);
    }

    // Reuse the find logic (simplified here or extracted if possible, but copy-paste is safer for now to avoid breaking existing step if I refactor incorrectly)
    const found = (containers as Container[]).find((c) => {
        const fullImageName = `${c.image.registry.name !== 'hub' ? `${c.image.registry.name}/` : ''}${c.image.name}:${c.image.tag.value}`;
        const nameAndTag = `${c.image.name}:${c.image.tag.value}`;
        const simpleName = c.image.name; // e.g. 'library/nginx' or 'nginx'

        return (
            fullImageName === imageName
             || nameAndTag === imageName
             || simpleName === imageName
             || fullImageName.includes(imageName)
        );
    });

    if (!found) {
        throw new Error(`Container with image "${imageName}" not found.`);
    }

    assert.strictEqual(found.updateAvailable, true, `Container ${imageName} should have update available, but got ${found.updateAvailable}`);
});

Then(/^the compose file "([^"]*)" should pin service "([^"]*)" to "([^"]*)"$/, async (relativePath: string, service: string, expected: string) => {
    const filePath: string = path.resolve(process.cwd(), relativePath);
    const content: string = await fs.readFile(filePath, 'utf-8');
    const lines: string[] = content.split(/\r?\n/);
    const serviceIndex: number = lines.findIndex((l) => l.trim() === `${service}:`);
    assert.ok(serviceIndex !== -1, `service ${service} not found in ${filePath}`);
    const indent: number = lines[serviceIndex].search(/\S/);
    const rest: string[] = lines.slice(serviceIndex + 1);
    const endRel: number = rest.findIndex((l) => l.trim() !== '' && l.search(/\S/) <= indent);
    const block: string[] = endRel === -1 ? rest : rest.slice(0, endRel);
    const imageLine: string | undefined = block.find((l) => l.trim().startsWith('image:'));
    assert.ok(imageLine, `service ${service} has no image: line in ${filePath}`);
    const actual: string = imageLine.trim().replace(/\s+#.*$/, '');
    assert.strictEqual(actual, `image: ${expected}`);
});
