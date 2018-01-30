import { config as bskConfig } from 'blockstack'

export function isSubdomainRegistered(fullyQualifiedAddress: String) {
  return new Promise((resolve, reject) => {
    bskConfig.network.getNameInfo(fullyQualifiedAddress)
      .then(() => resolve(true))
      .catch((err) => {
        if (err.message === 'Name not found') {
          resolve(false)
        } else {
          reject(err)
        }
      })
  })
}

export function validlySignedUpdate() {
  throw new Error('Not implemented')
}

export function isRegistrationValid(
  subdomainName: String, domainName: String,
  owner: String, sequenceNumber: Number) {
  // currently, only support *new* subdomains
  if (sequenceNumber !== 0) {
    return Promise.resolve(false)
  }
  // owner should be a bitcoin address
  const btcRegex = /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/
  if (!btcRegex.test(owner)) {
    return Promise.resolve(false)
  }
  // subdomain name should be a legal name
  const subdomainRegex = /^[a-z0-9\-_+]{1,37}$/
  if (!subdomainRegex.test(subdomainName)) {
    return Promise.resolve(false)
  }

  // shouldn't already exist
  return isSubdomainRegistered(`${subdomainName}.${domainName}`)
    .then((isRegistered) => !isRegistered)
}
