/* @flow */

import { transactions, config as bskConfig, safety, hexStringToECPair } from 'blockstack'
import { makeZoneFile } from 'zone-file'
import logger from 'winston'
import fetch from 'node-fetch'
import { crypto } from 'bitcoinjs-lib'
import RIPEMD160 from 'ripemd160'

export type SubdomainOp = {
  owner: string,
  sequenceNumber: number,
  zonefile: string,
  subdomainName: string,
  signature?: string
}

const ZONEFILE_TEMPLATE = '{$origin}\n{$ttl}\n{txt}{uri}'

// reconfigure obtaining consensus hash

const getConsensusHashInner = bskConfig.getConsensusHash

bskConfig.getConsensusHash = () => {
  getConsensusHashInner
    .then(x => {
      logger.info(`Obtained consensus hash ${x}`,
                  { msgType: 'consensus_hash', consensusHash: x })
      return x
    })
}

export function destructZonefile(zonefile: string) {
  const encodedZonefile = Buffer.from(zonefile)
        .toString('base64')
  // we pack into 250 byte strings -- the entry "zf99=" eliminates 5 useful bytes,
  // and the max is 255.
  const pieces = 1 + Math.floor(encodedZonefile.length / 250)
  const destructed = []
  for (let i = 0; i < pieces; i++) {
    const startIndex = i * 250
    const currentPiece = encodedZonefile.slice(startIndex, startIndex + 250)
    if (currentPiece.length > 0) {
      destructed.push(currentPiece)
    }
  }
  return destructed
}

export function subdomainOpToZFPieces(operation: SubdomainOp) {
  const destructedZonefile = destructZonefile(operation.zonefile)
  const txt = [`owner=${operation.owner}`,
               `seqn=${operation.sequenceNumber}`,
               `parts=${destructedZonefile.length}`]
  destructedZonefile.forEach(
    (zfPart, ix) => txt.push(`zf${ix}=${zfPart}`))

  if (operation.signature) {
    txt.push(`sig=${operation.signature}`)
  }

  return { name: operation.subdomainName,
           txt }
}

export function makeUpdateZonefile(
  domainName: string,
  uriEntries: Array<{name: string, target: string, priority: number, weight: number}>,
  updates: Array<SubdomainOp>,
  maxZonefileBytes: number) {
  const subdomainRecs = []
  const zonefileObject = { $origin: domainName,
                           $ttl: 3600,
                           uri: uriEntries,
                           txt: subdomainRecs }
  const submitted = []

  logger.debug('Constructing zonefile: ')
  logger.debug(zonefileObject)

  let outZonefile = makeZoneFile(zonefileObject,
                                 ZONEFILE_TEMPLATE)
  for (let i = 0; i < updates.length; i++) {
    subdomainRecs.push(subdomainOpToZFPieces(updates[i]))
    const newZonefile = makeZoneFile(zonefileObject,
                                     ZONEFILE_TEMPLATE)
    if (newZonefile.length < maxZonefileBytes) {
      outZonefile = newZonefile
      submitted.push(updates[i].subdomainName)
    } else {
      break // zonefile got too long, use last generated one!
    }
  }

  return { zonefile: outZonefile,
           submitted }
}

export function submitUpdate(
  domainName: string,
  zonefile: string,
  ownerKey: string,
  paymentKey: string) {
  const ownerAddress = hexStringToECPair(ownerKey).getAddress()
  return safety.ownsName(domainName, ownerAddress)
    .then((ownsName) => {
      if (!ownsName) {
        throw new Error(`Domain name ${domainName} not owned by address ${ownerAddress}`)
      }
      return transactions.makeUpdate(domainName, ownerKey, paymentKey, zonefile)
    })
    .then(txHex => bskConfig.network.broadcastTransaction(txHex))
}

export function checkTransactions(txs: Array<{txHash: string, zonefile: string}>):
Promise<Array<{txHash: string, status: boolean}>> {
  return bskConfig.network.getBlockHeight()
    .then(
      blockHeight => Promise.all(txs.map(
        tx => bskConfig.network.getTransactionInfo(tx.txHash)
          .then(txInfo => {
            if (! txInfo.block_height) {
              logger.info('Could not get block_height, probably unconfirmed.',
                          { msgType: 'unconfirmed', txid: tx.txHash })
              return Promise.resolve({ txHash: tx.txHash, status: false })
            } else if (txInfo.block_height + 7 > blockHeight) {
              logger.debug(`block_height for ${tx.txHash}: ${txInfo.block_height} --- has ${1 + blockHeight - txInfo.block_height} confirmations`)
              return Promise.resolve({ txHash: tx.txHash, status: false })
            } else {
              if (bskConfig.network.blockstackAPIUrl === 'https://core.blockstack.org') {
                return directlyPublishZonefile(tx.zonefile)
                  // this is horrible. I know. but the reasons have to do with load balancing
                  // on node.blockstack.org and Atlas peering.
                  .then(() => directlyPublishZonefile(tx.zonefile))
                  .then(() => ({ txHash: tx.txHash, status: true }))
              } else {
                return bskConfig.network.broadcastZoneFile(tx.zonefile)
                  .then(() => ({ txHash: tx.txHash, status: true }))
              }
            }
          })
          .catch(err => {
            logger.error(`Error publishing zonefile for tx ${tx.txHash}: ${err}`)
            return Promise.resolve({ txHash: tx.txHash, status: false})
          })
      ))
    )
}

export function hash160(input: Buffer) {
  const sha256 = crypto.sha256(input)
  return (new RIPEMD160()).update(sha256).digest()
}

// this is a hack -- this is a stand-in while we roll out support for
//   publishing zonefiles via core.blockstack
export function directlyPublishZonefile(zonefile: string) {
  // speak directly to node.blockstack

  const b64Zonefile = Buffer.from(zonefile).toString('base64')

  const postData = '<?xml version=\'1.0\'?>' +
        '<methodCall><methodName>put_zonefiles</methodName>' +
        `<params><param><array><data><value>
         <string>${b64Zonefile}</string></value>
         </data></array></param></params>` +
        '</methodCall>'
  return fetch('https://node.blockstack.org:6263/RPC2',
               { method: 'POST',
                 body: postData })
    .then(resp => {
      if (resp.status >= 200 && resp.status <= 299){
        return resp.text()
      } else {
        logger.error(`Publish zonefile error: Response code from node.blockstack: ${resp.status}`)
        resp.text().then(
          (text) => logger.error(`Publish zonefile error: Response from node.blockstack: ${text}`))
        throw new Error('Failed to publish zonefile. Bad response from node.blockstack')
      }
    })
    .then(respText => {
      const start = respText.indexOf('<string>') + '<string>'.length
      const stop = respText.indexOf('</string>')
      const dataResp = respText.slice(start, stop)
      let jsonResp
      try {
        jsonResp = JSON.parse(dataResp)
      } catch (err) {
        logger.error(`Failed to parse JSON response from node.blockstack: ${respText}`)
        throw err
      }
      if ('error' in jsonResp) {
        logger.error(`Error in publishing zonefile: ${JSON.stringify(jsonResp)}`)
        throw new Error(jsonResp.error)
      }

      if (!jsonResp.saved || jsonResp.saved.length < 1) {
        throw new Error('Invalid "saved" response from node.blockstack')
      }

      if (jsonResp.saved[0] === 1) {
        return true
      } else if (jsonResp.saved[0] === 0) {
        throw new Error('Zonefile not saved')
      }

      throw new Error('Invalid "saved" response from node.blockstack')
    })
}
