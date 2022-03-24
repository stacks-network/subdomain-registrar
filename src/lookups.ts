import {
  config as bskConfig,
  validateProofs,
  resolveZoneFileToProfile,
} from "blockstack";
import { validateStacksAddress } from "@stacks/transactions";
import fetch from "node-fetch";
import logger from "winston";

export async function isSubdomainRegistered(fullyQualifiedAddress: string) {
  try {
    const nameInfoUrl =
      bskConfig.network.blockstackAPIUrl + "/v1/names/" + fullyQualifiedAddress;
    const nameInfoRequest = await fetch(nameInfoUrl, {});
    const { status } = nameInfoRequest;
    const nameInfo = await nameInfoRequest.json();
    if (status == 200) {
      return nameInfo.status === "registered_subdomain";
    } else {
      return false;
    }
  } catch (err) {
    if (err.message === "Name not found") {
      return false;
    } else if (err.message === "Bad response status: 500") {
      return false; // currently, the blockstack api returns 500 on subdomain lookup errors.
    } else {
      throw err;
    }
  }
}

export function validlySignedUpdate() {
  throw new Error("Not implemented");
}

export async function checkProofs(owner: string, zonefile: any) {
  const profile = await resolveZoneFileToProfile(zonefile, owner);
  const proofs = await validateProofs(profile, owner);
  return proofs.filter((x) => x.valid);
}

export async function isRegistrationValid(
  subdomainName: string,
  domainName: string,
  owner: string,
  sequenceNumber: number,
  checkCore: boolean
) {
  // currently, only support *new* subdomains
  if (sequenceNumber !== 0) {
    logger.debug(`seqn: ${sequenceNumber} failed validation`);
    return false;
  }

  // owner should be a stacks address
  if (!validateStacksAddress(owner)) {
    logger.debug(`owner: ${owner} failed validation`);
    return false;
  }

  // subdomain name should be a legal name
  const subdomainRegex = /^[a-z0-9\-_+]{1,37}$/;
  if (!subdomainRegex.test(subdomainName)) {
    logger.debug(`subdomainName: ${subdomainName} failed validation`);
    return false;
  }
  if (!checkCore) {
    return true;
  }

  // shouldn't already exist
  try {
    const isRegistered = await isSubdomainRegistered(
      `${subdomainName}.${domainName}`
    );
    if (isRegistered) {
      logger.warn(`${subdomainName}.${domainName} already exists`);
    }
    return !isRegistered;
  } catch (e) {
    logger.error(e);
    return false;
  }
}
