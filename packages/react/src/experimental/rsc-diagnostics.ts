import {
  REACT_RSC_DIAGNOSTIC_CODES,
  REACT_RSC_SUPPORTED_VERSION,
  type ReactRscDiagnostic,
  type ReactRscEnvironmentOptions,
  type ReactRscSupportResult,
} from './rsc-types.js';

/**
 * Inspects whether an application-owned RSC runtime and build adapter satisfy the prototype contract.
 *
 * @remarks
 * The experimental policy accepts only exact `19.2.6` versions. Version ranges and canary builds
 * are rejected because React Flight renderer internals must remain aligned with React and React DOM.
 *
 * @param options Installed React versions plus explicit runtime and build-adapter capabilities.
 * @returns A successful result or stable diagnostics for every unsupported boundary.
 */
export function inspectReactRscEnvironment(options: ReactRscEnvironmentOptions): ReactRscSupportResult {
  const diagnostics: ReactRscDiagnostic[] = [];

  if (options.reactVersion !== REACT_RSC_SUPPORTED_VERSION) {
    diagnostics.push({
      code: REACT_RSC_DIAGNOSTIC_CODES.unsupportedReactVersion,
      message: `Experimental RSC requires react@${REACT_RSC_SUPPORTED_VERSION} exactly; received "${options.reactVersion}".`,
    });
  }

  if (options.reactDomVersion !== REACT_RSC_SUPPORTED_VERSION) {
    diagnostics.push({
      code: REACT_RSC_DIAGNOSTIC_CODES.unsupportedReactDomVersion,
      message: `Experimental RSC requires react-dom@${REACT_RSC_SUPPORTED_VERSION} exactly; received "${options.reactDomVersion}".`,
    });
  }

  if (options.flightRendererVersion !== REACT_RSC_SUPPORTED_VERSION) {
    diagnostics.push({
      code: REACT_RSC_DIAGNOSTIC_CODES.unsupportedFlightRendererVersion,
      message: `Experimental RSC requires the Flight renderer at ${REACT_RSC_SUPPORTED_VERSION} exactly; received "${options.flightRendererVersion}".`,
    });
  }

  if (!options.runtime.webStreams) {
    diagnostics.push({
      code: REACT_RSC_DIAGNOSTIC_CODES.unsupportedRuntime,
      message: `Runtime "${options.runtime.name}" cannot host experimental RSC because Web ReadableStream support is unavailable.`,
    });
  }

  if (!options.build.clientReferenceManifest) {
    diagnostics.push({
      code: REACT_RSC_DIAGNOSTIC_CODES.missingClientReferenceManifest,
      message: `Build adapter "${options.build.name}" did not provide a client-reference manifest.`,
    });
  }

  if (!options.build.serverClientModuleMap) {
    diagnostics.push({
      code: REACT_RSC_DIAGNOSTIC_CODES.missingServerClientModuleMap,
      message: `Build adapter "${options.build.name}" did not provide a server-to-client module map.`,
    });
  }

  return diagnostics.length === 0
    ? { diagnostics: [], ok: true }
    : { diagnostics, ok: false };
}
