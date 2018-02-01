import winston  from 'winston'

import { config as bskConfig, network as bskNetwork } from 'blockstack'
import { initializeBlockstackCore, PAYER_SK, OWNER_SK, DEVELOP_DOMAIN } from './developmode'
import { makeHTTPServer } from './http'

const config = {
  logger: { transports: [
    new winston.transports.Console({
      level: 'info',
      handleExceptions: false,
      timestamp: true,
      stringify: true,
      colorize: true,
      json: false
    })
  ] },
  domainName: DEVELOP_DOMAIN,
  ownerKey: OWNER_SK,
  paymentKey: PAYER_SK,
  batchDelayPeriod: 0.5,
  checkTransactionPeriod: 0.1,
  dbLocation: '/tmp/subdomain_registrar.db',
  adminPassword: 'tester129',
  domainUri: 'file:///tmp/whatever',
  development: true
}

winston.configure(config.logger)

let initializationPromise = makeHTTPServer(config)

if (config.development) {
  bskConfig.network = bskNetwork.defaults.LOCAL_REGTEST
  initializationPromise = initializationPromise.then(
    (server) => {
      return initializeBlockstackCore(winston)
        .then(() => server)
    })
}

initializationPromise
  .then((server) => {
    server.listen(3000, () => {
      console.log('Subdomain registrar started')
    })
  })
