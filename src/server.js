/* @flow */
import logger from 'winston'
import AsyncLock from 'async-lock'

import { makeUpdateZonefile, submitUpdate, checkTransactions, hash160 } from './operations'
import { isRegistrationValid, isSubdomainRegistered, checkProofs } from './lookups'
import { RegistrarQueueDB } from './db'

const TIME_WEEK = 604800
const QUEUE_LOCK = 'queue'

export class SubdomainServer {
  domainName: string
  ownerKey: string
  paymentKey: string
  zonefileSize: number
  uriEntries: Array<{ name: string, target: string, priority: number, weight: number}>
  disableRegistrationsWithoutKey: boolean
  apiKeys: Array<string>
  ipWhitelist: Array<string>
  ipLimit: number
  nameMinLength: number
  proofsRequired: number
  db: RegistrarQueueDB
  lock: AsyncLock

  constructor(config: {domainName: string, ownerKey: string,
                       paymentKey: string, dbLocation: string,
                       domainUri?: ?string, resolverUri: ?string,
                       zonefileSize: number,
                       ipLimit: number, proofsRequired: number,
                       disableRegistrationsWithoutKey: boolean,
                       apiKeys?: Array<string>,
                       ipWhitelist?: Array<string>,
                       nameMinLength: number}) {
    this.domainName = config.domainName
    this.ownerKey = config.ownerKey
    this.paymentKey = config.paymentKey
    this.zonefileSize = config.zonefileSize
    this.ipWhitelist = config.ipWhitelist ? config.ipWhitelist : []
    this.uriEntries = []
    if (config.domainUri) {
      this.uriEntries.push({ name: '_http._tcp',
                             target: config.domainUri,
                             priority: 10,
                             weight: 1 })
    }
    if (config.resolverUri) {
      this.uriEntries.push({ name: '_resolver',
                             target: config.resolverUri,
                             priority: 10,
                             weight: 1 })
    }
    this.disableRegistrationsWithoutKey = config.disableRegistrationsWithoutKey
    this.apiKeys = config.apiKeys ? config.apiKeys : []
    this.ipLimit = config.ipLimit
    this.nameMinLength = config.nameMinLength
    this.proofsRequired = config.proofsRequired
    this.db = new RegistrarQueueDB(config.dbLocation)
    this.lock = new AsyncLock()
  }

  initializeServer() {
    return this.db.initialize()
  }

  isValidLength(subdomainName: string) {
    if (!this.nameMinLength) {
      return true
    } else {
      return subdomainName.length >= this.nameMinLength
    }
  }

  // returns a truth-y error message if request flags spam check
  //  returns false if the request is not spam
  async spamCheck(subdomainName: string, owner: string, zonefile: string,
                  ipAddress: ?string, authorization: ?string) {
    // the logic here is a little convoluted, because I'm trying to short-circuit
    //  the spam checks while also using Promises, which is a little tricky.
    // the logic should encapsulate:
    //
    //  spam pass = (ownerAddressGood && (apiKeyGood || (ipAddressGood && socialProofsGood)))
    //
    const ownerCount = await this.db.getOwnerAddressCount(owner)
    if (ownerCount >= 1) {
      return 'Owner already registered subdomain with this registrar.'
    }

    if (authorization && authorization.startsWith('bearer ')) {
      const apiKey = authorization.slice('bearer '.length)
      if (this.apiKeys.includes(apiKey)) {
        logger.info('Passed spam checks with API key',
                    { msgType: 'spam_pass', reason: 'api_key' , apiKey: apiKey.slice(0,5)})
        return false
      }
    }
    if (this.disableRegistrationsWithoutKey) {
      return 'Registrations without API key are disabled'
    }

    if (this.ipLimit > 0) {
      if (!ipAddress) {
        return 'IP limiting in effect, and no IP address detected for request.'
      } else {
        // if it's not in the whitelist, perform a check
        if (!(this.ipWhitelist && this.ipWhitelist.includes(ipAddress))) {
          const ipCount = await this.db.getIPAddressCount(ipAddress)
          if (ipCount >= this.ipLimit) {
            logger.warn('IP limited by spam filter',
                        { msgType: 'spam_fail', reason: 'ip_count', ip: ipAddress })
            return `IP address ${JSON.stringify(ipAddress)} already registered ${ipCount} subdomains.`
          }
        }
      }
    }

    if (! this.isValidLength(subdomainName)) {
      logger.warn(`Discarding operation for ${subdomainName}` +
                  ` because subdomain shorter than ${this.nameMinLength} characters.`,
                  { msgType: 'spam_fail', reason: 'name_length', ip: ipAddress })
      return `NameLength: Username must be ${this.nameMinLength} characters or longer.`
    }

    if (this.proofsRequired > 0) {
      try {
        const proofsValid = await checkProofs(owner, zonefile)
        if (proofsValid.length < this.proofsRequired) {
          logger.warn('Proofs required for passing spam-check',
                      { msgType: 'spam_fail', reason: 'proofs', ip: ipAddress })
          return `Proofs are required: had ${proofsValid.length} valid, requires ${this.proofsRequired}`
        }
      } catch (err) {
        logger.error(err)
        return 'Proof validation failed'
      }
    }

    return false
  }

