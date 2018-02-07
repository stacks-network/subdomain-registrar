import { PAYER_SK, OWNER_SK, DEVELOP_DOMAIN } from './developmode'
import winston from 'winston'
import fs from 'fs'

const configDevelopDefaults = {
  winstonConsoleTransport: {
      level: 'info',
      handleExceptions: false,
      timestamp: true,
      stringify: true,
      colorize: true,
      json: false
  },
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

const configDefaults = {
}


export function getConfig() {
  let config = Object.assign({}, configDefaults)
  if (process.env.BSK_SUBDOMAIN_DEVELOP) {
    config = Object.assign({}, configDevelopDefaults)
  }
  if (process.env.BSK_SUBDOMAIN_CONFIG) {
    const configFile = process.env.BSK_SUBDOMAIN_CONFIG
    Object.assign(config, JSON.parse(fs.readFileSync(configFile)))
  }

  config.winstonConfig = { transports: [
    new winston.transports.Console(config.winstonConsoleTransport)
  ] }

  return config
}
