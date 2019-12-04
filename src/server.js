/* @flow */
import logger from 'winston'
import AsyncLock from 'async-lock'

import { updateGlobalBlockHeight, makeUpdateZonefile, submitUpdate, checkTransactions, hash160 } from './operations'
import { isRegistrationValid, isSubdomainRegistered, checkProofs } from './lookups'
import { RegistrarQueueDB } from './db'
import type { SubdomainRecord, QueueRecord } from './db'

const TIME_WEEK = 604800
const QUEUE_LOCK = 'queue'

export const SERVER_GLOBALS = { lastSeenBlockHeight: 0 }

type SubdomainResult = {
  name: string,
  address: string,
  sequence: number,
  zonefile: string,
  status: string,
  iterator: number }

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
  checkCoreOnBatching: boolean
  lastSeenBlock: number

  constructor(config: {domainName: string, ownerKey: string,
                       paymentKey: string, dbLocation: string,
                       domainUri?: ?string, resolverUri: ?string,
                       zonefileSize: number,
                       ipLimit: number, proofsRequired: number,
                       disableRegistrationsWithoutKey: boolean,
                       checkCoreOnBatching: boolean,
                       apiKeys?: Array<string>,
                       ipWhitelist?: Array<string>,
                       nameMinLength: number}) {

    this.lastSeenBlock = 0

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
    this.checkCoreOnBatching = config.checkCoreOnBatching
    this.db = new RegistrarQueueDB(config.dbLocation)
    this.lock = new AsyncLock()
  }

  async initializeServer() {
    // reset global var -- this will only come up in testing,
    //  at runtime, it's one server instance per process
    SERVER_GLOBALS.lastSeenBlockHeight = 0
    await updateGlobalBlockHeight()
    await this.db.initialize()
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
    // do a quick pre-check for the subdomain name so that we can exit early in the
    //   the "non-race-condition" case.
    const inQueue = await this.isSubdomainInQueue(subdomainName)
    if (inQueue) {
      logger.warn(`Name queued already: ${subdomainName}`,
                  { msgType: 'repeat_name', name: subdomainName, ip: ipAddress })
      throw new Error('Subdomain operation already queued for this name.')
    }

    const isValid = await isRegistrationValid(
      subdomainName, this.domainName, owner, sequenceNumber, true)

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
          // check again while holding the QUEUE_LOCK in case we raced.
          if (await this.isSubdomainInQueue(subdomainName)) {
            logger.warn(`Name queued already: ${subdomainName}`,
                        { msgType: 'repeat_name', name: subdomainName, ip: ipAddress })
            throw new Error('Subdomain operation already queued for this name.')
          }
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

  async markTransactionsComplete(entries: Array<{ txHash: string, status: boolean, blockHeight: number }>): Promise<void> {
    if (entries.length > 0) {
      logger.info(`${entries.length} transactions newly finished.`,
                  { msgType: 'tx_finish', count: entries.length })
    } else {
      logger.debug(`${entries.length} transactions newly finished.`)
      return
    }

    return await this.db.flushTrackedTransactions(entries)
  }

  async submitBatch() : Promise<string> {
    try {
      return await this.lock.acquire(QUEUE_LOCK, async () => {
        try {
          logger.debug('Obtained lock, fetching queue.')
          const queue: QueueRecord[] = await this.db.fetchQueue()
          const results = await Promise.all(
            queue.map(subdomainOp => isRegistrationValid(
              subdomainOp.subdomainName, this.domainName, subdomainOp.owner,
              parseInt(subdomainOp.sequenceNumber), this.checkCoreOnBatching)))
          const valid = queue.filter((op, opIndex) => results[opIndex])
          const invalid = queue.filter((op, opIndex) => !results[opIndex])
          invalid.forEach(
            op => logger.warn(`Skipping registration of ${op.subdomainName} ` +
                              'because it is not valid.',
                              { msgType: 'skip_batch_inclusion', name: op.subdomainName }))

          if (valid.length === 0) {
            logger.debug(`${valid.length} items in the queue.`)
            return null
          }
          logger.info(`Constructing batch with ${valid.length} currently queued.`,
                      { msgType: 'begin_batch', currentQueue: valid.length })
          const update = makeUpdateZonefile(this.domainName, this.uriEntries, valid, this.zonefileSize)
          const zonefile = update.zonefile
          const updatedFromQueue = update.submitted
          logger.debug(`[${JSON.stringify(updatedFromQueue)}] will be in this batch.`)
          logger.info(`Batch will contain ${updatedFromQueue.length} entries.`,
                      { msgType: 'built_batch', currentQueue: valid.length, batchSize: updatedFromQueue.length })

          await this.backupZonefile(zonefile)
          const txHash = await submitUpdate(this.domainName, zonefile, this.ownerKey, this.paymentKey)
          await this.updateQueueStatus(updatedFromQueue, txHash)
          await this.addTransactionToTrack(txHash, zonefile)
          logger.info('Batch submitted', { msgType: 'batch_submitted', txid: txHash })
          return txHash
        } catch (err) {
          logger.error(`Failed to submit batch: ${err}`)
          logger.error(err.stack)
          throw err
        }
      }, { timeout: 5000 })
    } catch (err) {
      if (err && err.message && err.message == 'async-lock timed out') {
        throw new Error('Failed to obtain lock')
      } else {
        throw err
      }
    }
  }

  async getSubdomainInfo(fullyQualifiedName: string) {
    if (!fullyQualifiedName.endsWith(`.${this.domainName}`)) {
      return { message: { error: 'Wrong domain' },
               statusCode: 400 }
    }
    const namePieces = fullyQualifiedName.split('.')
    if (namePieces.length !== 3) {
      return { message: { error: 'Bad name' },
               statusCode: 400 }
    }
    const subdomainName = namePieces[0]
    const rows = await this.db.getStatusRecord(subdomainName)

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
  }

  async checkZonefiles() {
    logger.debug('Checking for outstanding transactions.')
    try {
      return await this.lock.acquire(QUEUE_LOCK, async () => {
        logger.debug('Obtained lock, checking transactions.')

        try {
          const entries = await this.db.getTrackedTransactions()
          if (entries.length > 0) {
            logger.info(`${entries.length} outstanding transactions.`,
                        { msgType: 'outstanding_tx', count: entries.length })
          } else {
            logger.debug(`${entries.length} outstanding transactions.`)
          }
          const statuses = await checkTransactions(entries)

          await this.db.updateTransactionHeights(entries)

          const completed = statuses.filter(x => x.status)

          await this.markTransactionsComplete(completed)

          logger.debug('Lock released')
        } catch (err) {
          logger.error(`Failure trying to publish zonefiles: ${err}`)
          logger.error(err.stack)
          throw new Error(`Failed to check transaction status: ${err}`)
        }
      }, { timeout: 1 })
    } catch(err) {
      if (err && err.message && err.message == 'async-lock timed out') {
        throw new Error('Failed to obtain lock')
      } else {
        throw err
      }
    }
  }

  async listSubdomainRecords(page: number) {
    logger.debug(`Listing subdomain page ${page}`)
    const timeLimit = (new Date().getTime() / 1000) - TIME_WEEK

    const records: SubdomainRecord[] = await this.db.listSubdomains(page, timeLimit)
    const rows: SubdomainResult[] = records
          .map((row) => {
            const formattedRow = {
              name: `${row.subdomainName}.${this.domainName}`,
              address: row.owner,
              sequence: row.sequenceNumber,
              zonefile: row.zonefile,
              status: row.status,
              iterator: row.queue_ix
            }
            return formattedRow
          })
    return { message: rows, statusCode: 200 }
  }

  shutdown() {
    return this.db.shutdown()
  }
}
