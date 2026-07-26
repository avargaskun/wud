import { Before, setDefaultTimeout } from '@cucumber/cucumber';
const apickli = require('apickli');
import configuration from '../../config';

setDefaultTimeout(60 * 1000);

Before(function (this: any) {
    this.apickli = new apickli.Apickli(configuration.protocol, `${configuration.host}:${configuration.port}`);
    this.apickli.addHttpBasicAuthorizationHeader(configuration.username, configuration.password);
});
