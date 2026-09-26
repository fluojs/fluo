import { interop, observation } from './consumer-a.mjs';

export { interop, observation };

if (process.argv[1]?.endsWith('consumer.mjs')) {
  console.log(JSON.stringify(observation));
}
