import test from 'tape'
import nock from 'nock'

import { SubdomainServer } from '../../lib/server'

const testAddress = '1HnssYWq9L39JMmD7tgtW8QbJfZQGhgjnq'
const testAddress2 = '1xME6Dp5boMe4xDxAJn1Gaat7d3k5hhdE'
const testAddress3 = '1LmH1r8K62yZEjBtpbwU94yT3jLhLMiR1M'
const testSK = 'c14b3044ca7f31fc68d8fcced6b60effd350c280e7aa5c4384c6ef32c0cb129f01'
const testSK2 = '849bef09aa15c0e87ab55237fa4e45a0a6dfc0a7c698c9a8b6d193e1c1fae6db01'

function dbRun(db: Object, cmd: String, args?: Array) {
  if (!args) {
    args = []
  }
  return new Promise((resolve, reject) => {
    db.run(cmd, args, (err) => {
      if (err) {
        reject(err)
      } else {
        resolve()
      }
    })
  })
}

export function testSubdomainServer() {

  test('queueRegistration', (t) => {
    t.plan(23)
    nock.cleanAll()

    nock('https://core.blockstack.org')
      .persist()
      .get('/v1/names/foo.bar.id')
      .reply(200, { status: 'registered_subdomain'})

    nock('https://core.blockstack.org')
      .persist()
      .get('/v1/names/bar.bar.id')
      .reply(404, {})

    nock('https://core.blockstack.org')
      .persist()
      .get('/v1/names/ba.bar.id')
      .reply(404, {})

    nock('https://core.blockstack.org')
      .persist()
      .get('/v1/names/car.bar.id')
      .reply(404, {})

    nock('https://core.blockstack.org')
      .persist()
      .get('/v1/names/tar.bar.id')
      .reply(404, {})

    let s = new SubdomainServer({ domainName: 'bar.id',
                                  ownerKey: testSK,
                                  paymentKey: testSK,
                                  dbLocation: ':memory:',
                                  domainUri: 'http://myfreewebsite.com',
                                  ipLimit: 1,
                                  proofsRequired: 0,
                                  apiKeys: ['abcdefghijk'],
                                  zonefileSize: 4096,
                                  nameMinLength: 3})
    s.initializeServer()
      .then(
        () =>
          s.queueRegistration('foo', testAddress, 0, 'hello-world', 'foo')
          .then(() => t.ok(false, 'foo.foo.id should not be a valid id to queue'))
          .catch((err) => {
            t.equal(err.message, 'Subdomain operation already queued for this name.',
                    'foo.foo.id should not be a valid id to queue') }))
      .then(
        () =>
          s.queueRegistration('bar', 'm123', 0, 'hello-world', 'bar')
          .then(() => t.ok(false, 'should not queue with a bad address'))
          .catch((err) => t.equal(err.message, 'Requested subdomain operation is invalid.',
                                  'should not queue with a bad address')))
      .then(
        () =>
          s.queueRegistration('bar', testAddress, 0, 'hello-world', 'foo')
          .then(() => t.ok(true, 'should queue bar.bar.id'))
          .catch((err) => { console.log(err.stack)
                            t.ok(false, 'should be able to queue bar.bar.id') }))
      .then(
        () =>
          s.queueRegistration('ba', testAddress2, 0, 'hello-world', 'foo')
          .then(() => t.ok(false, 'should not queue ba.bar.id because ba is too short'))
          .catch((err) => { console.log(err.stack)
                            t.ok(true, 'should not be able to queue ba.bar.id') }))
      .then(
        () =>
          s.queueRegistration('car', testAddress, 0, 'hello-world', 'foo')
          .then(() => t.ok(false, 'should not queue with a reused owner address'))
          .catch((err) => t.ok(err.message.startsWith('Owner', 'should not queue with same owner address'))))
      .then(
        () =>
          s.queueRegistration('car', testAddress2, 0, 'hello-world', 'foo')
          .then(() => t.ok(false, 'should not queue with a reused ip address'))
          .catch((err) => t.ok(err.message.startsWith('IP', 'should not queue with same IP address'))))
      .then(
        () =>
          s.spamCheck('car', testAddress2, 'hello-world', 'foo', 'bearer abcdefghijk')
          .then((res) => t.notOk(res, 'should pass spam check when using authorization bearer token')))
      .then(
        () =>
          s.getSubdomainStatus('bar')
          .then((x) =>
                t.ok(x.status.startsWith('Subdomain is queued for update'), 'bar.bar.id should be queued')))
      .then(
        () =>
          s.updateQueueStatus(['bar'], 'txhash'))
      .then(
        () =>
          s.getSubdomainStatus('bar')
          .then((x) =>
                t.ok(x.status.startsWith('Your subdomain was registered in transaction'),
                     `status should update, but was still: ${x.status}`)))
      .then(
        () =>
          s.getSubdomainStatus('foo')
          .then((x) =>
                t.ok(x.status.startsWith('Subdomain propagated', 'foo.bar.id should be queued'))))
      .then(
        () =>
          s.getSubdomainStatus('tar')
          .then((x) =>
                t.ok(x.status.startsWith('Subdomain not registered', 'tar.bar.id should not be queued'))))
      .then(
        () =>
          s.getSubdomainInfo('bar.bar.id')
          .then(resp =>
                {
                  t.equal(resp.message.status, 'submitted_subdomain')
                  t.equal(resp.message.address, testAddress)
                  t.equal(resp.message.last_txid, 'txhash')
                }))
      .then(
        () =>
          s.getSubdomainInfo('tar.bar.id')
          .then(resp => t.equal(resp.statusCode, 404)))
      .then(
        () =>
          s.getSubdomainInfo('ba.bar.id')
          .then(resp => t.equal(resp.statusCode, 400)))
      .then(
        () => {
          // insert a dummy stale one.
          const time = 500
          const dbCmd = 'INSERT INTO subdomain_queue ' +
                '(subdomainName, owner, sequenceNumber, zonefile, status, received_ts)' +
                ' VALUES (?, ?, ?, ?, ?, DATETIME(?, "unixepoch"))'
          const dbArgs = ['shouldNotList', 'whatever', '54', 'zone', 'received', time]

          return dbRun(s.db.db, dbCmd, dbArgs)
        })
      .then(
        () =>
          s.listSubdomainRecords(0)
          .then(response => {
            const listing = response.message
            t.equal(listing.length, 1, 'Should list 1 subdomain')
            t.equal(listing[0].name, 'bar.bar.id', 'Should have bar in listing')
            t.equal(listing[0].address, testAddress, 'Should have bar owned by the right addr')
            t.equal(listing[0].sequence, 0, 'should have 0 sequence number')
            t.equal(listing[0].zonefile, 'hello-world', 'should have correct zonefile')
            t.equal(listing[0].status, 'submitted', 'should have correct status')
          }))
      .then(
        () =>
          // past the iterator.
          s.listSubdomainRecords(parseInt(2))
          .then(listing => listing.message)
          .then(listing => t.equal(listing.length, 0, 'Should list 0 subdomains')))
      .catch( (err) => { console.log(err.stack) } )
  })

  test('apiKeyOnly', (t) => {
    t.plan(2)
    nock.cleanAll()

    nock('https://core.blockstack.org')
      .persist()
      .get('/v1/names/bar.bar.id')
      .reply(404, {})

    let s = new SubdomainServer({ domainName: 'bar.id',
                                  ownerKey: testSK,
                                  paymentKey: testSK,
                                  dbLocation: ':memory:',
                                  domainUri: 'http://myfreewebsite.com',
                                  ipLimit: 1,
                                  proofsRequired: 0,
                                  disableRegistrationsWithoutKey: true,
                                  apiKeys: ['abcdefghijk'],
                                  zonefileSize: 4096 })
    s.initializeServer()
      .then(
        () =>
          s.queueRegistration('bar', testAddress, 0, 'hello-world', 'foo')
          .then(() => t.ok(false, 'should not queue bar.bar.id'))
          .catch((err) => { console.log(err.stack)
                            t.ok(true, 'should not be able to queue bar.bar.id') }))
      .then(
        () =>
          s.spamCheck('bar', testAddress, 'hello-world', 'foo', 'bearer abcdefghijk')
          .then((res) => t.notOk(res, 'should pass spam check when using authorization bearer token')))
    })

  test('submitBatch', (t) => {
    t.plan(7)
    nock.cleanAll()

    nock('https://core.blockstack.org')
      .persist()
      .get('/v1/names/bar.id')
      .reply(200, { address: '1HnssYWq9L39JMmD7tgtW8QbJfZQGhgjnq' })

    nock('https://core.blockstack.org')
      .get('/v1/names/foo.bar.id')
      .times(2)
      .reply(404, {})

    nock('https://core.blockstack.org')
      .persist()
      .get('/v1/names/bar.bar.id')
      .reply(404, {})


    nock('https://bitcoinfees.earn.com')
      .get('/api/v1/fees/recommended')
      .reply(200, {fastestFee: 10})

    nock('https://blockchain.info')
      .persist()
      .get(`/unspent?format=json&active=${testAddress}&cors=true`)
      .reply(200, {unspent_outputs:
                   [ { value: 10000,
                       tx_output_n: 1,
                       confirmations: 100,
                       tx_hash_big_endian: '3387418aaddb4927209c5032f515aa442a6587d6e54677f08a03b8fa7789e688' }]})
      
    nock('https://blockchain.info')
      .persist()
      .get(`/unspent?format=json&active=${testAddress2}&cors=true`)
      .reply(200, {unspent_outputs:
                   [ { value: 10000,
                       tx_output_n: 2,
                       confirmations: 100,
                       tx_hash_big_endian: 'c6c3f4d5d94ae7cd980645316c02ea725b77a91121a707faac34ffdd540fd67d' }]})

    nock('https://blockchain.info')
      .persist()
      .post('/pushtx?cors=true')
      .reply(200, 'transaction Submitted')

    nock('https://core.blockstack.org')
      .get('/v1/blockchains/bitcoin/consensus')
      .reply(200, { consensus_hash: 'dfe87cfd31ffa2a3b8101e3e93096f2b' })


    let s = new SubdomainServer({ domainName: 'bar.id',
                                  ownerKey: testSK,
                                  paymentKey: testSK2,
                                  dbLocation: ':memory:',
                                  ipLimit: 0,
                                  proofsRequired: 0,
                                  zonefileSize: 4096,
                                  domainUri: 'http://myfreewebsite.com' })
    s.initializeServer()
      .then(() => s.submitBatch())
      .then((resp) => t.equal(resp, null, 'should skip submission of an empty batch'))
      .then(
        () =>
          s.queueRegistration('foo', testAddress, 0, 'hello-world')
          .then(() => t.ok(true, 'foo.foo.id should be queued')))
      .then(
        () =>
          s.queueRegistration('bar', testAddress2, 0, 'hello-world')
          .then(() => t.ok(true, 'should queue bar.bar.id')))
      .then(() => {
        // make it so that foo.bar.id is now *not* valid to register
        nock('https://core.blockstack.org')
          .get('/v1/names/foo.bar.id')
          .times(1)
          .reply(200, { status: 'registered_subdomain'})
      })
      .then(() => {
        const acquiredWait = s.lock.acquire('queue', () => {
          return new Promise(resolve => {
            setTimeout(() => resolve(), 5000)
          })
        })

        const failureBatch = s.submitBatch()
              .then(() => t.ok(false, 'Shouldnt have gotten lock'))
              .catch((err) => {
                t.equal(err.message, 'Failed to obtain lock')
              })

        return Promise.all([acquiredWait, failureBatch])
      })
      .then(() => s.submitBatch())
      .then(() => t.ok(true, 'Should have submitted a batch'))
      .catch(() => t.ok(false, 'Should not have failed'))
      .then(() => {
        nock('https://core.blockstack.org')
          .get('/v1/names/foo.bar.id')
          .times(1)
          .reply(404, {})
      })
      .then(() => s.getSubdomainStatus('bar')
            .then((x) =>
                  t.ok(x.status.startsWith('Your subdomain was registered in transaction'),
                       `status should update, but was still: ${x.status}`)))
      .then(() => s.getSubdomainStatus('foo')
            .then((x) =>
                  t.ok(x.status.startsWith('Subdomain is queued'),
                       `foo.bar.id should still be queued for update`)))
  })

  test('submitBatch not owned', (t) => {
    t.plan(7)
    nock.cleanAll()

    nock('https://core.blockstack.org')
      .persist()
      .get('/v1/names/bar.id')
      .reply(200, { address: '16LToaDSxQaar4LBbdgQpq2vn2FbFMcpuP' })

    nock('https://core.blockstack.org')
      .get('/v1/names/foo.bar.id')
      .times(2)
      .reply(404, {})

    nock('https://core.blockstack.org')
      .persist()
      .get('/v1/names/bar.bar.id')
      .reply(404, {})


    nock('https://bitcoinfees.earn.com')
      .get('/api/v1/fees/recommended')
      .reply(200, {fastestFee: 10})

    nock('https://blockchain.info')
      .persist()
      .get(`/unspent?format=json&active=${testAddress}&cors=true`)
      .reply(200, {unspent_outputs:
                   [ { value: 10000,
                       tx_output_n: 1,
                       confirmations: 100,
                       tx_hash_big_endian: '3387418aaddb4927209c5032f515aa442a6587d6e54677f08a03b8fa7789e688' }]})

    nock('https://blockchain.info')
      .persist()
      .get(`/unspent?format=json&active=${testAddress2}&cors=true`)
      .reply(200, {unspent_outputs:
                   [ { value: 10000,
                       tx_output_n: 2,
                       confirmations: 100,
                       tx_hash_big_endian: 'c6c3f4d5d94ae7cd980645316c02ea725b77a91121a707faac34ffdd540fd67d' }]})

    nock('https://blockchain.info')
      .persist()
      .post('/pushtx?cors=true')
      .reply(200, 'transaction Submitted')

    nock('https://core.blockstack.org')
      .get('/v1/blockchains/bitcoin/consensus')
      .reply(200, { consensus_hash: 'dfe87cfd31ffa2a3b8101e3e93096f2b' })


    let s = new SubdomainServer({ domainName: 'bar.id',
                                  ownerKey: testSK,
                                  paymentKey: testSK2,
                                  dbLocation: ':memory:',
                                  zonefileSize: 4096,
                                  ipLimit: 0,
                                  proofsRequired: 0,
                                  domainUri: 'http://myfreewebsite.com' })
    s.initializeServer()
      .then(() => s.submitBatch())
      .then((resp) => t.equal(resp, null, 'should skip submission of an empty batch'))
      .then(
        () =>
          s.queueRegistration('foo', testAddress, 0, 'hello-world')
          .then(() => t.ok(true, 'foo.foo.id should be queued')))
      .then(
        () =>
          s.queueRegistration('bar', testAddress2, 0, 'hello-world')
          .then(() => t.ok(true, 'should queue bar.bar.id')))
      .then(() => {
        // make it so that foo.bar.id is now *not* valid to register
        nock('https://core.blockstack.org')
          .get('/v1/names/foo.bar.id')
          .times(1)
          .reply(200, {})
      })
      .then(() => {
        const acquiredWait = s.lock.acquire('queue', () => {
          return new Promise(resolve => {
            setTimeout(() => resolve(), 5000)
          })
        })

        const failureBatch = s.submitBatch()
              .then(() => t.ok(false, 'Shouldnt have gotten lock'))
              .catch((err) => {
                t.equal(err.message, 'Failed to obtain lock')
              })

        return Promise.all([acquiredWait, failureBatch])
      })
      .then(() => s.submitBatch())
      .then(() => t.ok(false, 'Should not have submitted a batch'))
      .catch(() => t.ok(true, 'Should have failed'))
      .then(() => {
        nock('https://core.blockstack.org')
          .get('/v1/names/foo.bar.id')
          .times(1)
          .reply(404, {})
      })
      .then(() => s.getSubdomainStatus('bar')
            .then((x) =>
                  t.ok(x.status.startsWith('Subdomain is queued'),
                       `bar.bar.id should still be queued for update`)))
      .then(() => s.getSubdomainStatus('foo')
            .then((x) =>
                  t.ok(x.status.startsWith('Subdomain is queued'),
                       `foo.bar.id should still be queued for update`)))
  })
}
