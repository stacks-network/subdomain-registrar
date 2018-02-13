# Install

This depends on a still-in-development version of `blockstack.js`, which is the trickiest
part of setting up the service.

```bash
$ git clone https://github.com/blockstack/blockstack.js.git
$ cd blockstack.js && git checkout feature/blockstack-operations
$ npm i && npm run build && npm ln
$ cd ../subdomain-registrar
$ npm i && npm ln blockstack
```


# Starting

You can specify your config file via the `BSK_SUBDOMAIN_CONFIG` environment parameter. 

```bash
BSK_SUBDOMAIN_CONFIG=/home/aaron/devel/subdomain-registrar/my-local-config.js npm run start
```

# Sample Curl Scripts


Queue a registration:

```bash
$ curl -X POST -H 'Content-Type: application/json' --data '{"zonefile": "$ORIGIN spqr\n$TTL 3600\n_file URI 10 1 \"https://gaia.blockstack.org/hub/1HgW81v6MxGD76UwNbHXBi6Zre2fK8TwNi\"\n", "name": "spqr", "owner_address": "1HgW81v6MxGD76UwNbHXBi6Zre2fK8TwNi"}' http://localhost:3000/register/
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

# Private Key Storage

You can either store your private key hexes in your config.json, or pass them
in via environment variables `BSK_SUBDOMAIN_OWNER_KEY` and `BSK_SUBDOMAIN_PAYMENT_KEY`,
and then clear those after the process starts.

# Running with Docker

Build the docker image:

```bash
docker build . --tag bsk-subdomain-registrar
```

You'll want to mount `/root/`, and pass a config file option:

```bash
docker run -d -v data:/root/ -e BSK_SUBDOMAIN_CONFIG=/root/my-config.json -p 3000:3000 bsk-subdomain-registrar
```

Root stores the sqlite database that the subdomain uses to queue registrations, and watch zonefiles for broadcasting.
