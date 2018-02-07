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
                this.createTables()
                  .then(() => resolve())
              }
            })
        } else {
          this.tablesExist()
            .then( exist => {
              if (exist) {
                return Promise.resolve()
              } else {
                return this.createTables()
              }
            })
            .then(() => resolve())
        }
      })
    })
  }

  tablesExist() {
    return dbAll(this.db, 'SELECT name FROM sqlite_master WHERE type = "table"')
      .then( results => {
        const tables = results.map( x => x.name )
        return tables.indexOf('subdomain_queue') >= 0 &&
          tables.indexOf('subdomain_zonefile_backups') >= 0 &&
          tables.indexOf('transactions_tracked') >= 0
      })
  }

  createTables() {
    const toCreate = [CREATE_QUEUE, CREATE_QUEUE_INDEX, CREATE_MYZONEFILE_BACKUPS,
                      CREATE_TRANSACTIONS_TRACKED]
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
