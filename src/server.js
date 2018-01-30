import { isRegistrationValid } from './lookups'

class SubdomainServer {
  queueRegistration(subdomainName, owner, sequenceNumber, zonefile) {
    return isRegistrationValid(subdomainName, this.domainName,
                               owner, sequenceNumber, zonefile)
      .then((valid) => {
        if (!valid) {
          throw new Error('')
        }
        return new Promise((resolve, reject) => {
          this.lock.writeLock((release) => {
            db.run('INSERT INTO subdomain_queue ' +
                   '(subdomainName, owner, sequenceNumber, zonefile, status) VALUES ?, ?, ?, ?, ?',
                   [subdomainName, owner, sequenceNumber, zonefile, 'received'],
                   (err) => {
                     release()
                     if (err) {
                       reject(err)
                     } else {
                       resolve()
                     }})
          })
        })
      })
  }

  backupZonefile(zonefile: String) {
    return new Promise((resolve, reject) => {
      db.run('INSERT INTO subdomain_zonefile_backups (zonefile) VALUES ?',
             [zonefile], (err) => {if (err) { reject(err) } else { resolve() }})
    })
  }

  addTransactionToTrack(txHash: String, zonefile: String) {
    return new Promise((resolve, reject) => {
      db.run('INSERT INTO transactions_tracked (txHash, zonefile) VALUES ?, ?',
             [txHash, zonefile], (err) => {if (err) { reject(err) } else { resolve() }})
    })
  }

  updateQueueStatus(namesSubmitted: Array<String>, txHash: String) {
    return Promise.all(namesSubmitted.map(
      name => new Promise((resolve, reject) => {
        db.run('UPDATE subdomain_queue SET status = ?, status_more = ? WHERE subdomainName = ?',
               ['submitted', txHash, name], (err) => {if (err) { reject(err) } else { resolve() }})
      })
    ))
  }

  markTransactionsComplete(txStatuses: Array<{txHash: String}>) {
    return Promise.all(txStatuses.map(
      txHash => new Promise((resolve, reject) => {
        db.run('DROP FROM transactions_tracked WHERE txHash = ?',
               [txHash], (err) => {if (err) { reject(err) } else { resolve() }})
      })
    ))
  }

  fetchQueue() {
    return new Promise((resolve, reject) => {
      db.all('SELECT subdomainName, owner, sequenceNumber, zonefile, signature' +
             ' FROM subdomain_queue WHERE status = "received"',
             (err) => {if (err) { reject(err) } else { resolve() }})
    })
  }

  submitBatch() {
    return new Promise((resolve, reject) => {
      this.lock.writeLock((release) => {
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
          .then(txHash => resolve(txHash))
          .finally(() => release())
      }, { timeout: 1,
           timeoutCallback: () => {
             throw new Error('Failed to obtain lock')
           }
         })
    })
  }

  checkZonefiles() {
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
}
