import { config as bskConfig, validateProofs, resolveZoneFileToProfile } from 'blockstack'

import logger from 'winston'

export function isSubdomainRegistered(fullyQualifiedAddress: String) {
  return new Promise((resolve, reject) => {
    bskConfig.network.getNameInfo(fullyQualifiedAddress)
      .then(() => resolve(true))
      .catch((err) => {
        if (err.message === 'Name not found') {
          resolve(false)
        } else if (err.message === 'Bad response status: 500') {
          resolve(false) // currently, the blockstack api returns 500 on subdomain lookup errors.
        } else {
          reject(err)
        }
      })
  })
}

export function validlySignedUpdate() {
  throw new Error('Not implemented')
}

export function checkProofs(owner, zonefile) {
  return resolveZoneFileToProfile(zonefile, owner)
    .then((profile) => validateProofs(profile, owner))
    .then((proofs) => proofs.filter(x => x.valid))
}

export function isRegistrationValid(
  subdomainName: String, domainName: String,
  owner: String, sequenceNumber: Number) {
  // currently, only support *new* subdomains
  if (sequenceNumber !== 0) {
    logger.debug(`seqn: ${sequenceNumber} failed validation`)
    return Promise.resolve(false)
  }
  // owner should be a bitcoin address
  const btcRegex = /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/
  if (!btcRegex.test(owner)) {
    logger.debug(`owner: ${owner} failed validation`)
    return Promise.resolve(false)
  }
  // subdomain name should be a legal name
  const subdomainRegex = /^[a-z0-9\-_+]{1,37}$/
  if (!subdomainRegex.test(subdomainName)) {
    logger.debug(`subdomainName: ${subdomainName} failed validation`)
    return Promise.resolve(false)
  }

  // shouldn't already exist
  return isSubdomainRegistered(`${subdomainName}.${domainName}`)
    .then((isRegistered) => {
      if (isRegistered) {
        logger.debug(`${subdomainName}.${domainName} already exists`)
      }
      return !isRegistered
    })
    .catch((err) => {
      logger.error(`Error checking subdomain ${subdomainName}.${domainName} existence: ${err}`)
      logger.error(err.stack)
      return false
    })
}
