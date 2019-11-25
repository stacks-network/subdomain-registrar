import test from 'tape'
import nock from 'nock'

import { destructZonefile, subdomainOpToZFPieces, checkTransactions,
         submitUpdate, makeUpdateZonefile } from '../../lib/operations'
import { parseZoneFile } from 'zone-file'

const testAddress = '1HnssYWq9L39JMmD7tgtW8QbJfZQGhgjnq'
const testSK = 'c14b3044ca7f31fc68d8fcced6b60effd350c280e7aa5c4384c6ef32c0cb129f01'

const testAddress2 = '1xME6Dp5boMe4xDxAJn1Gaat7d3k5hhdE'
const testSK2 = '849bef09aa15c0e87ab55237fa4e45a0a6dfc0a7c698c9a8b6d193e1c1fae6db01'

export function unitTestOperations() {
  test('destructing a zonefile', (t) => {
    t.plan(8)

    let zfs = [Array(310).fill('1').join(''),
               Array(374).fill('1').join(''),
               Array(10).fill('1').join(''),
               Array(500).fill('1').join('')]
    let destructs = zfs.map(
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
    let opSkeleton = {
      subdomainName: 'foo',
      owner: testAddress,
      seqn: 0}
    let ops = [
      { zonefile: Array(10).fill('1').join('') },
      { zonefile: Array(310).fill('1').join(''),
        signature: 'foo-bar' }]
        .map(x => Object.assign({}, x, opSkeleton))
    let zfRecs = ops.map( x => subdomainOpToZFPieces(x) )

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

    nock('https://core.blockstack.org')
      .get('/v1/names/bar.id')
      .reply(200, { address: '1HnssYWq9L39JMmD7tgtW8QbJfZQGhgjnq' })

    submitUpdate('bar.id', 'hello world',
                 testSK, testSK2)
      .then(x => t.equal(x, '8b85c2b7c7b1d67fbf2a8617bb56c30f8f7f4ae022e6bb4106143c58cc272c22'))
  })

  test('checkTransactions', (t) => {
    t.plan(1)

    let txs = [{hash: 'txhash-0', height: 289},
               {hash: 'txhash-1', height: 293},
               {hash: 'txhash-2', height: 294}]
        .map(x => ({ zonefile: 'hello world',
                     txHash: x.hash,
                     blockheight: x.height }))

    nock.cleanAll()

    nock('https://node.blockstack.org:6263')
      .persist()
      .post('/RPC2')
      .reply(200, '<string>{"saved": [1]}</string>')

    nock('https://blockchain.info')
      .persist()
      .get('/latestblock?cors=true')
      .reply(200, { height: 300 })

    txs.forEach( x => nock('https://blockchain.info')
                 .persist()
                 .get(`/rawtx/${x.txHash}?cors=true`)
                 .reply(200, { block_height: x.blockheight }) )

    nock('https://core.blockstack.org')
      .persist()
      .post('/v1/zonefile/')
      .reply(202, { servers: ['me.co'] })

    checkTransactions(txs)
      .then( results => t.deepEqual( results,
                                     [ { txHash: 'txhash-0',
                                         status: true },
                                       { txHash: 'txhash-1',
                                         status: true },
                                       { txHash: 'txhash-2',
                                         status: false } ] ))
  })

  test('makeUpdateZonefile', (t) => {
    t.plan(5)

    let uriEntry = [{name: 'bar.id', target: 'bar.com',
                     priority: 1, weight: 10}]
    let maxZonefileBytes = 1000

    let subdomainName = 'foo'

    let subdomainOp = {
      owner: testAddress,
      seqn: 0,
      zonefile: 'hello world'
    }

    let updatesArray1 = [ Object.assign({}, subdomainOp,
                                        { subdomainName: `${subdomainName}-0` }) ]
    let updatesArray2 = []
    for (let i = 0; i < 20; i++) {
      updatesArray2.push(
        Object.assign({}, subdomainOp,
                      { subdomainName: `${subdomainName}-${i}` }))
    }

    let update1 = makeUpdateZonefile('bar.id', uriEntry,
                                     updatesArray1, maxZonefileBytes)
    let update2 = makeUpdateZonefile('bar.id', uriEntry,
                                     updatesArray2, maxZonefileBytes)

    t.deepEqual(update1.submitted, ['foo-0'], 'expect only 1 submission')
    t.deepEqual(update2.submitted, [0,1,2,3,4,5,6,7].map(x => `${subdomainName}-${x}`),
                'expect fewer submitted than the whole set')

    t.ok(Buffer.from(update2.zonefile, 'ascii').length < 1000,
         'outputedd zonefile should be less than 1k bytes')

    let parsed1 = parseZoneFile(update1.zonefile)
    let parsed2 = parseZoneFile(update2.zonefile)

    t.deepEqual(parsed1.txt.map(rec => rec.name), ['foo-0'],
                'outputted txt records should match expected subdomains')
    t.deepEqual(parsed2.txt.map(rec => rec.name),
                [0,1,2,3,4,5,6,7].map(x => `${subdomainName}-${x}`),
                'outputted txt records should match expected subdomains')

  })

}
