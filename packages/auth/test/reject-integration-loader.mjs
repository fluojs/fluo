const forbidden = new Set([
  '@fluojs/http',
  '@fluojs/auth-http',
  '@fluojs/jwt',
  '@fluojs/passport',
  '@fluojs/runtime',
]);

export function resolve(specifier, context, nextResolve) {
  if (forbidden.has(specifier) || [...forbidden].some((name) => specifier.startsWith(`${name}/`))) {
    throw new Error(`Neutral auth root loaded integration: ${specifier}`);
  }
  return nextResolve(specifier, context);
}