  async queueRegistration(subdomainName: string, owner: string,
                    sequenceNumber: number, zonefile: string,
                    ipAddress: string = '', authorization: ?string = '') : Promise<void> {
    const inQueue = await this.isSubdomainInQueue(subdomainName)
    if (inQueue) {
      logger.warn(`Name queued already: ${subdomainName}`,
                  { msgType: 'repeat_name', name: subdomainName, ip: ipAddress })
      throw new Error('Subdomain operation already queued for this name.')
    }

    const isValid = await isRegistrationValid(
      subdomainName, this.domainName, owner, sequenceNumber, zonefile)

    if (!isValid) {
      logger.warn(`Discarding operation for ${subdomainName} because it failed validation.`)
      throw new Error('Requested subdomain operation is invalid.')
    }

    const isSpam = await this.spamCheck(
      subdomainName, owner, zonefile, ipAddress, authorization)

    if (isSpam) {
      throw new Error(isSpam)
    }

    try {
      await this.lock.acquire(QUEUE_LOCK, async () => {
        try {
          await this.db.addToQueue(subdomainName, owner, sequenceNumber, zonefile)
          try {
            await this.db.logRequestorData(subdomainName, owner, ipAddress)
          } catch (err) {
            logger.error(`Setting status for ${subdomainName} as errored.`)
            await this.db.updateStatusFor([subdomainName], 'Error logging ip info', '')
            throw err
          }
          logger.info('Queued registration request.',
                      { msgType: 'queued', name: subdomainName, owner, ip: ipAddress })
        } catch (err) {
          logger.error(`Error processing registration: ${err}`)
          logger.error(err.stack)
          throw err
        }
      }, { timeout: 5000 })
    } catch(err) {
      if (err && err.message && err.message == 'async-lock timed out') {
        logger.error('Failure acquiring registration lock',
                     { msgType: 'lock_acquire_fail' })
        throw new Error('Failed to obtain lock')
      } else {
        throw err
      }
    }
  }

  async getSubdomainStatus(subdomainName: string):
  Promise<{status: string, statusCode?: number}> {
    if (await isSubdomainRegistered(`${subdomainName}.${this.domainName}`)) {
      return { status: 'Subdomain propagated' }
    } else {
      const rows = await this.db.getStatusRecord(subdomainName)

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
    }
  }

  async isSubdomainInQueue(subdomainName: string): Promise<boolean> {
    const status = await this.getSubdomainStatus(subdomainName)
    return (status.statusCode !== 404)
  }

  backupZonefile(zonefile: string) {
    return this.db.backupZonefile(zonefile)
  }

  addTransactionToTrack(txHash: string, zonefile: string) {
    return this.db.trackTransaction(txHash, zonefile)
  }

  updateQueueStatus(namesSubmitted: Array<string>, txHash: string) {
    return this.db.updateStatusFor(namesSubmitted, 'submitted', txHash)
  }

  markTransactionsComplete(entries: Array<{txHash: string}>) {
    if (entries.length > 0) {
      logger.info(`${entries.length} transactions newly finished.`,
                  { msgType: 'tx_finish', count: entries.length })
    } else {
      logger.debug(`${entries.length} transactions newly finished.`)
      return Promise.resolve()
    }

    return this.db.flushTrackedTransactions(entries)
  }

  fetchQueue() {
    return this.db.fetchQueue()
  }

