import cors from 'cors'
import express from 'express'
import { SubdomainServer } from './server'
import bodyParser from 'body-parser'

const HEADERS = { 'Content-Type': 'application/json' }

function makeServer(config) {
  const app = express()
  const server = new SubdomainServer(config.domainName,
                                     config.ownerKey,
                                     config.paymentKey)

  app.use(cors())
  app.use(bodyParser.json())

  app.get('/index', (req, res) => {
    res.writeHead(200, HEADERS)
    res.write(JSON.stringify(
      { status: true }))
    res.end()
  })

  app.post('/register', (req, res) => {
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
      .catch(() => {
        res.writeHead(409, HEADERS)
        res.write(JSON.stringify(
          { status: false,
            message: 'Failed to validate your registration request.' }))
        res.end()
      })
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

  return app
}


const server = makeServer()

server.listen(3000, () => {
  console.log('Subdomain registrar started')
})
