import { unitTestOperations } from './unitTestOperations'
import { unitTestLookups } from './unitTestLookups'
import { testSubdomainServer } from './unitTestServer'
import nock from 'nock'

nock.disableNetConnect()

unitTestLookups()
unitTestOperations()
testSubdomainServer()
