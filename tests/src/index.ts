// @ts-nocheck
import { unitTestOperations } from './unitTestOperations';
import { unitTestLookups } from './unitTestLookups';
import { testSubdomainServer } from './unitTestServer';
import { config as bskConfig } from 'blockstack';

import * as nock from 'nock';
import { StacksMainnet } from '@stacks/network';

nock.disableNetConnect();

bskConfig.network = new StacksMainnet() as any;

unitTestLookups();
unitTestOperations();
testSubdomainServer();
