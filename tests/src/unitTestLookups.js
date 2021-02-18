import { isSubdomainRegistered, isRegistrationValid, validlySignedUpdate } from '../../lib/lookups'
import test from 'tape'
import nock from 'nock'

const testAddress = 'ST2ZRX0K27GW0SP3GJCEMHD95TQGJMKB7G9Y0X1MH'

export function unitTestLookups() {

  test('lookup if a subdomain is registered', (t) => {
    t.plan(1)

    nock.cleanAll()

    nock('https://core.blockstack.org')
      .get('/v1/names/foo.bar.id')
      .reply(200, { status: 'registered_subdomain' })

    isSubdomainRegistered('foo.bar.id')
      .then(x => t.ok(x))
      .catch(() => t.ok(false))
  })

  test('lookup if a subdomain is not registered', (t) => {
    t.plan(1)

    nock.cleanAll()
    nock('https://core.blockstack.org')
      .get('/v1/names/foo.bar.id')
      .reply(404, {})

    isSubdomainRegistered('foo.bar.id')
      .then(x => t.ok(!x))
      .catch(() => t.ok(false))
  })

  test('validly signed update is unimplemented', (t) => {
    t.plan(1)
    t.throws(validlySignedUpdate)
  })

  test('handle failure of subdomain lookup', (t) => {
    t.plan(2)

    nock.cleanAll()
    nock('https://core.blockstack.org')
      .get('/v1/names/foo.bar.id')
      .reply(510, {})

    nock.cleanAll()
    nock('https://core.blockstack.org')
      .get('/v1/names/good.bar.id')
      .reply(500, {})

    isSubdomainRegistered('foo.bar.id')
      .then(() => t.ok(false))
      .catch(() => t.ok(true))

    isSubdomainRegistered('good.bar.id')
      .then((registered) => t.ok(!registered, 'good.bar.id should return as not registered'))
      .catch(() => t.ok(false, '500 errors should correspond to unregistered subdomain'))
  })

  test('isRegistrationValid', (t) => {
    t.plan(7)

    nock.cleanAll()
    nock('https://core.blockstack.org')
      .get('/v1/names/foo.bar.id')
      .reply(200, { status: 'registered_subdomain' })

    nock('https://core.blockstack.org')
      .get('/v1/names/bar.bar.id')
      .reply(404, {})

    nock('https://core.blockstack.org')
      .get('/v1/names/car.bar.id')
      .reply(500, {})

    isRegistrationValid('foo', 'bar.id', testAddress, 1, true)
      .then(x => t.ok(!x, 'Sequence number must be 0'))
    isRegistrationValid('foo', 'bar.id', 'm12345', 0, true)
      .then(x => t.ok(!x, 'Owner must be a mainnet address'))
    isRegistrationValid('AbcDef', 'bar.id', testAddress, 0, true)
      .then(x => t.ok(!x, 'must be a legal subdomain name'))
    isRegistrationValid('foo', 'bar.id', testAddress, 0, true)
      .then(x => t.ok(!x, 'must not already exist'))
    isRegistrationValid('foo', 'bar.id', testAddress, 0, false)
      .then(x => t.ok(x, 'dont check if passed false'))
    isRegistrationValid('car', 'bar.id', testAddress, 0, true)
      .then(x => t.ok(x, 'must not raise error in subdomain existence check'))
    isRegistrationValid('bar', 'bar.id', testAddress, 0, true)
      .then(x => t.ok(x, 'everything is cool'))
  })

}
