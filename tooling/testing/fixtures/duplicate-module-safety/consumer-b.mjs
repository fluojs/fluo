import { observation } from './consumer-a.mjs';

export { observation };

if (process.argv[1] && process.argv[1].endsWith('consumer.mjs')) {
  console.log(JSON.stringify(observation));
}
