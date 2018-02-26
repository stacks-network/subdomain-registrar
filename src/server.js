import logger from 'winston'

import { makeUpdateZonefile, submitUpdate, checkTransactions } from './operations'
import { isRegistrationValid, isSubdomainRegistered, checkProofs } from './lookups'
import ReadWriteLock from 'rwlock'
import { RegistrarQueueDB } from './db'

export class SubdomainServer {
  constructor(config: {domainName: String, ownerKey: String,
                       paymentKey: String, dbLocation: String,
                       domainUri: String, zonefileSize: Number,
                       ipLimit: Number, proofsRequired: Number,
                       apiKeys?: Array<String>}) {
    this.domainName = config.domainName
    this.ownerKey = config.ownerKey
    this.paymentKey = config.paymentKey
    this.zonefileSize = config.zonefileSize
    this.uriEntry = { name: '_http._tcp',
                      target: config.domainUri,
                      priority: 10,
                      weight: 1 }

    this.apiKeys = config.apiKeys ? config.apiKeys : []
    this.ipLimit = config.ipLimit
    this.proofsRequired = config.proofsRequired
    this.db = new RegistrarQueueDB(config.dbLocation)
    this.lock = new ReadWriteLock()
  }

  initializeServer() {
    return this.db.initialize()
  }

  // returns a truth-y error message if request flags spam check
  //  returns false if the request is not spam
  spamCheck(subdomainName, owner, zonefile, ipAddress, authorization) {
    // the logic here is a little convoluted, because I'm trying to short-circuit
    //  the spam checks while also using Promises, which is a little tricky.
    // the logic should encapsulate:
    //
    //  spam pass = (ownerAddressGood && (apiKeyGood || (ipAddressGood && socialProofsGood)))
    //

    return this.db.getOwnerAddressCount(owner)
      .then((ownerCount) => {
        if (ownerCount >= 1) {
          return 'Owner already registered subdomain with this registrar.'
        }
        return false
      })
      .then((ownerCountCheck) => {
        if (ownerCountCheck) {
          return Promise.resolve(ownerCountCheck)
        }
        if (authorization && authorization.startsWith('bearer ')) {
          const apiKey = authorization.slice('bearer '.length)
          if (this.apiKeys.includes(apiKey)) {
            logger.info('Passed spam checks with API key')
            return Promise.resolve(false)
          }
        }
        let ipLimiterPromise
        if (this.ipLimit <= 0) {
          ipLimiterPromise = Promise.resolve(false)
        } else {
          ipLimiterPromise = this.db.getIPAddressCount(ipAddress)
            .then((ipCount) => {
              if (ipCount >= this.ipLimit) {
                return `IP address ${ipAddress} already registered ${ipCount} subdomains.`
              }
              return false
            })
        }

        return ipLimiterPromise
          .then((previous) => {
            if (previous || this.proofsRequired <= 0) {
              return previous
            }
            return checkProofs(owner, zonefile)
              .then((proofsValid) => {
                if (proofsValid.length < this.proofsRequired) {
                  return `Proofs are required: had ${proofsValid.length} valid, requires ${this.proofsRequired}`
                }
                return false
              })
              .catch((err) => {
                logger.error(err)
                return 'Proof validation failed'
              })
          })
      })
  }

  queueRegistration(subdomainName, owner, sequenceNumber, zonefile,
                    ipAddress: ?string = '', authorization: ?string = '') {
    return this.isSubdomainInQueue(subdomainName)
      .then((inQueue) => {
        if (inQueue) {
          logger.warn(`Requested operation for ${subdomainName}, but op` +
                           ' is already in queue for this name.')
          throw new Error('Subdomain operation already queued for this name.')
        }
        return isRegistrationValid(
          subdomainName, this.domainName, owner, sequenceNumber, zonefile)
      })
      .then((valid) => {
        if (!valid) {
          logger.warn(`Discarding operation for ${subdomainName}` +
                           ' because it failed validation.')
          throw new Error('Requested subdomain operation is invalid.')
        }
        return this.spamCheck(
          subdomainName, owner, zonefile, ipAddress, authorization)
      })
      .then((spamFailure) => {
        if (spamFailure) {
          logger.warn(`${subdomainName} failed spam-check: ${spamFailure}`)
          throw new Error(spamFailure)
        }
      })
      .then(() => {
        return new Promise((resolve, reject) => {
          this.lock.writeLock((release) => {
            logger.debug('Obtained lock to register.')
            this.db.addToQueue(subdomainName, owner, sequenceNumber, zonefile)
              .then(() => {
                logger.info(`Logging requestor info (ip= ${ipAddress} owner=${owner}`)
                return this.db.logRequestorData(subdomainName, owner, ipAddress)
              })
              .catch((err) => {
                logger.error(`Setting status for ${subdomainName} as errored.`)
                this.db.updateStatusFor([subdomainName], 'Error logging ip info', '')
                throw err
              })
              .then(() => {
                logger.info(`Queued operation on ${subdomainName}: owner= ${owner}` +
                                 ` seqn= ${sequenceNumber} zf= ${zonefile}`)
                resolve()
              })
              .catch((err) => {
                logger.error(`Error processing registration: ${err}`)
                logger.error(err.stack)
                reject(err)
              })
              .then(() => release())
          })
        })
      })
  }