  submitBatch() : Promise<string> {
    return this.lock.acquire(QUEUE_LOCK, () => {
      logger.debug('Obtained lock, fetching queue.')
      return this.fetchQueue()
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
                                  'because it is not valid.',
                                  { msgType: 'skip_batch_inclusion', name: op.subdomainName }))
              return valid
            })
        })
        .then(queue => {
          if (queue.length === 0) {
            logger.debug(`${queue.length} items in the queue.`)
            return null
          }
          logger.info(`Constructing batch with ${queue.length} currently queued.`,
                      { msgType: 'begin_batch', currentQueue: queue.length })
          const update = makeUpdateZonefile(this.domainName, this.uriEntries,
                                            queue, this.zonefileSize)
          const zonefile = update.zonefile
          const updatedFromQueue = update.submitted
          logger.debug(`[${JSON.stringify(updatedFromQueue)}] will be in this batch.`)
          logger.info(`Batch will contain ${updatedFromQueue.length} entries.`,
                      { msgType: 'built_batch', currentQueue: queue.length, batchSize: updatedFromQueue.length })

          return this.backupZonefile(zonefile)
            .then(() => submitUpdate(this.domainName, zonefile,
                                     this.ownerKey, this.paymentKey))
            .then((txHash) => {
              return this.updateQueueStatus(updatedFromQueue, txHash)
            })
            .then((txHash) => this.addTransactionToTrack(txHash, zonefile))
        })
        .then(txHash => {
          if (txHash) {
            logger.info('Batch submitted', { msgType: 'batch_submitted', txid: txHash })
          } else {
            logger.debug('No batch submitted')
          }
          return txHash
        })
        .catch((err) => {
          logger.error(`Failed to submit batch: ${err}`)
          logger.error(err.stack)
          throw err
        })
    }, { timeout: 5000 })
      .catch((err) => {
        if (err && err.message && err.message == 'async-lock timed out') {
          throw new Error('Failed to obtain lock')
        } else {
          throw err
        }
      })
  }

  getSubdomainInfo(fullyQualifiedName: string) {
    if (!fullyQualifiedName.endsWith(`.${this.domainName}`)) {
      return Promise.resolve({
        message: { error: 'Wrong domain' },
        statusCode: 400 })
    }
    const namePieces = fullyQualifiedName.split('.')
    if (namePieces.length !== 3) {
      return Promise.resolve({
        message: { error: 'Bad name' },
        statusCode: 400 })
    }
    const subdomainName = namePieces[0]
    return this.db.getStatusRecord(subdomainName)
      .then((rows) => {
        if (rows.length > 0) {
          const statusRecord = rows[0]
          const nameRecord = { blockchain: 'bitcoin',
                               status: 'unknown',
                               last_txid: '', // eslint-disable-line camelcase
                               zonefile: statusRecord.zonefile,
                               address: statusRecord.owner,
                               zonefile_hash: '' } // eslint-disable-line camelcase
          if (statusRecord.status === 'received') {
            nameRecord.status = 'pending_subdomain'
            nameRecord.last_txid = '' // eslint-disable-line camelcase
          } else if (statusRecord.status === 'submitted') {
            nameRecord.status = 'submitted_subdomain'
            nameRecord.last_txid = statusRecord.status_more // eslint-disable-line camelcase
          }
          nameRecord.zonefile_hash = hash160( // eslint-disable-line camelcase
            Buffer.from(nameRecord.zonefile)).toString('hex')
          return { message: nameRecord,
                   statusCode: 200 }
        } else if (!this.isValidLength(subdomainName)) {
          return { message: { status: 'invalid_name' },
                   statusCode: 400 }
        } else {
          return { message: { status: 'available' },
                   statusCode: 404 }
        }
      })
  }

  checkZonefiles() {
    logger.debug('Checking for outstanding transactions.')
    return this.lock.acquire(QUEUE_LOCK, () => {
      logger.debug('Obtained lock, checking transactions.')

      return this.db.getTrackedTransactions()
        .then(entries => {
          if (entries.length > 0) {
            logger.info(`${entries.length} outstanding transactions.`,
                        { msgType: 'outstanding_tx', count: entries.length })
          } else {
            logger.debug(`${entries.length} outstanding transactions.`)
          }
          return checkTransactions(entries)
        })
        .then(txStatuses => {
          this.markTransactionsComplete(
            txStatuses.filter(x => x.status))
          logger.debug('Lock released')
        })
        .catch((err) => {
          logger.error(`Failure trying to publish zonefiles: ${err}`)
          logger.error(err.stack)
          throw new Error(`Failed to check transaction status: ${err}`)
        })
    }, { timeout: 1 })
      .catch((err) => {
        if (err && err.message && err.message == 'async-lock timed out') {
          throw new Error('Failed to obtain lock')
        } else {
          throw err
        }
      })
  }

  listSubdomainRecords(page: number) {
    logger.debug(`Listing subdomain page ${page}`)
    const timeLimit = (new Date().getTime() / 1000) - TIME_WEEK

    return this.db.listSubdomains(page, timeLimit)
      .then((rows) => rows.map((row) => {
        const formattedRow = {
          name: `${row.subdomainName}.${this.domainName}`,
          address: row.owner,
          sequence: row.sequenceNumber,
          zonefile: row.zonefile,
          status: row.status,
          iterator: row.queue_ix
        }
        return formattedRow
      }))
      .then((rows) => ({ message: rows, statusCode: 200 }))
  }

  shutdown() {
    return this.db.shutdown()
  }
}
