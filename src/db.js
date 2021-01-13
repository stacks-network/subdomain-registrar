/* @flow */

import sqlite3 from 'sqlite3'
import logger from 'winston'
const path = require('path')

export type QueueRecord = {
  subdomainName: string,
  owner: string,
  sequenceNumber: number,
  zonefile: string,
  signature: string
}

export type SubdomainRecord = {
  subdomainName: string,
  owner: string,
  sequenceNumber: number,
  zonefile: string,
  signature: string,
  status: string,
  queue_ix: number
}

const CREATE_QUEUE = `CREATE TABLE subdomain_queue (
 queue_ix INTEGER PRIMARY KEY,
 subdomainName TEXT NOT NULL,
 owner TEXT NOT NULL,
 sequenceNumber TEXT NOT NULL,
 zonefile TEXT NOT NULL,
 signature TEXT DEFAULT NULL,
 status TEXT NOT NULL,
 status_more TEXT,
 received_ts DATETIME DEFAULT CURRENT_TIMESTAMP
);`

const CREATE_QUEUE_INDEX = `CREATE INDEX subdomain_queue_index ON
 subdomain_queue (subdomainName);`

const CREATE_QUEUE_RECEIVED_INDEX = `CREATE INDEX subdomain_queue_received_index ON
 subdomain_queue (received_ts);`

const CREATE_MYZONEFILE_BACKUPS = `CREATE TABLE subdomain_zonefile_backups (
 backup_ix INTEGER PRIMARY KEY,
 zonefile TEXT NOT NULL,
 timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);`

const CREATE_TRANSACTIONS_TRACKED = `CREATE TABLE transactions_tracked (
 tracker_ix INTEGER PRIMARY KEY,
 txHash TEXT NOT NULL,
 zonefile TEXT NOT NULL
);`

const CREATE_TX_INFO = `CREATE TABLE transactions_info (
 txinfo_ix INTEGER PRIMARY KEY,
 txHash TEXT NOT NULL UNIQUE,
 blockHeight INTEGER DEFAULT 0
);`

const CREATE_IP_INFO = `CREATE TABLE ip_info (
 ipinfo_ix INTEGER PRIMARY KEY,
 ip_address TEXT NOT NULL,
 owner TEXT NOT NULL,
 queue_ix INTEGER NOT NULL
);`

const CREATE_IP_INFO_INDEX = `CREATE INDEX ip_info_index ON
 ip_info (ip_address);`

const SUBDOMAIN_PAGE_SIZE = 100

function dbRun(db: sqlite3.Database, cmd: string, args?: Array<Object>): Promise<void> {
  if (!args) {
    args = []
  }
  return new Promise((resolve, reject) => {
    db.run(cmd, args, (err) => {
      if (err) {
        reject(err)
      } else {
        resolve()
      }
    })
  })
}

function dbAll(db: sqlite3.Database, cmd: string, args?: Array<Object>): Promise<Array<Object>> {
  if (!args) {
    args = []
  }
  return new Promise((resolve, reject) => {
    db.all(cmd, args, (err, rows) => {
      if (err) {
        reject(err)
      } else {
        resolve(rows)
      }
    })
  })
}


export class RegistrarQueueDB {
  dbLocation: string
  db: sqlite3.Database

  constructor(dbLocation: string) { // eslint-disable-line
    const dbPath = path.resolve(__dirname, 'subdomain_registrar.db')
    this.dbLocation = dbPath
  }