  getSubdomainStatus(subdomainName: String):
  Promise<{status: String, statusCode?: Number}> {
    return isSubdomainRegistered(`${subdomainName}.${this.domainName}`)
      .then((isRegistered) => {
        if (isRegistered) {
          return { status: 'Subdomain propagated' }
        } else {
          return this.db.getStatusRecord(subdomainName).then((rows) => {
            if (rows.length > 0) {
              const statusRecord = rows[0]
              if (statusRecord.status == 'received') {
                return { status:
                   'Subdomain is queued for update and should be' +
                         ' announced within the next few blocks.' }
              } else if (statusRecord.status == 'submitted') {
                return { status:
                         `Your subdomain was registered in transaction ${statusRecord.status_more}` +
                         ' -- it should propagate on the network once it has 6 confirmations.' }
              } else {
                return { status: statusRecord.status }
              }
            } else {
              return { status: 'Subdomain not registered with this registrar',
                       statusCode: 404 }
            }
          })
        }
      })
  }

  isSubdomainInQueue(subdomainName: String) {
    return this.getSubdomainStatus(subdomainName)
      .then(status => (status.statusCode !== 404))
  }

  backupZonefile(zonefile: String) {
    return this.db.backupZonefile(zonefile)
  }

  addTransactionToTrack(txHash: String, zonefile: String) {
    return this.db.trackTransaction(txHash, zonefile)
  }

  updateQueueStatus(namesSubmitted: Array<String>, txHash: String) {
    return this.db.updateStatusFor(namesSubmitted, 'submitted', txHash)
  }

  markTransactionsComplete(entries: Array<{txHash: String}>) {
    if (entries.length > 0) {
      logger.info(`${entries.length} transactions newly finished.`)
    } else {
      logger.debug(`${entries.length} transactions newly finished.`)
      return Promise.resolve()
    }

    return this.db.flushTrackedTransactions(entries)
  }

  fetchQueue() {
    return this.db.fetchQueue()
  }

  submitBatch() : Promise<String> {
    return new Promise((resolve, reject) => {
      this.lock.writeLock((release) => {
        logger.debug('Obtained lock, fetching queue.')
        this.fetchQueue()
          .then(queue => {
            return Promise.all(
              queue.map(subdomainOp => isRegistrationValid(
                subdomainOp.subdomainName, this.domainName, subdomainOp.owner,
                parseInt(subdomainOp.sequenceNumber), subdomainOp.zonefile)))
              .then(results => {
                const valid = queue.filter((op, opIndex) => results[opIndex])
                const invalid = queue.filter((op, opIndex) => !results[opIndex])
                invalid.forEach(
                  op => logger.warn(`Skipping registration of ${op.subdomainName} ` +
                                    'because it is not valid:' +
                                    ` seqn=${op.sequenceNumber} zf=${op.zonefile}`))
                return valid
              })
          })
          .then(queue => {
            if (queue.length === 0) {
              logger.debug(`${queue.length} items in the queue.`)
              return null
            }
            logger.info(`${queue.length} items in the queue.`)
            const update = makeUpdateZonefile(this.domainName, this.uriEntry,
                                              queue, this.zonefileSize)
            const zonefile = update.zonefile
            const updatedFromQueue = update.submitted
            logger.info(`[${updatedFromQueue}] will be in this batch.`)
            return this.backupZonefile(zonefile)
              .then(() => submitUpdate(this.domainName, zonefile,
                                       this.ownerKey, this.paymentKey))
              .then((txHash) => {
                logger.info(txHash)
                return this.updateQueueStatus(updatedFromQueue, txHash)
              })
              .then((txHash) => this.addTransactionToTrack(txHash, zonefile))
          })
          .then(txHash => {
            if (txHash) {
              logger.info(`Batch submitted in txid: ${txHash}`)
            } else {
              logger.debug('No batch submitted')
            }
            resolve(txHash)
          })
          .catch((err) => {
            logger.error(`Failed to submit batch: ${err}`)
            logger.error(err.stack)
            reject(err)
          })
          .then(() => release())
      }, { timeout: 1,
           timeoutCallback: () => {
             logger.error('Batch submission failed: could not obtain lock.')
             reject(new Error('Failed to obtain lock'))
           }
         })
    })
  }

  checkZonefiles() {
    logger.debug('Checking for outstanding transactions.')
    return new Promise((resolve, reject) => {
      this.lock.writeLock((release) => {
        logger.debug('Obtained lock, checking transactions.')

        this.db.getTrackedTransactions()
          .then(entries => {
            if (entries.length > 0) {
              logger.info(`${entries.length} outstanding transactions.`)
            } else {
              logger.debug(`${entries.length} outstanding transactions.`)
            }
            return checkTransactions(entries)
          })
          .then(txStatuses => this.markTransactionsComplete(
            txStatuses.filter(x => x.status)))
          .then(() => {
            resolve()
          })
          .catch((err) => {
            logger.error(`Failure trying to publish zonefiles: ${err}`)
            logger.error(err.stack)
            reject(new Error(`Failed to check transaction status: ${err}`))
          })
          .then(() => {
            release()
            logger.debug('Lock released')
          })
      }, { timeout: 1,
           timeoutCallback: () => {
             reject(new Error('Failed to obtain lock'))
           }
         })
    })
  }

  shutdown() {
    return this.db.shutdown()
  }
}
