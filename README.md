# Install

To install from source:

```bash
$ git clone https://github.com/blockstack/subdomain-registrar.git
$ npm i
```

# Starting up the registrar

You can run the registrar in place from its source directory, and you can specify your config file via the `BSK_SUBDOMAIN_CONFIG` environment parameter. 

```bash
BSK_SUBDOMAIN_CONFIG=/home/aaron/devel/subdomain-registrar/my-local-config.json npm run start
```

You can also install the subdomain registrar globally.  It should install as the program `blockstack-subdomain-registrar`.

```bash
$ sudo npm i -g   # or, "sudo npm link"
$ which blockstack-subdomain-registrar
/usr/bin/blockstack-subdomain-registrar
```

# Basic Operation

The subdomain registrar functions roughly as follows --- you give the registrar a _domain_ to register subdomains under, you fund a wallet to submit registrations with, it accepts registration requests, and then it periodically issues _batches_ of name registrations. 

### Setting the Domain Name

For example, if I want to register names like `alice.people.id` or `bob.people.id`, I have to:

1. Already own `people.id`
2. Set the `BSK_SUBDOMAIN_OWNER_KEY` to the private key hex string which owns `people.id` (this is a 64-character hex-string with `01` appended if the address is compressed, which is usually the case)
3. Set the domain name property in the `config.json` to `people.id`

### Funding a wallet

Each batch of registrations is an _update_ transaction -- the Bitcoin transaction fee for this must be paid by the registrar. This requires a payment-address. You must:

1. Set the `BSK_SUBDOMAIN_PAYMENT_KEY` to a private key hex string (again, a 64-character hex string with `01` appended if the address is compressed, which is usually the case).
2. Send Bitcoin funds to the address which corresponds to that private key.

### Waiting for a batch

When a batch is issued, it take 6-7 bitcoin blocks before the rest of the Blockstack network will pick up and process the transaction. This means that it is usually a little over an hour before the registrations within a given batch will appear on other services (e.g., the blockstack-browser, blockstack explorer, etc.).

### Spam Counter Measures

You can deploy many different spam protection schemes via a front-end service, however, this subdomain registrar
also supports performing some spam protection on its own. You can configure IP limiting (i.e., limiting the number
of names registered by a given IP) and social proof verification.

Social proof verification performs the normal
Blockstack JWT verification and social proof checks, provided by
[blockstack.js](https://github.com/blockstack/blockstack.js).

In order to support registration requests from "trusted sources", you can use the `apiKeys` configuration option
to add an array of allowed api keys. Requests with an `Authorization: bearer <apiKey>` header will then be able to
skip the spam countermeasures.

### Private Key Storage

You can either store your private key hexes in your config.json, or pass them
in via environment variables `BSK_SUBDOMAIN_OWNER_KEY` and `BSK_SUBDOMAIN_PAYMENT_KEY`,
and then clear those after the process starts.


### Private Key Formatting

A common issue when configuring the subdomain registrar relates to private key formatting. A bare private key hex string is 64-characters (corresponding to a 32-byte ECDSA private key), for example:

```
9bffeccf649d21814ce6a605ad5cb1bdf1ac9ee44c53ef08a292af82875154df
```

Now -- this key actually corresponds to two different bitcoin addresses -- a [compressed and an uncomprossed address](https://bitcoin.org/en/glossary/compressed-public-key). Most bitcoin addresses in use (and the kind used by the Blockstack Browser) are compressed. The standard way to denote that the corresponding public-key should be compressed is by appending `01` to the private key: this results in a 66-character hex string private key.

For example, these are the two different addresses for the above key:
```
var bsk = require('blockstack')
bsk.hexStringToECPair('9bffeccf649d21814ce6a605ad5cb1bdf1ac9ee44c53ef08a292af82875154df01').getAddress()
'1QJM5ESqzWKW6pF2Ho7BGBX7MpepmxedU2'
bsk.hexStringToECPair('9bffeccf649d21814ce6a605ad5cb1bdf1ac9ee44c53ef08a292af82875154df').getAddress()
'14K3MSHixgt9FSjPEgLD8YrMEk3ss5QyYN'
```

In most cases, you want to use the compressed key.

### Configuring Instantaneous Resolution

Per the design outlined [here](https://github.com/blockstack/blockstack-core/issues/750), the subdomain
registrar can be configured so that blockstack indexer nodes will respond with HTTP 301 status codes
for missing subdomains. The 301 redirect will send the name lookup request to a URI designated by
the _domain_ name. In a standard setup, this would allow nearly _instantaneous_ resolution of subdomain
names. (*Note:* these names will not have been committed to the blockchain yet, and therefore the response
from the designated endpoint _do not_ have the same security properties as committed names).

To support this, the subdomain registrar is capable of responding to `/v1/names/foo.bar.id` style requests,
and can be configured to set the `_resolver` URI entry in each zonefile that it publishes. To enable this
behavior, set the `resolverUri` setting in your `config.json` file to a public-facing URL for your registrar.
We recommend placing this GET `/v1/names/` endpoint behind a caching layer of some kind.

### Monitoring via Prometheus

You can configure a monitoring service for the subdomain registrar via adding a `prometheus` field to the configuration file:

```
"prometheus": { "start": true, "port": 5941 }
```

Or by setting the environment variable `BSK_SUBDOMAIN_PROMETHEUS_PORT`

# Sample Curl Scripts


Queue a registration:

```bash
$ curl -X POST -H 'Authorization: bearer API-KEY-IF-USED' -H 'Content-Type: application/json' --data '{"zonefile": "$ORIGIN spqr\n$TTL 3600\n_https._tcp URI 10 1 \"https://gaia.blockstack.org/hub/1HgW81v6MxGD76UwNbHXBi6Zre2fK8TwNi/profile.json\"\n", "name": "spqr", "owner_address": "1HgW81v6MxGD76UwNbHXBi6Zre2fK8TwNi"}' http://localhost:3000/register/
```

Force a batch:

```bash
$ curl http://localhost:3000/issue_batch -X POST -H 'Authorization: bearer PASSWORDHERE'
```

Force zonefile check:

```bash
$ curl http://localhost:3000/check_zonefile -X POST -H 'Authorization: bearer PASSWORDHERE'
```

Check subdomain status:

```bash
$ curl http://localhost:3000/status/spqr | jq .

{
  "status": "Your subdomain was registered in transaction 6652bd350f048cd190ff04a5f0cdebbc166b13f3fd0e1126eacec8c600c25c6f -- it should propagate on the network once it has 6 confirmations."
}

```

# Running with Docker

First copy the config file into a data directory and modify it to suit your needs:

```bash
mkdir -p data
cp config-sample.json data/config.json
vi config.json
```

Once that is done you can spin up the instance using docker-compose. The file will build the image as well:

```bash
docker-compose up -d 
```

If you would like to run w/o compose you can do the same with docker:

```bash
# First build the image
docker build . --tag bsk-subdomain-registrar

# Then run it with the proper volumes mounted
docker run -d -v data:/root/ -e BSK_SUBDOMAIN_CONFIG=/root/config.json -p 3000:3000 bsk-subdomain-registrar
```

Root stores the sqlite database that the subdomain uses to queue registrations, and watch zonefiles for broadcasting. To test connectivity for this setup run the following curl command:

```bash
$ curl http://localhost:3000/index | jq
{
  "status": true
}
```
