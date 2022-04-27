import test from 'tape'
import nock from 'nock'

import {
  destructZonefile, subdomainOpToZFPieces, checkTransactions,
  submitUpdate, makeUpdateZonefile
} from '../../lib/operations'
import { parseZoneFile } from 'zone-file'
const bns = require('./../bns.json')

// const testAddress = '1HnssYWq9L39JMmD7tgtW8QbJfZQGhgjnq'
const testAddress = 'SP2ZRX0K27GW0SP3GJCEMHD95TQGJMKB7GB36ZAR0'
const testSK = 'b8d99fd45da58038d630d9855d3ca2466e8e0f89d3894c4724f0efc9ff4b51f001'

const testAddress2 = 'ST26FVX16539KKXZKJN098Q08HRX3XBAP541MFS0P'
const testSK2 = '3a4e84abb8abe0c1ba37cef4b604e73c82b1fe8d99015cb36b029a65099d373601'

export function unitTestOperations() {
  test('destructing a zonefile', (t) => {
    t.plan(8)

    const zfs = [Array(310).fill('1').join(''),
    Array(374).fill('1').join(''),
    Array(10).fill('1').join(''),
    Array(500).fill('1').join('')]
    const destructs = zfs.map(
      x => destructZonefile(x))

    t.equal(destructs[0].length, 2)
    t.equal(destructs[0].join('').length, 416)
    t.equal(destructs[1].length, 2)
    t.equal(destructs[1].join('').length, 500)
    t.equal(destructs[2].length, 1)
    t.equal(destructs[2].join('').length, 16)
    t.equal(destructs[3].length, 3)
    t.equal(destructs[3].join('').length, 668)
  })

  test('subdomainOpToZFPieces', (t) => {
    t.plan(4)
    const opSkeleton = {
      subdomainName: 'foo',
      owner: testAddress,
      seqn: 0
    }
    const ops = [
      { zonefile: Array(10).fill('1').join('') },
      {
        zonefile: Array(310).fill('1').join(''),
        signature: 'foo-bar'
      }]
      .map(x => Object.assign({}, x, opSkeleton))
    const zfRecs = ops.map(x => subdomainOpToZFPieces(x))

    t.ok(zfRecs[0].name)
    t.ok(zfRecs[1].name)
    // should have owner=,seqn=,parts=,zf=
    t.equal(zfRecs[0].txt.length, 4)
    // should have owner=,seqn=,parts=,zf=,zf=,sig=
    t.equal(zfRecs[1].txt.length, 6)
  })

  test('submitUpdate', (t) => {
    t.plan(1)

    nock.cleanAll()

    nock('https://stacks-node-api.mainnet.stacks.co')
      .get('/v1/names/bar.id')
      .reply(200, {
        address: testAddress
      })

    nock('https://stacks-node-api.mainnet.stacks.co')
      .post('/v2/transactions')
      .reply(200, '"tx-hash"')

    nock('https://stacks-node-api.mainnet.stacks.co')
      .get('/v2/contracts/interface/SP000000000000000000002Q6VF78/bns')
      .reply(200, bns)

    nock('https://stacks-node-api.mainnet.stacks.co')
      .get('/v2/fees/transfer')
      .reply(200, 1)



    nock('https://stacks-node-api.mainnet.stacks.co')
      .get('/v2/accounts/SP26FVX16539KKXZKJN098Q08HRX3XBAP55F6QR13?proof=0')
      .reply(200, {
        balance: '0x00000000000000000000000000000000',
        locked: '0x00000000000000000000000000000000',
        unlock_height: 0,
        nonce: 0,
        balance_proof: '',
        nonce_proof: ''
      })

    submitUpdate('bar.id', 'hello world',
      testSK, testSK2)
      .then(x => t.equal(x, 'tx-hash'))
  })

  test('checkTransactions', async (t) => {
    t.plan(1)

    const txs = [{ hash: 'txhash-0', height: 289 },
    { hash: 'txhash-1', height: 293 },
    { hash: 'txhash-2', height: 294 },
    { hash: 'txhash-3', height: undefined }]
      .map(x => ({
        zonefile: 'hello world',
        txHash: x.hash,
        blockheight: x.height
      }))

    nock.cleanAll()

    nock('https://stacks-node-api.mainnet.stacks.co')
      .get('/v2/info')
      .reply(200, { burn_block_height: 300 })

    txs.forEach(x => nock('https://stacks-node-api.mainnet.stacks.co')
      .persist()
      .get(`/extended/v1/tx/${x.txHash}`)
      .reply(200, { block_height: x.blockheight }))

    // nock('https://stacks-node-api.mainnet.stacks.co')
    //   .persist()
    //   .post('/v1/zonefile/')
    //   .reply(202, { servers: ['me.co'] })  //todo v1/zonefile commented for now 

    const results = await checkTransactions(txs)
    t.deepEqual(results,
      [{
        txHash: 'txhash-0',
        status: true, blockHeight: 289
      },
      {
        txHash: 'txhash-1',
        status: true, blockHeight: 293
      },
      {
        txHash: 'txhash-2',
        status: false, blockHeight: 294
      },
      {
        txHash: 'txhash-3',
        status: false, blockHeight: -1
      }])
  })

  test('makeUpdateZonefile', (t) => {
    t.plan(5)

    const uriEntry = [{
      name: 'bar.id', target: 'bar.com',
      priority: 1, weight: 10
    }]
    const maxZonefileBytes = 1000

    const subdomainName = 'foo'

    const subdomainOp = {
      owner: testAddress,
      seqn: 0,
      zonefile: 'hello world'
    }

    const updatesArray1 = [Object.assign({}, subdomainOp,
      { subdomainName: `${subdomainName}-0` })]
    const updatesArray2 = []
    for (let i = 0; i < 20; i++) {
      updatesArray2.push(
        Object.assign({}, subdomainOp,
          { subdomainName: `${subdomainName}-${i}` }))
    }

    const update1 = makeUpdateZonefile('bar.id', uriEntry,
      updatesArray1, maxZonefileBytes)
    const update2 = makeUpdateZonefile('bar.id', uriEntry,
      updatesArray2, maxZonefileBytes)

    t.deepEqual(update1.submitted, ['foo-0'], 'expect only 1 submission')
    t.deepEqual(update2.submitted, [0, 1, 2, 3, 4, 5, 6, 7].map(x => `${subdomainName}-${x}`),
      'expect fewer submitted than the whole set')

    t.ok(Buffer.from(update2.zonefile, 'ascii').length < 1000,
      'outputedd zonefile should be less than 1k bytes')

    const parsed1 = parseZoneFile(update1.zonefile)
    const parsed2 = parseZoneFile(update2.zonefile)

    t.deepEqual(parsed1.txt.map(rec => rec.name), ['foo-0'],
      'outputted txt records should match expected subdomains')
    t.deepEqual(parsed2.txt.map(rec => rec.name),
      [0, 1, 2, 3, 4, 5, 6, 7].map(x => `${subdomainName}-${x}`),
      'outputted txt records should match expected subdomains')

  })

}
