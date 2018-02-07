import { transactions, config as bskConfig } from 'blockstack'
import { makeZoneFile } from 'zone-file'

export type SubdomainOp = {
  owner: String,
  sequenceNumber: number,
  zonefilePartsLength: number,
  zonefileParts: Array<String>,
  subdomainName: String,
  signature?: String
}

const ZONEFILE_TEMPLATE = '{$origin}\n{$ttl}\n{txt}{uri}'

export function destructZonefile(zonefile: String) {
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
  domainName: String,
  uriEntry: {name: String, target: String, priority: Number, weight: Number},
  updates: Array<SubdomainOp>,
  maxZonefileBytes: number) {
  const subdomainRecs = []
  const zonefileObject = { $origin: domainName,
                           $ttl: 3600,
                           uri: [uriEntry],
                           txt: subdomainRecs }
  const submitted = []
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
  domainName: String,
  zonefile: String,
  ownerKey: String,
  paymentKey: String) {
  return transactions.makeUpdate(domainName,
                                 ownerKey,
                                 paymentKey,
                                 zonefile)
    .then(txHex => bskConfig.network.broadcastTransaction(txHex))
}

export function checkTransactions(txs: Array<{txHash: String, zonefile: String}>):
Promise<Array<{txHash: String, status: Boolean}>> {
  return bskConfig.network.getBlockHeight()
    .then(
      blockHeight => Promise.all(txs.map(
        tx => bskConfig.network.getTransactionInfo(tx.txHash)
          .then(txInfo => {
            if (txInfo.block_height + 10 > blockHeight) {
              return Promise.resolve({ txHash: tx.txHash, status: false })
            } else {
              return bskConfig.network.publishZonefile(tx.zonefile)
                .then(() => ({ txHash: tx.txHash, status: true }))
            }
          })
      ))
    )
}
