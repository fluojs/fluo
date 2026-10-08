import { isBuiltin } from 'node:module';

/**
 * Reject host builtins so portable diagnostics imports cannot acquire host dependencies.
 *
 * @param specifier - Module specifier requested by the consumer.
 * @param context - Node loader resolution context.
 * @param nextResolve - Next resolver for non-builtin module specifiers.
 */
export function resolve(specifier, context, nextResolve) {
  if (isBuiltin(specifier)) {
    throw new Error(`Unexpected host builtin: ${specifier}`);
  }
  return nextResolve(specifier, context);
}
