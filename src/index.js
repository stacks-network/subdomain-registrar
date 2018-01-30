import cors from 'cors'
import express from 'express'
import bodyParser from 'body-parser'
import winston  from 'winston'

import { config as bskConfig, network as bskNetwork } from 'blockstack'
import { SubdomainServer } from './server'
import { initializeBlockstackCore, PAYER_SK, OWNER_SK, DEVELOP_DOMAIN } from './developmode'

const HEADERS = { 'Content-Type': 'application/json' }

function makeHTTPServer(config) {
  const app = express()
  const server = new SubdomainServer(config)

  app.use(cors())
  app.use(bodyParser.json())

  app.get('/index', (req, res) => {
    res.writeHead(200, HEADERS)
    res.write(JSON.stringify(
      { status: true }))
    res.end()
  })

  app.post('/register', (req, res) => {
    config.logger.info('Received a registration request')
    const requestJSON = req.body
    if (!requestJSON) {
      res.writeHead(409, HEADERS)
      res.write(JSON.stringify(
        { status: false,
          message: 'Failed to parse your registration request: expected JSON' }))
      res.end()
    }

    server.queueRegistration(requestJSON.name,
                             requestJSON.owner_address,
                             0,
                             requestJSON.zonefile)
      .then(() => {
        res.writeHead(202, HEADERS)
        res.write(JSON.stringify(
          { status: true,
            message: 'Your subdomain registration was received, and will '
            + 'be included in the blockchain soon.' }))
        res.end()
      })
      .catch((err) => {
        config.logger.error(err)
        res.writeHead(409, HEADERS)
        res.write(JSON.stringify(
          { status: false,
            message: 'Failed to validate your registration request.' }))
        res.end()
      })
  })

  app.post('/issue_batch/', (req, res) => {
    const authHeader = req.headers.authorization
    if (!authHeader || authHeader !== `bearer ${config.adminPassword}`) {
      res.writeHead(401, HEADERS)
      res.write(JSON.stringify(
        { status: false,
          message: 'Unauthorized' }))
      res.end()
    } else {
      server.submitBatch()
        .catch(() => config.logger.error('Failed to broadcast batch.'))
      res.writeHead(202, HEADERS)
      res.write(JSON.stringify(
        {
          status: true,
          message: 'Starting batch.'
        }))
      res.end()
    }
  })

  app.post('/check_zonefiles/', (req, res) => {
    const authHeader = req.headers.authorization
    if (!authHeader || authHeader !== `bearer ${config.adminPassword}`) {
      res.writeHead(401, HEADERS)
      res.write(JSON.stringify(
        { status: false,
          message: 'Unauthorized' }))
      res.end()
    } else {
      server.checkZonefiles()
        .catch(() => config.logger.error('Failed to check our zonefiles.'))
      res.writeHead(202, HEADERS)
      res.write(JSON.stringify(
        {
          status: true,
          message: 'Checking zonefiles.'
        }))
      res.end()
    }
  })

  app.get('/status/:subdomain', (req, res) => {
    server.getSubdomainStatus(req.params.subdomain)
      .then((dbStatus) => {
        const respond = {
          subdomain: req.params.subdomain,
          status: dbStatus.status
        }
        if (dbStatus.status_more) {
          respond.status_more = dbStatus.status_more
        }
        res.writeHead(200, HEADERS)
        res.write(JSON.stringify(respond))
        res.end()
      })
      .catch(() => {
        res.writeHead(501, HEADERS)
        res.write(JSON.stringify(
          { status: false,
            message: 'There was an error processing your request.' }))
        res.end()
      })
  })

  return server.initializeServer()
    .then(() => app)
}

const config = {
  logger: new winston.Logger({ transports: [
    new winston.transports.Console({
      level: 'info',
      handleExceptions: false,
      timestamp: true,
      stringify: true,
      colorize: true,
      json: false
    })
  ] }),
  domainName: DEVELOP_DOMAIN,
  ownerKey: OWNER_SK,
  paymentKey: PAYER_SK,
  dbLocation: '/tmp/subdomain_registrar.db',
  adminPassword: 'tester129',
  development: true
}

let initializationPromise = makeHTTPServer(config)

if (config.development) {
  bskConfig.network = bskNetwork.defaults.LOCAL_REGTEST
  initializationPromise = initializationPromise.then(
    (server) => {
      return initializeBlockstackCore(config.logger)
        .then(() => server)
    })
}

initializationPromise
  .then((server) => {
    server.listen(3000, () => {
      console.log('Subdomain registrar started')
    })
  })
