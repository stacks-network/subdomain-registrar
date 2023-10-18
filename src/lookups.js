import { config as bskConfig, validateProofs, resolveZoneFileToProfile } from 'blockstack'
import { validateStacksAddress } from '@stacks/transactions'
import axios from 'axios'
import logger from 'winston'

export async function isSubdomainRegistered(fullyQualifiedAddress: String) {
  const nameInfoUrl = bskConfig.network.coreApiUrl + '/v1/names/' + fullyQualifiedAddress
  try {
    const request = await axios.get(nameInfoUrl)
    return (request.data.status === 'registered_subdomain')
  } catch (err) {
    if (err.response.data.message === 'Name not found'
      || err.response.data.message === 'Bad response status: 500'
      || err.response.status !== 200) {
      return false
    }
    logger.error(`Error checking registered subdomain from ${nameInfoUrl}: ${err}`)
    throw err
  }
}

export function validlySignedUpdate() {
  throw new Error('Not implemented')
}

export function checkProofs(owner, zonefile) {
  return resolveZoneFileToProfile(zonefile, owner)
    .then((profile) => validateProofs(profile, owner))
    .then((proofs) => proofs.filter(x => x.valid))
}

export async function isRegistrationValid(
  subdomainName: String, domainName: String,
  owner: String, sequenceNumber: Number, checkCore: boolean) {
  // currently, only support *new* subdomains
  if (sequenceNumber !== 0) {
    logger.debug(`seqn: ${sequenceNumber} failed validation`)
    return false
  }

  // owner should be a stacks address
  if (!validateStacksAddress(owner)) {
    logger.debug(`owner: ${owner} failed validation`)
    return false
  }

  // subdomain name should be a legal name
  const subdomainRegex = /^[a-z0-9\-_+]{1,37}$/
  if (!subdomainRegex.test(subdomainName)) {
    logger.debug(`subdomainName: ${subdomainName} failed validation`)
    return false
  }
  if (!checkCore) {
    return true
  }

  // shouldn't already exist
  try {
    const isRegistered = await isSubdomainRegistered(`${subdomainName}.${domainName}`)
    if (isRegistered) {
      logger.warn(`${subdomainName}.${domainName} already exists`)
    }
    return !isRegistered
  } catch (e) {
    logger.error(e)
    return false
  }
}
