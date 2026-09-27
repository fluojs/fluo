export type ReactNavigationPayloadContractSource =
  | 'packages/react/src/client/navigation-payload.ts'
  | 'packages/react/src/page-result.ts'
  | 'packages/react/src/client/store.ts'
  | 'packages/react/src/client/history.ts'
  | 'packages/react/src/client/provider.ts'
  | 'packages/http/src/dispatch/dispatch-response-policy.ts';

export function enforceReactNavigationPayloadContract(
  readText?: (relativePath: ReactNavigationPayloadContractSource) => string,
): void;