  initialize(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(this.dbLocation, sqlite3.OPEN_READWRITE, (errOpen) => {
        if (errOpen) {
          logger.warn(`No database found ${this.dbLocation}, creating`)
          this.db = new sqlite3.Database(
            this.dbLocation, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (errCreate) => {
              if (errCreate) {
                reject(`Failed to load database ${this.dbLocation}`)
              } else {
                logger.warn('Creating tables...')
                this.checkTablesAndCreate()
                  .then(() => resolve())
              }
            })
        } else {
          return this.checkTablesAndCreate()
            .then(() => resolve())
        }
      })
    })
  }

  async checkTablesAndCreate(): Promise<void> {
    const needsCreation = await this.tablesExist()
    if (needsCreation.length === 0) {
      return
    } else {
      logger.info(`Creating ${needsCreation.length} tables.`)
      await this.createTables(needsCreation)
    }
  }

  tablesExist() {
    return dbAll(this.db, 'SELECT name FROM sqlite_master WHERE type = "table"')
      .then(results => {
        const tables = results.map(x => x.name)
        const toCreate = []
        if (tables.indexOf('subdomain_queue') < 0) {
          toCreate.push(CREATE_QUEUE)
          toCreate.push(CREATE_QUEUE_INDEX)
          toCreate.push(CREATE_QUEUE_RECEIVED_INDEX)
        }
        if (tables.indexOf('subdomain_zonefile_backups') < 0) {
          toCreate.push(CREATE_MYZONEFILE_BACKUPS)
        }
        if (tables.indexOf('transactions_tracked') < 0) {
          toCreate.push(CREATE_TRANSACTIONS_TRACKED)
        }
        if (tables.indexOf('transactions_info') < 0) {
          toCreate.push(CREATE_TX_INFO)
        }
        if (tables.indexOf('ip_info') < 0) {
          toCreate.push(CREATE_IP_INFO)
          toCreate.push(CREATE_IP_INFO_INDEX)
        }

        return toCreate
      })
  }

  async createTables(toCreate: Array<string>): Promise<void> {
    for (const createCmd of toCreate) {
      await dbRun(this.db, createCmd)
    }
  }

  addToQueue(subdomainName: string, owner: string, sequenceNumber: number, zonefile: string): Promise<void> {
    const dbCmd = 'INSERT INTO subdomain_queue ' +
      '(subdomainName, owner, sequenceNumber, zonefile, status) VALUES (?, ?, ?, ?, ?)'
    const dbArgs = [subdomainName, owner, sequenceNumber, zonefile, 'received']
    return dbRun(this.db, dbCmd, dbArgs)
  }

  async updateStatusFor(subdomains: Array<string>, status: string, statusMore: string): Promise<string> {
    const cmd = 'UPDATE subdomain_queue SET status = ?, status_more = ? WHERE subdomainName = ?'
    await Promise.all(subdomains.map(
      name => dbRun(this.db, cmd, [status, statusMore, name])))
    return statusMore
  }

  logRequestorData(subdomainName: string, ownerAddress: string, ipAddress: string) {
    const lookup = `SELECT queue_ix FROM subdomain_queue WHERE subdomainName = ?
                    AND owner = ? AND sequenceNumber = 0`
    const insert = 'INSERT INTO ip_info (ip_address, owner, queue_ix) VALUES (?, ?, ?)'
    return dbAll(this.db, lookup, [subdomainName, ownerAddress])
      .then((results) => {
        if (results.length != 1) {
          throw new Error('No queued entry found.')
        }
        const queueIndex = results[0].queue_ix
        return dbRun(this.db, insert, [ipAddress, ownerAddress, queueIndex])
      })
  }

  getOwnerAddressCount(ownerAddress: string) {
    const lookup = 'SELECT * FROM ip_info WHERE owner = ?'
    return dbAll(this.db, lookup, [ownerAddress])
      .then((results) => results.length)
  }

  getIPAddressCount(ipAddress: string) {
    const lookup = 'SELECT * FROM ip_info WHERE ip_address = ?'
    return dbAll(this.db, lookup, [ipAddress])
      .then((results) => results.length)
  }

  async fetchQueue(): Promise<QueueRecord[]> {
    const cmd = 'SELECT subdomainName, owner, sequenceNumber, zonefile, signature' +
      ' FROM subdomain_queue WHERE status = "received"'
    const results: {
      subdomainName: string,
      owner: string,
      sequenceNumber: string,
      zonefile: string,
      signature: string
    }[] = await dbAll(this.db, cmd)
    return results.map(x => {
      const out = {
        subdomainName: x.subdomainName,
        owner: x.owner,
        sequenceNumber: parseInt(x.sequenceNumber),
        zonefile: x.zonefile,
        signature: x.signature
      }
      return out
    })
  }

  getStatusRecord(subdomainName: string) {
    const lookup = 'SELECT status, status_more, owner, zonefile FROM subdomain_queue' +
      ' WHERE subdomainName = ? ORDER BY queue_ix DESC LIMIT 1'
    return dbAll(this.db, lookup, [subdomainName])
  }

  async listSubdomains(iterator: number, timeLimit: number): Promise<SubdomainRecord[]> {
    const listSQL = 'SELECT subdomainName, owner, sequenceNumber, zonefile, signature, ' +
      'status, queue_ix FROM subdomain_queue WHERE ' +
      'queue_ix >= ? AND received_ts >= DATETIME(?, "unixepoch") ORDER BY queue_ix LIMIT ?'
    const results: {
      subdomainName: string,
      owner: string,
      sequenceNumber: string,
      zonefile: string,
      signature: string,
      status: string,
      queue_ix: number
    }[] =
      await dbAll(this.db, listSQL, [iterator, timeLimit, SUBDOMAIN_PAGE_SIZE])
    return results.map(x => {
      const out = {
        subdomainName: x.subdomainName,
        owner: x.owner,
        sequenceNumber: parseInt(x.sequenceNumber),
        zonefile: x.zonefile,
        signature: x.signature,
        status: x.status,
        queue_ix: x.queue_ix
      }
      return out
    })
  }

  backupZonefile(zonefile: string): Promise<void> {
    return dbRun(this.db, 'INSERT INTO subdomain_zonefile_backups (zonefile) VALUES (?)',
      [zonefile])
  }

  async trackTransaction(txHash: string, zonefile: string): Promise<string> {
    await dbRun(this.db, 'INSERT INTO transactions_tracked (txHash, zonefile) VALUES (?, ?)',
      [txHash, zonefile])
    return txHash
  }

  getTrackedTransactions() {
    return dbAll(this.db,
      'SELECT t.txHash, t.zonefile, IFNULL(ti.blockHeight, 0) as blockHeight FROM transactions_tracked as t ' +
      'LEFT JOIN transactions_info as ti ON t.txHash = ti.txHash')
  }

  async updateTransactionHeights(transactions: Array<{ txHash: string, blockHeight: number, status: boolean }>): Promise<void> {
    const cmd = 'REPLACE INTO transactions_info(txHash, blockHeight) VALUES (?, ?)'
    await Promise.all(transactions.map(
      entry => dbRun(this.db, cmd, [entry.txHash, entry.blockHeight])))
  }

  async flushTrackedTransactions(transactions: Array<{ txHash: string, blockHeight: number, status: boolean }>): Promise<void> {
    let cmd = 'DELETE FROM transactions_tracked WHERE txHash = ?'
    await Promise.all(transactions.map(
      entry => dbRun(this.db, cmd, [entry.txHash])))
    cmd = 'DELETE FROM transactions_info WHERE txHash = ?'
    await Promise.all(transactions.map(
      entry => dbRun(this.db, cmd, [entry.txHash])))
  }

  shutdown(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.close((err) => {
        if (err) {
          reject(err)
        } else {
          resolve()
        }
      })
      this.db = undefined
    })
  }
}
