export function getDomainInfo() {
  throw new Error('Not implemented')
}

export function isSubdomainRegistered() {
  throw new Error('Not implemented')
}

export function validlySignedUpdate() {
  throw new Error('Not implemented')
}

export function isRegistrationValid(
  subdomainName: String, domainName: String,
  owner: String, sequenceNumber: Number, zonefile: String) {
  // currently, only support *new* subdomains
  if (sequenceNumber !== 0) {
    return false
  }
  // owner should be a bitcoin address
  const btcRegex = /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/
  if (!btcRegex.test(owner)) {
    return false
  }
  // subdomain name should be a legal name
  const subdomainRegex = /^[a-z0-9\-_+]{1,37}$/
  if (!subdomainRegex.test(subdomainName)) {
    return false
  }
  // shouldn't already exist
  if (isSubdomainRegistered()) {
    return false
  }

  return true
}
