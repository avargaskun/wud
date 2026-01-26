const { When, Then } = require('@cucumber/cucumber');
const assert = require('assert');

When(/^I find the (remote )?container with image "([^"]*)" and save its ID as "([^"]*)", version as "([^"]*)", and name as "([^"]*)"$/, async function (remoteArg, imageName, idVar, versionVar, nameVar) {
    await new Promise((resolve, reject) => {
        this.apickli.get('/api/containers', (error, response) => {
            if (error) reject(error);
            else resolve(response);
        });
    });
    const response = this.apickli.getResponseObject();

    let containers = response.body;

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

    const found = containers.find(c => {
        // Filter by Agent context
        if (isRemote && !c.agent) return false;
        // If we strictly want local when "remote" is NOT specified, we could uncomment:
        // if (!isRemote && c.agent) return false; 
        // But let's leave it flexible or prefer local? 
        // Given the ambiguity we faced, let's prefer local if not specified, OR just rely on image name uniqueness if possible.
        // But here we have duplicate images.
        // Let's implement: if isRemote is false/undefined, we prefer local (no agent).
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
        throw new Error(`Container with image "${imageName}" (remote=${isRemote}) not found. Available: ${containers.map(c => `${c.image.name}:${c.image.tag.value} [${c.agent || 'local'}]`).join(', ')}`);
    }

    this.apickli.setGlobalVariable(idVar, found.id);
    this.apickli.setGlobalVariable(versionVar, found.image.tag.value);
    this.apickli.setGlobalVariable(nameVar, found.name);
});

Then(/^I wait for (\d+) seconds$/, async function (seconds) {
    await new Promise(resolve => setTimeout(resolve, seconds * 1000));
});

Then(/^the container with saved name "([^"]*)" should have a version different than "([^"]*)"$/, async function (nameVar, oldVersionVar) {
    const name = this.apickli.getGlobalVariable(nameVar);
    const oldVersion = this.apickli.getGlobalVariable(oldVersionVar);

    // Refresh containers
    await new Promise((resolve, reject) => {
        this.apickli.get('/api/containers', (error, response) => {
            if (error) reject(error);
            else resolve(response);
        });
    });
    const response = this.apickli.getResponseObject();
    
    let containers = response.body;

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
    const matches = containers.filter(c => c.name === name);
    
    if (matches.length === 0) {
        throw new Error(`Container with name ${name} not found in current list`);
    }

    let container;
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

Then(/^the container with saved ID "([^"]*)" should have a version different than "([^"]*)"$/, async function (idVar, oldVersionVar) {
    const id = this.apickli.getGlobalVariable(idVar);
    const oldVersion = this.apickli.getGlobalVariable(oldVersionVar);

    // Refresh containers
    await new Promise((resolve, reject) => {
        this.apickli.get('/api/containers', (error, response) => {
            if (error) reject(error);
            else resolve(response);
        });
    });
    const response = this.apickli.getResponseObject();
    
    let containers = response.body;

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

    const container = containers.find(c => c.id === id);
    
    if (!container) {
        throw new Error(`Container with ID ${id} not found in current list`);
    }

    const currentVersion = container.image.tag.value;
    assert.notStrictEqual(currentVersion, oldVersion, `Container version expected to change from ${oldVersion}, but is still ${currentVersion}`);
});

function substituteVariables(str, apickli) {
    return str.replace(/{{([^}]*)}}/g, (match, p1) => {
        return apickli.getGlobalVariable(p1) || match;
    });
}

When(/^I send POST to (.*)$/, async function (url) {
    const safeUrl = substituteVariables(url, this.apickli);
    await new Promise((resolve, reject) => {
        this.apickli.post(safeUrl, (error, response) => {
            if (error) reject(error);
            else resolve(response);
        });
    });
});




Then(/^the container with image "([^"]*)" should have update available$/, async function (imageName) {
    const response = this.apickli.getResponseObject();
    let containers = response.body;

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
    const found = containers.find(c => {
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
