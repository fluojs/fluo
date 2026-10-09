import crypto from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';

let maximumBytes = 0;
const createHash = crypto.createHash;
crypto.createHash = (...args) => {
  const hash = createHash(...args);
  const update = hash.update;
  hash.update = function(data, ...options) {
    const bytes = typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength;
    maximumBytes = Math.max(maximumBytes, bytes);
    return update.call(this, data, ...options);
  };
  return hash;
};
syncBuiltinESMExports();
process.once('exit', () => {
  process.stderr.write(`HASH_INPUT_MAX_BYTES=${maximumBytes}\n`);
});
