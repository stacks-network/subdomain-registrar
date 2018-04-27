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
  zonefileSize: 40960,
  development: false,
  port: 3000,
  regtest: true,
  ipLimit: 0,
  apiKeys: [],
  proofsRequired: 0,
  disableRegistrationsWithoutKey: false
}

const configDefaults = {
  winstonConsoleTransport: {
      level: 'info',
      handleExceptions: false,
      timestamp: true,
      stringify: true,
      colorize: true,
      json: false
  },
  domainName: null,
  ownerKey: null,
  paymentKey: null,
  // submit batch (if has updates) every 15 minutes
  batchDelayPeriod: 15,
  // check if zonefiles can be broadcasted every 5 minutes
  checkTransactionPeriod: 5,
  zonefileSize: 40960,
  dbLocation: '/root/subdomain_registrar.db',
  adminPassword: 'NEEDS-A-PASSWORD',
  domainUri: 'https://registrar.whatever.com',
  port: 3000,
  ipLimit: 1,
  apiKeys: [],
  proofsRequired: 0,
  disableRegistrationsWithoutKey: false
}


export function getConfig() {
  let config = Object.assign({}, configDefaults)
  if (process.env.BSK_SUBDOMAIN_DEVELOP) {
    config = Object.assign({}, configDevelopDefaults)
    config.development = true
  }
  if (process.env.BSK_SUBDOMAIN_REGTEST) {
    config = Object.assign({}, configDevelopDefaults)
  }
  if (process.env.BSK_SUBDOMAIN_CONFIG) {
    const configFile = process.env.BSK_SUBDOMAIN_CONFIG
    Object.assign(config, JSON.parse(fs.readFileSync(configFile)))
  }
  if (process.env.BSK_SUBDOMAIN_PAYMENT_KEY) {
    config.paymentKey = process.env.BSK_SUBDOMAIN_PAYMENT_KEY
  }
  if (process.env.BSK_SUBDOMAIN_OWNER_KEY) {
    config.ownerKey = process.env.BSK_SUBDOMAIN_OWNER_KEY
  }

  config.winstonConfig = { transports: [
    new winston.transports.Console(config.winstonConsoleTransport)
  ] }

  return config
}
