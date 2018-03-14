# Install

To install from source:

```bash
$ git clone https://github.com/blockstack/subdomain-registrar.git
$ npm i
```


# Starting

You can specify your config file via the `BSK_SUBDOMAIN_CONFIG` environment parameter. 

```bash
BSK_SUBDOMAIN_CONFIG=/home/aaron/devel/subdomain-registrar/my-local-config.js npm run start
```

# Sample Curl Scripts


Queue a registration:

```bash
$ curl -X POST -H 'Authorization: bearer API-KEY-IF-USED' -H 'Content-Type: application/json' --data '{"zonefile": "$ORIGIN spqr\n$TTL 3600\n_file URI 10 1 \"https://gaia.blockstack.org/hub/1HgW81v6MxGD76UwNbHXBi6Zre2fK8TwNi\"\n", "name": "spqr", "owner_address": "1HgW81v6MxGD76UwNbHXBi6Zre2fK8TwNi"}' http://localhost:3000/register/
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

# Spam Counter Measures

You can deploy many different spam protection schemes via a front-end service, however, this subdomain registrar
also supports performing some spam protection on its own. You can configure IP limiting (i.e., limiting the number
of names registered by a given IP) and social proof verification.

Social proof verification performs the normal
Blockstack JWT verification and social proof checks, provided by
[blockstack.js](https://github.com/blockstack/blockstack.js).

In order to support registration requests from "trusted sources", you can use the `apiKeys` configuration option
to add an array of allowed api keys. Requests with an `Authorization: bearer <apiKey>` header will then be able to
skip the spam countermeasures.


# Private Key Storage

You can either store your private key hexes in your config.json, or pass them
in via environment variables `BSK_SUBDOMAIN_OWNER_KEY` and `BSK_SUBDOMAIN_PAYMENT_KEY`,
and then clear those after the process starts.

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
