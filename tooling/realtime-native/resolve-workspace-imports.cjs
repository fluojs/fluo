const { readFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const { relative, resolve } = require('node:path');

const root = resolve(__dirname, '../..');
const output = resolve(__dirname, '.generated');

module.exports = () => ({
  visitor: {
    ImportDeclaration(path) {
      const specifier = path.node.source.value;
      let target;
      if (specifier.startsWith('@fluojs/')) {
        const [, name, ...subpath] = specifier.split('/');
        const packageRoot = resolve(root, 'packages', name);
        const manifest = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8'));
        const entry = manifest.exports[subpath.length ? `./${subpath.join('/')}` : '.'];
        if (typeof entry?.import !== 'string') throw new TypeError(`No public import target for ${specifier}.`);
        target = resolve(packageRoot, entry.import);
      } else if (specifier === 'socket.io-client') {
        target = createRequire(resolve(root, 'packages/socket.io/package.json')).resolve(specifier);
      } else {
        return;
      }
      const result = relative(output, target).replaceAll('\\', '/');
      path.node.source.value = result.startsWith('.') ? result : `./${result}`;
    },
  },
});
