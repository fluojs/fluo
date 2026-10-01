export type ReactNavigationPayloadContractSource =
  | 'packages/react/src/client/navigation-payload.ts'
  | 'packages/react/src/page-result.ts'
  | 'packages/react/src/navigation-payload.ts'
  | 'packages/react/src/page-metadata.ts'
  | 'packages/react/src/client/store.ts'
  | 'packages/react/src/client/form-store.ts'
  | 'packages/react/src/client/experience.ts'
  | 'packages/react/src/client/history.ts'
  | 'packages/react/src/client/provider.ts'
  | 'packages/http/src/dispatch/dispatch-response-policy.ts';

/**
 * Enforces the shared navigation protocol, HTTP prefetch eligibility and fresh
 * post-save GET approval, pre-policy revocation, owned policy cancellation and
 * fresh auth refresh. Generated props are decoded before import on initial,
 * ordinary and anonymous-prefetch loads. POST acknowledgement is not a reusable page.
 *
 * @param readText Source reader for every governed implementation seam.
 * @throws When a navigation, generated-props, prefetch or form-follow-up invariant is violated.
 */
export function enforceReactNavigationPayloadContract(
  readText?: (relativePath: ReactNavigationPayloadContractSource) => string,
): void;
