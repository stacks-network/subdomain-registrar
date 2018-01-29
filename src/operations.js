export type SubdomainOp = {
  owner: String,
  sequenceNumber: number,
  zonefilePartsLength: number,
  zonefileParts: Array<String>,
  subdomainName: String,
  ?signature: String
}

function subdomainOpToZFPieces(operation: SubdomainOp) {
  let destructedZonefile = destructZonefile(operation.zonefile)
  let txt = [`owner=${operation.owner}`,
             `seqn=${operation.sequenceNumber}`,
             `parts=${destructedZonefile.length}`]
  destructedZonefile.forEach(
    (zfPart, ix) => txt.push(`zf${ix}=${zfPart}`))

  let record = { name: operation.subdomainName,
                 txt }
  return record
}

export function makeUpdateZonefile(
  domainName: String,
  updates: Array<SubdomainOp>,
  maxZonefileBytes: number) {
  let subdomainRecs = []
  let zonefileObject = { '$origin': domainName,
                         '$ttl': 3600,
                         'txt': subdomainRecs }
  let outZonefile = makeZoneFile(zonefileObject)
  let submitted = []
  for (let i = 0; i < updates.length; i++) {
    subdomainRecs.push(subdomainOpToZFPieces(updates[i]))
    let newZonefile = makeZoneFile(zonefileObject)
    if (newZonefile.length < maxZoneFileBytes) {
      outZonefile = newZonefile
      submitted.push(updates[i].subdomainName)
    } else {
      break // zonefile got too long! use last generated one.
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
  return bsk.transactions.makeUpdate(domainName,
                                     ownerKey,
                                     paymentKey,
                                     zonefile)
    .then(txHex => bsk.network.broadcastTransaction(txHex))
}

export function checkTransactions(txs: Array<{txHash: String, zonefile: String}>) {
  return bsk.network.getBlockHeight()
    .then(
      blockHeight => Promise.all(txs.map(
        tx => bsk.network.getTransactionInfo(tx.txHash)
          .then(txInfo => {
            if (txInfo.block_height < blockHeight + 10) {
              return Promise.resolve({ txHash: tx.txHash, status: false })
            } else {
              return bsk.network.publishZonefile(tx.zonefile)
                .then(() => { txHash: tx.txHash, status: true })
            }
          })
      ))
    )
}
