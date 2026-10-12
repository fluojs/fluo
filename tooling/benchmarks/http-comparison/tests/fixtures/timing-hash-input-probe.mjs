import crypto from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';

let maximumBytes = 0;
let backingBytes = 0;
const backingStores = new WeakSet();
const createHash = crypto.createHash;
crypto.createHash = (...args) => {
  const hash = createHash(...args);
  const update = hash.update;
  hash.update = function(data, ...options) {
    const bytes = typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength;
    maximumBytes = Math.max(maximumBytes, bytes);
    if (ArrayBuffer.isView(data) && !backingStores.has(data.buffer)) {
      backingStores.add(data.buffer);
      backingBytes += data.buffer.byteLength;
    }
    return update.call(this, data, ...options);
  };
  return hash;
};
syncBuiltinESMExports();
process.once('exit', () => {
  process.stderr.write(`HASH_INPUT_MAX_BYTES=${maximumBytes}\n`);
  process.stderr.write(`HASH_BACKING_TOTAL_BYTES=${backingBytes}\n`);
});
