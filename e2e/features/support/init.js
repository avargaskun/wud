const apickli = require('apickli');
const { Before, setDefaultTimeout } = require('@cucumber/cucumber');
const configuration = require('../../config');

setDefaultTimeout(60 * 1000);

Before(function initApickli() {
    this.apickli = new apickli.Apickli(configuration.protocol, `${configuration.host}:${configuration.port}`);
    this.apickli.addHttpBasicAuthorizationHeader(configuration.username, configuration.password);
    this.apickli.setGlobalVariable('ECR_REGISTRY_URL', configuration.ecrRegistryUrl);
    this.apickli.setGlobalVariable('ECR_IMAGE_NAME', configuration.ecrImageName);
    this.apickli.setGlobalVariable('ACR_CLIENT_ID', configuration.acrClientId);
    this.apickli.setGlobalVariable('AWS_REGION', configuration.awsRegion);
});
