
class SubdomainServer {
  function queueRegistration(subdomainName, owner, sequenceNumber, zonefile) {
    return new Promise(resolve => {
      db.run('INSERT INTO subdomain_queue ' +
             '(subdomainName, owner, sequenceNumber, zonefile, status) VALUES ?, ?, ?, ?, ?',
             [subdomainName, owner, sequenceNumber, zonefile, 'received'],
             (err) => {if (err) { reject(err) } else { resolve() }})
    })
  }

  function backupZonefile(zonefile: String) {
    return new Promise((resolve, reject) => {
      db.run('INSERT INTO subdomain_zonefile_backups (zonefile) VALUES ?',
             [zonefile], (err) => {if (err) { reject(err) } else { resolve() }})
    })
  }

  function addTransactionToTrack(txHash: String, zonefile: String) {
    return new Promise((resolve, reject) => {
      db.run('INSERT INTO transactions_tracked (txHash, zonefile) VALUES ?, ?',
             [txHash, zonefile], (err) => {if (err) { reject(err) } else { resolve() }})
    })
  }

  function updateQueueStatus(namesSubmitted: Array<String>, txHash: String) {
    return Promise.all(namesSubmitted.map(
      name => return new Promise((resolve, reject) => {
        db.run('UPDATE subdomain_queue SET status = ?, status_more = ? WHERE subdomainName = ?',
               ['submitted', txHash, name], (err) => {if (err) { reject(err) } else { resolve() }})
      })
    ))
  }

  function markTransactionsComplete(txStatuses: Array<{txHash: String}>) {
    return Promise.all(txStatuses.map(
      txHash => return new Promise((resolve, reject) => {
        db.run('DROP FROM transactions_tracked WHERE txHash = ?',
               [txHash], (err) => {if (err) { reject(err) } else { resolve() }})
      })
    ))
  }

  function fetchQueue() {
    return new Promise((resolve, reject) => {
      db.all('SELECT subdomainName, owner, sequenceNumber, zonefile, signature' +
             ' FROM subdomain_queue WHERE status = "received"',
             (err) => {if (err) { reject(err) } else { resolve() }})
    })
  }

  function submitBatch() {
    this.getUpdateLock()
      .then(() => {
        this.fetchQueue()
          .then(queue => {
            let update = makeUpdateZonefile(this.domainName, queue, 4096)
            let zonefile = update.zonefile
            let updatedFromQueue = update.submitted
            return this.backupZonefile(zonefile)
              .then(() => submitUpdate(this.domainName, zonefile,
                                       this.ownerKey, this.paymentKey))
              .then((txHash) => this.updateQueueStatus(updatedFromQueue, txHash))
              .then(() => this.addTransactionToTrack(txHash, zonefile))
          })
          .catch((err) => {new Error('Exception in submitting update.')})
          .finally(() => this.releaseLock())
      })
  }

  function checkZonefiles() {
    return new Promise((resolve) => {
      db.all('SELECT txHash, zonefile FROM transactions_tracked',
             (err, rows) => {
               if (err) {
                 throw new Error(`Failed to check transaction status: ${err}`)
               }
               resolve(rows)
             })})
      .then(entries => checkTransactions(entries))
      .then(txStatuses => this.markTransactionsComplete(
        txStatuses.filter( x => x.status )))
  }

  function getUpdateLock() {
    return new Promise( (resolve, reject) => {
      db.all("SELECT * FROM subdomainUpdatesLock", (err, rows) => {
        if (rows.length > 0) {
          reject('Lock is held: could be stale.')
        } else {
          db.exec("INSERT INTO subdomainUpdatesLock (held) VALUES (1)",
                  (err, row) => {
                    if (err) {
                      reject(err)
                    } else {
                      resolve(true)
                    }
                  })
        }
      })
    })
  }
}
