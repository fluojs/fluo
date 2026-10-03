import { startTargets, waitForTarget } from '../../src/targets';

const children = startTargets('read-search-local', [{
  name: 'native-nodejs', platform: 'nodejs', product: 'native',
  label: 'shutdown fixture', port: 0, command: process.execPath,
  args: ['-e', "require('node:http').createServer().listen(0, '127.0.0.1', () => console.log('listening on :0'))"],
}]);
await waitForTarget(children[0]);
process.stdout.write(`${JSON.stringify({ serverPid: children[0].pid })}\n`);
