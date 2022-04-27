import test from 'tape'
import nock from 'nock'

import { SubdomainServer } from '../../lib/server'
const bns = require('./../bns.json')

const testAddress = 'SP2ZRX0K27GW0SP3GJCEMHD95TQGJMKB7GB36ZAR0'
const testAddress2 = 'ST26FVX16539KKXZKJN098Q08HRX3XBAP541MFS0P'
const testAddress3 = 'ST3CECAKJ4BH08JYY7W53MC81BYDT4YDA5M7S5F53'
const testSK = 'b8d99fd45da58038d630d9855d3ca2466e8e0f89d3894c4724f0efc9ff4b51f001'
const testSK2 = '3a4e84abb8abe0c1ba37cef4b604e73c82b1fe8d99015cb36b029a65099d373601'

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
    t.plan(26)
    nock.cleanAll()

    nock('https://core.blockstack.org')
      .get('/v2/info')
      .reply(200, { burn_block_height: 300 })

    nock('https://core.blockstack.org')
      .persist()
      .get('/v1/names/foo.bar.id')
      .reply(200, { status: 'registered_subdomain' })

    nock('https://core.blockstack.org')
      .persist()
      .get('/v1/names/bar.bar.id')
      .reply(200, {})

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

    nock('https://core.blockstack.org')
      .persist()
      .get('/v1/names/ipwhitelisted0.bar.id')
      .reply(404, {})
    nock('https://core.blockstack.org')
      .persist()
      .get('/v1/names/ipwhitelisted1.bar.id')
      .reply(404, {})
    nock('https://core.blockstack.org')
      .persist()
      .get('/v1/names/ipwhitelisted2.bar.id')
      .reply(404, {})

    const s = new SubdomainServer({
      domainName: 'bar.id',
      ownerKey: testSK,
      paymentKey: testSK,
      dbLocation: ':memory:',
      domainUri: 'http://myfreewebsite.com',
      ipLimit: 1,
      ipWhitelist: ['whitelisted-ip-addr'],
      proofsRequired: 0,
      checkCoreOnBatching: true,
      apiKeys: ['abcdefghijk'],
      zonefileSize: 4096,
      nameMinLength: 3
    })
    s.initializeServer()
      .then(
        () =>
          s.queueRegistration('foo', testAddress, 0, 'hello-world', 'foo')
            .then(() => t.ok(false, 'foo.foo.id should not be a valid id to queue'))
            .catch((err) => {
              t.equal(err.message,
                'Requested subdomain operation is invalid.')
            }))
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
            .catch((err) => {
              console.log(err)
              console.log(err.stack)
              t.ok(false, 'should be able to queue bar.bar.id')
            }))
      .then(
        () =>
          s.queueRegistration('ba', testAddress2, 0, 'hello-world', 'foo')
            .then(() => t.ok(false, 'should not queue ba.bar.id because ba is too short'))
            .catch((err) => {
              console.log(err.stack)
              t.ok(true, 'should not be able to queue ba.bar.id')
            }))
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
            .then(resp => {
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
      .then(
        () =>
          s.queueRegistration('ipwhitelisted0', 'ST31HHVBKYCYQQJ5AQ25ZHA6W2A548ZADDQ6S16GP',
            0, 'hello-world-zonefile', 'whitelisted-ip-addr')
            .then(() => t.ok(true, 'should queue first whitelisted address'))
            .catch((err) => {
              console.log(err.stack)
              t.ok(false, 'should be able to queue')
            }))
      .then(
        () =>
          s.queueRegistration('ipwhitelisted1', 'ST15RR51GKMB5A52GP5XRT1KT9B42M7NF2VHYS96F',
            0, 'hello-world-zonefile', 'whitelisted-ip-addr')
            .then(() => t.ok(true, 'should queue 2nd whitelisted address'))
            .catch((err) => {
              console.log(err.stack)
              t.ok(false, 'should be able to queue')
            }))
      .then(
        () =>
          s.queueRegistration('ipwhitelisted2', 'ST6HQACZN5HN9RNK57PK4MH84GT3EV9FW5A6MA6G',
            0, 'hello-world-zonefile', 'whitelisted-ip-addr')
            .then(() => t.ok(true, 'should queue 3rd whitelisted address'))
            .catch((err) => {
              console.log(err.stack)
              t.ok(false, 'should be able to queue')
            }))

      .catch((err) => { console.log(err.stack) })
  })

  test('apiKeyOnly', (t) => {
    t.plan(2)
    nock.cleanAll()

    nock('https://core.blockstack.org')
      .persist()
      .get('/v1/names/bar.bar.id')
      .reply(404, {})

    nock('https://core.blockstack.org')
      .persist()
      .get('/v2/info')
      .reply(200, { burn_block_height: 300 })

    const s = new SubdomainServer({
      domainName: 'bar.id',
      ownerKey: testSK,
      paymentKey: testSK,
      dbLocation: ':memory:',
      domainUri: 'http://myfreewebsite.com',
      ipLimit: 1,
      proofsRequired: 0,
      disableRegistrationsWithoutKey: true,
      checkCoreOnBatching: true,
      apiKeys: ['abcdefghijk'],
      zonefileSize: 4096
    })
    s.initializeServer()
      .then(
        () =>
          s.queueRegistration('bar', testAddress, 0, 'hello-world', 'foo')
            .then(() => t.ok(false, 'should not queue bar.bar.id'))
            .catch((err) => {
              console.log(err.stack)
              t.ok(true, 'should not be able to queue bar.bar.id')
            }))
      .then(
        () =>
          s.spamCheck('bar', testAddress2, 'hello-world', 'foo', 'bearer abcdefghijk')
            .then((res) => t.notOk(res, 'should pass spam check when using authorization bearer token')))
  })

  test('submitBatch', async (t) => {
    t.plan(11)
    nock.cleanAll()

    nock('https://core.blockstack.org')
      .persist()
      .get('/v1/names/bar.id')
      .reply(200, { address: testAddress })

    nock('https://core.blockstack.org')
      .get('/v1/names/foo.bar.id')
      .times(2)
      .reply(404, {})

    nock('https://core.blockstack.org')
      .persist()
      .get('/v1/names/bar.bar.id')
      .reply(404, {})

    nock('https://core.blockstack.org')
      .get('/v2/info')
      .reply(200, { burn_block_height: 300 })

    const s = new SubdomainServer({
      domainName: 'bar.id',
      ownerKey: testSK,
      paymentKey: testSK2,
      dbLocation: ':memory:',
      ipLimit: 0,
      checkCoreOnBatching: true,
      proofsRequired: 0,
      zonefileSize: 4096,
      minBatchSize: 2,
      domainUri: 'http://myfreewebsite.com'
    })
    await s.initializeServer()
    let resp = await s.submitBatch()
    t.equal(resp, null, 'should skip submission of an empty batch')
    await s.queueRegistration('foo', testAddress, 0, 'hello-world')
    t.pass('foo.bar.id should be queued')
    resp = await s.submitBatch()
    t.equal(resp, null, 'should skip submission of a size 1 batch')
    await s.queueRegistration('bar', testAddress2, 0, 'hello-world')
    t.pass('should queue bar.bar.id')

    // change batch size back to 1!
    s.minBatchSize = 1

    // make it so that foo.bar.id is now *not* valid to register
    nock('https://core.blockstack.org')
      .get('/v1/names/foo.bar.id')
      .times(1)
      .reply(200, { status: 'registered_subdomain' })

    nock('https://core.blockstack.org')
      .post('/v2/transactions')
      .reply(200, '"ab5378426571ba323d40d540cdb1a01ce7c2e9452a89d11b242a39269c5bf21f"')


    const acquiredWait = s.lock.acquire('queue', () => {
      return new Promise(resolve => {
        setTimeout(() => resolve(), 9000)
      })
    })

    const failureBatch = s.submitBatch()
      .then(() => t.ok(false, 'Shouldnt have gotten lock'))
      .catch((err) => {
        t.equal(err.message, 'Failed to obtain lock')
      })
    await Promise.all([acquiredWait, failureBatch])

    nock('https://core.blockstack.org')
      .get('/v2/contracts/interface/ST000000000000000000002AMW42H/bns')
      .times(2)
      .reply(200, bns)

    nock('https://core.blockstack.org')
      .get('/v2/fees/transfer')
      .times(2)
      .reply(200, 1)

    nock('https://core.blockstack.org')
      .get('/v2/accounts/SP26FVX16539KKXZKJN098Q08HRX3XBAP55F6QR13?proof=0')
      .times(2)
      .reply(200, {
        balance: '0x00000000000000000000000000000000',
        locked: '0x00000000000000000000000000000000',
        unlock_height: 0,
        nonce: 0,
        balance_proof: '',
        nonce_proof: ''
      })

    nock('https://core.blockstack.org')
      .get('/v1/names/foo.bar.id')
      .times(1)
      .reply(400, { status: 'registered_subdomain' })

    const b = await s.submitBatch()
    const expected_tx = 'ab5378426571ba323d40d540cdb1a01ce7c2e9452a89d11b242a39269c5bf21f'
    t.equal(b, expected_tx)

    nock('https://core.blockstack.org')
      .post('/v2/transactions')
      .reply(400, '{"error": "transaction rejected", "reason": "not enough funds"}')

    await s.submitBatch()
      .catch((err)=>{
        const expected_error = 'Error post transaction: {"error":"transaction rejected","reason":"not enough funds"}'
        t.equal(err.message, expected_error)
     })

    nock('https://core.blockstack.org')
      .get('/v1/names/foo.bar.id')
      .times(1)
      .reply(404, { status: 'registered_subdomain' })


    let x = await s.getSubdomainStatus('bar')
    t.ok(x.status.startsWith('Your subdomain was registered in transaction'),
      `status should update, but was still: ${x.status}`)
    x = await s.getSubdomainStatus('foo')
    t.ok(x.status.startsWith('Subdomain is queued'),
      `foo.bar.id should still be queued for update, was: ${x.status}`)

    nock('https://core.blockstack.org')
      .get('/v2/info')
      .times(1)
      .reply(200, { burn_block_height: 300 })

    nock('https://core.blockstack.org')
      .persist()
      .get(`/extended/v1/tx/${expected_tx}`)
      .reply(200, { block_height: 300 })

    await s.checkZonefiles() //todo

    t.equal((await s.db.getTrackedTransactions()).length, 1, 'Should still be tracking 1 transaction')

    nock('https://core.blockstack.org')
      .get('/v2/info')
      .times(1)
      .reply(200, { burn_block_height: 310 })

    await s.checkZonefiles()

    t.equal((await s.db.getTrackedTransactions()).length, 0, 'Should have finished 1 transaction')
  })

  test('shutdown', async (t) => {
    t.plan(1)

    nock('https://core.blockstack.org')
      .get('/v2/info')
      .reply(200, { burn_block_height: 300 })

    const s = new SubdomainServer({
      domainName: 'bar.id',
      ownerKey: testSK,
      paymentKey: testSK2,
      dbLocation: ':memory:',
      zonefileSize: 4096,
      checkCoreOnBatching: true,
      ipLimit: 0,
      proofsRequired: 0,
      domainUri: 'http://myfreewebsite.com'
    })
    await s.initializeServer()
    try {
      await s.shutdown()
      t.ok(true, 'should shut down')
    } catch (e) {
      console.log(e)
      t.ok(false, 'failed to shut down')
    }
  })

  test('submitBatch not owned', async (t) => {
    t.plan(12)
    nock.cleanAll()

    nock('https://core.blockstack.org')
      .persist()
      .get('/v2/info')
      .reply(200, { height: 300 })

    nock('https://core.blockstack.org')
      .persist()
      .get('/v1/names/bar.id')
      .reply(200, { address: 'ST30ZKFVB3NYTA5RWPFGK9MJ6XZDRQ5SY3QDY51RD' })

    nock('https://core.blockstack.org')
      .persist()
      .get('/v1/names/foo.bar.id')
      .reply(404, {})

    nock('https://core.blockstack.org')
      .persist()
      .get('/v1/names/alice.bar.id')
      .reply(404, {})

    nock('https://core.blockstack.org')
      .persist()
      .get('/v1/names/fo.bar.id')
      .reply(404, {})

    nock('https://core.blockstack.org')
      .persist()
      .get('/v1/names/bar.bar.id')
      .reply(404, {})


    const s = new SubdomainServer({
      domainName: 'bar.id',
      ownerKey: testSK,
      paymentKey: testSK2,
      dbLocation: ':memory:',
      zonefileSize: 4096,
      nameMinLength: 3,
      checkCoreOnBatching: true,
      ipLimit: 0,
      proofsRequired: 0,
      domainUri: 'http://myfreewebsite.com'
    })

    await s.initializeServer()
    const resp = await s.submitBatch()
    t.equal(resp, null, 'should skip submission of an empty batch')
    try {
      await s.queueRegistration('fo', testAddress, 0, 'hello-world')
      t.fail('should not have queued successfully')
    } catch (err) {
      t.equal(err.message, 'NameLength: Username must be 3 characters or longer.')
    }

    await s.queueRegistration('foo', testAddress, 0, 'hello-world')
    t.pass('foo.foo.id should be queued')
    await s.queueRegistration('bar', testAddress2, 0, 'hello-world')
    t.pass('should queue bar.bar.id')

    // make it so that foo.bar.id is now *not* valid to register
    nock('https://core.blockstack.org')
      .get('/v1/names/foo.bar.id')
      .times(2)
      .reply(200, {})

    const acquiredWait = s.lock.acquire('queue', () => {
      return new Promise(resolve => {
        setTimeout(() => resolve(), 9000)
      })
    })

    const failureBatch = s.submitBatch()
      .then(() => t.ok(false, 'Shouldnt have gotten lock'))
      .catch((err) => {
        t.equal(err.message, 'Failed to obtain lock')
      })

    const failureCheck = s.checkZonefiles()
      .then(() => t.ok(false, 'Shouldnt have gotten lock'))
      .catch((err) => {
        t.equal(err.message, 'Failed to obtain lock')
      })

    await Promise.all([acquiredWait, failureBatch, failureCheck])


    // now let's try a race!

    const acquiredWait1 = s.lock.acquire('queue', () => {
      return new Promise(resolve => {
        setTimeout(() => resolve(), 3000)
      })
    })

    const reg_1 = s.queueRegistration('alice', testAddress3, 0, 'hello-world')
    const reg_2 = s.queueRegistration('alice', testAddress3, 0, 'hello-world')

    try {
      await Promise.all([acquiredWait1, reg_1, reg_2])
      t.fail('Should not have queued both names')
    } catch (err) {
      t.equal(err.message, 'Subdomain operation already queued for this name.')
    }

    try {
      await s.submitBatch()
      t.ok(false, 'Should not have submitted a batch')
    } catch {
      t.ok(true, 'Should have failed')
    }

    nock('https://core.blockstack.org')
      .get('/v1/names/foo.bar.id')
      .times(1)
      .reply(404, {})

    let x = await s.getSubdomainStatus('bar')
    t.ok(x.status.startsWith('Subdomain is queued'),
      `bar.bar.id should still be queued for update`)
    x = await s.getSubdomainStatus('foo')
    t.ok(x.status.startsWith('Subdomain is queued'),
      `foo.bar.id should still be queued for update`)

    // now, let's try to _force_ the subdomain registrar into a failure state
    //  which _used_ to be possible, but now isn't due to the locking isSubdomainInQueue check.

    s.isSubdomainInQueue = async () => { return false };
    s.spamCheck = async () => { return false };

    try {
      await s.queueRegistration('alice', testAddress3, 0, 'hello-world')
      t.fail('Should have errored when trying to insert ip info')
    } catch (err) {
      t.equal((await s.getSubdomainStatus('alice')).status, 'Error logging ip info')
      t.equal(err.message, 'No queued entry found.')
    }
  })
}
