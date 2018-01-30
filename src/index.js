import cors from 'cors'
import express from 'express'

function makeServer(config) {
  const app = express()

  app.use(cors())
  app.get('/index', (req, res) => {
    res.writeHead(200, {'Content-Type': 'application/json'})
    res.write(JSON.stringify(
      { status: true }))
    res.end()
  })

  return app
}


const server = makeServer()

server.listen(3000, function() {
  console.log('Subdomain registrar started')
})
