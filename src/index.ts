#!/usr/bin/env node

import * as winston from 'winston';
import * as dotenv from 'dotenv';

dotenv.config();

import { initializeBlockstackCore, configureRegtest } from './developmode';
import { makeHTTPServer } from './http';
import { getConfig } from './config';
import { config as bskConfig } from 'blockstack';
import { StacksMainnet, StacksTestnet } from '@stacks/network';

if (process.env.BSK_SUBDOMAIN_TESTNET) {
  bskConfig.network = new StacksTestnet() as any;
} else {
  bskConfig.network = new StacksMainnet() as any;
}

const config = getConfig();

winston.configure(config.winstonConfig);

if (config.regtest) {
  configureRegtest();
}

let initializationPromise = makeHTTPServer(config).catch(err => {
  winston.error(err);
  winston.error(err.stack);
  throw err;
});

if (config.development) {
  initializationPromise = initializationPromise
    .then(server => {
      return initializeBlockstackCore().then(() => server);
    })
    .catch(err => {
      winston.error(err);
      winston.error(err.stack);
      throw err;
    });
}

initializationPromise.then(server => {
  server.listen(config.port, () => {
    console.log('Subdomain registrar started on', config.port);
  });
});
