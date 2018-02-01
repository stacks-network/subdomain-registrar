import winston  from 'winston'

import { initializeBlockstackCore, PAYER_SK, OWNER_SK, DEVELOP_DOMAIN } from './developmode'
import { makeHTTPServer } from './http'
import { getConfig } from './config'

const config = getConfig()

winston.configure(config.winstonConfig)

let initializationPromise = makeHTTPServer(config)
    .catch((err) => {
      winston.error(err)
      winston.error(err.stack)
      throw err
    })

if (config.development) {
  initializationPromise = initializationPromise.then(
    (server) => {
      return initializeBlockstackCore()
        .then(() => server)
    })
    .catch((err) => {
      winston.error(err)
      winston.error(err.stack)
      throw err
    })
}

initializationPromise
  .then((server) => {
    server.listen(3000, () => {
      console.log('Subdomain registrar started')
    })
  })
