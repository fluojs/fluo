export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('node:')) {
    throw new Error(`Portable import resolved Node builtin: ${specifier}`);
  }

  return nextResolve(specifier, context);
}
