export {
  createFetchStyleHttpAdapterRealtimeCapability,
  type HttpApplicationAdapter,
} from './adapter.js';
export { DefaultBinder } from './adapters/binding.js';
export { resolveClientIdentity } from './client-identity.js';
export { getCompiledRouteIdentity } from './compiled-route-identity.js';
export {
  attachFrameworkRequestNativeRouteHandoff,
  bindRawRequestNativeRouteHandoff,
  consumeRawRequestNativeRouteHandoff,
  isRoutePathNormalizationSensitive,
  type NativeRouteHandoff,
  readFrameworkRequestNativeRouteHandoff,
} from './dispatch/native-route-handoff.js';
export type { Dispatcher } from './types.js';
