import sqlite3 from 'sqlite3'
import logger from 'winston'

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

const CREATE_IP_INFO = `CREATE TABLE ip_info (
 ipinfo_ix INTEGER PRIMARY KEY,
 ip_address TEXT NOT NULL,
 owner TEXT NOT NULL,
 queue_ix INTEGER NOT NULL
);`

const CREATE_IP_INFO_INDEX = `CREATE INDEX ip_info_index ON
 ip_info (ip_address);`

function dbRun(db: Object, cmd: String, args?: Array) {
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

function dbAll(db: Object, cmd: String, args?: Array) {
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
  constructor(dbLocation: String) {
    this.dbLocation = dbLocation
  }

  initialize() {
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
                this.createTablesAndCreate()
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

  checkTablesAndCreate() {
    return this.tablesExist()
      .then(needsCreation => {
        if (needsCreation.length === 0) {
          return Promise.resolve()
        } else {
          logger.info(`Creating ${needsCreation.length} tables.`)
          return this.createTables(needsCreation)
        }
      })
  }

  tablesExist() {
    return dbAll(this.db, 'SELECT name FROM sqlite_master WHERE type = "table"')
      .then( results => {
        const tables = results.map( x => x.name )
        const toCreate = []
        if (tables.indexOf('subdomain_queue') < 0) {
          toCreate.push(CREATE_QUEUE)
          toCreate.push(CREATE_QUEUE_INDEX)
        }
        if (tables.indexOf('subdomain_zonefile_backups') < 0) {
          toCreate.push(CREATE_MYZONEFILE_BACKUPS)
        }
        if (tables.indexOf('transactions_tracked') < 0) {
          toCreate.push(CREATE_TRANSACTIONS_TRACKED)
        }
        if (tables.indexOf('ip_info') < 0) {
          toCreate.push(CREATE_IP_INFO)
          toCreate.push(CREATE_IP_INFO_INDEX)
        }

        return toCreate
      })
  }

  createTables(toCreate:Array<string>) {
    let creationPromise = Promise.resolve()
    toCreate.forEach((createCmd) => {
      creationPromise = creationPromise.then(() => dbRun(this.db, createCmd))
    })
    return creationPromise
  }

  addToQueue(subdomainName, owner, sequenceNumber, zonefile) {
    const dbCmd = 'INSERT INTO subdomain_queue ' +
          '(subdomainName, owner, sequenceNumber, zonefile, status) VALUES (?, ?, ?, ?, ?)'
    const dbArgs = [subdomainName, owner, sequenceNumber, zonefile, 'received']
    return dbRun(this.db, dbCmd, dbArgs)
  }

  updateStatusFor(subdomains: Array<String>, status: String, statusMore: String) {
    const cmd = 'UPDATE subdomain_queue SET status = ?, status_more = ? WHERE subdomainName = ?'
    return Promise.all(subdomains.map(
      name => dbRun(this.db, cmd, [status, statusMore, name])))
      .then(() => statusMore)
  }

  logRequestorData(subdomainName: String, ownerAddress: String, ipAddress: String) {
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

  getOwnerAddressCount(ownerAddress: String) {
    const lookup = 'SELECT * FROM ip_info WHERE owner = ?'
    return dbAll(this.db, lookup, [ownerAddress])
      .then((results) => results.length)
  }

  getIPAddressCount(ipAddress: String) {
    const lookup = 'SELECT * FROM ip_info WHERE ip_address = ?'
    return dbAll(this.db, lookup, [ipAddress])
      .then((results) => results.length)
  }

  fetchQueue() {
    const cmd = 'SELECT subdomainName, owner, sequenceNumber, zonefile, signature' +
          ' FROM subdomain_queue WHERE status = "received"'
    return dbAll(this.db, cmd)
      .then((results) => results.map( // parse the sequenceNumber
        x => Object.assign({}, x, { sequenceNumber: parseInt(x.sequenceNumber) })))
  }

  getStatusRecord(subdomainName) {
    const lookup = 'SELECT status, status_more FROM subdomain_queue' +
          ' WHERE subdomainName = ? ORDER BY queue_ix DESC LIMIT 1'
    return dbAll(this.db, lookup, [subdomainName])
  }

  backupZonefile(zonefile: String) {
    return dbRun(this.db, 'INSERT INTO subdomain_zonefile_backups (zonefile) VALUES (?)',
                 [zonefile])
  }

  trackTransaction(txHash, zonefile) {
    return dbRun(this.db, 'INSERT INTO transactions_tracked (txHash, zonefile) VALUES (?, ?)',
                 [txHash, zonefile])
      .then(() => txHash)
  }

  getTrackedTransactions() {
    return dbAll(this.db, 'SELECT txHash, zonefile FROM transactions_tracked')
  }

  flushTrackedTransactions(transactions: Array<{txHash: String}>) {
    const cmd = 'DELETE FROM transactions_tracked WHERE txHash = ?'
    return Promise.all(transactions.map(
      entry => dbRun(this.db, cmd, [entry.txHash])))
  }

  shutdown() {
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
