import { isBuiltin } from 'node:module';

export function resolve(specifier, context, nextResolve) {
  if (isBuiltin(specifier)) {
    throw new Error(`Unexpected host builtin: ${specifier}`);
  }
  return nextResolve(specifier, context);
}
