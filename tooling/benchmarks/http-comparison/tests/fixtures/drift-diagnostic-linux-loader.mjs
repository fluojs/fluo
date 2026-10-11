import { registerHooks } from 'node:module';

// Run the resource-only tests with Node's TS transform in a Linux container,
// without loading the host's platform-specific tsx/esbuild installation.
registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(specifier === '../src/resources' ? '../src/resources.ts' : specifier, context);
  },
});
