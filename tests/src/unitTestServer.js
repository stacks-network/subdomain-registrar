import test from 'tape'
import nock from 'nock'

import { SubdomainServer } from '../../lib/server'

const testAddress = '1HnssYWq9L39JMmD7tgtW8QbJfZQGhgjnq'
const testSK = 'c14b3044ca7f31fc68d8fcced6b60effd350c280e7aa5c4384c6ef32c0cb129f01'

export function testSubdomainServer() {

  test('queueRegistration', (t) => {
    t.plan(7)
    nock.cleanAll()

    nock('https://core.blockstack.org')
      .persist()
      .get('/v1/names/foo.bar.id')
      .reply(200, {})

    nock('https://core.blockstack.org')
      .persist()
      .get('/v1/names/bar.bar.id')
      .reply(404, {})

    nock('https://core.blockstack.org')
      .persist()
      .get('/v1/names/tar.bar.id')
      .reply(404, {})

    let s = new SubdomainServer({ domainName: 'bar.id',
                                  ownerKey: testSK,
                                  paymentKey: testSK,
                                  dbLocation: ':memory:',
                                  domainUri: 'http://myfreewebsite.com' })
    s.initializeServer()
      .then(
        () =>
          s.queueRegistration('foo', testAddress, 0, 'hello-world')
          .then(() => t.ok(false, 'foo.foo.id should not be a valid id to queue'))
          .catch((err) => {
            t.equal(err.message, 'Subdomain operation already queued for this name.',
                    'foo.foo.id should not be a valid id to queue') }))
      .then(
        () =>
          s.queueRegistration('bar', 'm123', 0, 'hello-world')
          .then(() => t.ok(false, 'should not queue with a bad address'))
          .catch((err) => t.equal(err.message, 'Requested subdomain operation is invalid.',
                                  'should not queue with a bad address')))
      .then(
        () =>
          s.queueRegistration('bar', testAddress, 0, 'hello-world')
          .then(() => t.ok(true, 'should queue bar.bar.id'))
          .catch((err) => { console.log(err.stack)
                            t.ok(false, 'should be able to queue bar.bar.id') }))
      .then(
        () =>
          s.getSubdomainStatus('bar')
          .then((x) =>
                t.ok(x.status.startsWith('Subdomain is queued for update', 'bar.bar.id should be queued'))))
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

    })


  test('submitBatch', (t) => {
    t.plan(7)
    nock.cleanAll()

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
      .get(`/unspent?format=json&active=${testAddress}`)
      .reply(200, {unspent_outputs:
                   [ { value: 10000,
                       tx_output_n: 1,
                       confirmations: 100,
                       tx_hash_big_endian: '3387418aaddb4927209c5032f515aa442a6587d6e54677f08a03b8fa7789e688' },
                     { value: 10000,
                       tx_output_n: 2,
                       confirmations: 100,
                       tx_hash_big_endian: '3387418aaddb4927209c5032f515aa442a6587d6e54677f08a03b8fa7789e688' }]})

    nock('https://blockchain.info')
      .persist()
      .post('/pushtx?cors=true')
      .reply(200, 'transaction Submitted')

    nock('https://core.blockstack.org')
      .get('/v1/blockchains/bitcoin/consensus')
      .reply(200, { consensus_hash: 'dfe87cfd31ffa2a3b8101e3e93096f2b' })


    let s = new SubdomainServer({ domainName: 'bar.id',
                                  ownerKey: testSK,
                                  paymentKey: testSK,
                                  dbLocation: ':memory:',
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
          s.queueRegistration('bar', testAddress, 0, 'hello-world')
          .then(() => t.ok(true, 'should queue bar.bar.id')))
      .then(() => {
        // make it so that foo.bar.id is now *not* valid to register
        nock('https://core.blockstack.org')
          .get('/v1/names/foo.bar.id')
          .times(1)
          .reply(200, {})
      })
      .then(() => s.lock.writeLock((release) => {
        s.submitBatch()
          .then(() => t.ok(false, 'Shouldnt have gotten lock'))
          .catch((err) => {
            t.equal(err.message, 'Failed to obtain lock')
            release()
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
      }))

    })
}
