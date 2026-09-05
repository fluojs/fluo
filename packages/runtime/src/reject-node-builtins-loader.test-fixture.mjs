/**
 * Rejects Node builtin imports while resolving the portable runtime test graph.
 *
 * @param specifier - Module specifier requested by the importing module.
 * @param context - Resolution context supplied by the Node loader.
 * @param nextResolve - Next resolver in the loader chain.
 * @returns The resolved module when the specifier is not a Node builtin.
 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('node:')) {
    throw new Error(`Portable import resolved Node builtin: ${specifier}`);
  }

  return nextResolve(specifier, context);
}
