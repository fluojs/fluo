declare const publicTokenType: unique symbol;

/**
 * A symbol token carrying its resolved service type without changing runtime identity.
 *
 * The namespace owner must keep the service contract consistent across consumers.
 * The type is not runtime validation and does not register or export a provider.
 */
export type PublicToken<T> = symbol & { readonly [publicTokenType]: T };

/**
 * Declare a typed public token using the standard global symbol registry.
 *
 * @param namespace Application-owned namespace, shared by every declaration of this token.
 * @returns Symbol.for(namespace), carrying T for container resolution inference.
 * @remarks Keep namespaces unique across applications and version incompatible contracts.
 * Explicit provider registration, useExisting aliases, and module exports remain required.
 */
export function publicToken<T>(namespace: string): PublicToken<T>;
/**
 * Obtain the registered symbol without wrapping or replacing its identity.
 *
 * @param namespace Application-owned namespace.
 * @returns The existing or newly registered symbol.
 */
export function publicToken(namespace: string): symbol {
  return Symbol.for(namespace);
}
