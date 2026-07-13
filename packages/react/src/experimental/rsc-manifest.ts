import {
  REACT_RSC_DIAGNOSTIC_CODES,
  type ReactRscClientReference,
  type ReactRscClientReferenceManifest,
  type ReactRscDiagnostic,
  type ReactRscManifest,
  type ReactRscManifestInput,
  type ReactRscManifestResult,
  type ReactRscServerClientModuleMap,
} from './rsc-types.js';

function cloneClientReferences(
  clientReferences: ReactRscClientReferenceManifest,
): ReactRscClientReferenceManifest {
  const snapshot: Record<string, ReactRscClientReference> = {};
  Object.setPrototypeOf(snapshot, null);

  for (const [referenceId, reference] of Object.entries(clientReferences)) {
    snapshot[referenceId] = {
      ...(reference.async !== undefined ? { async: reference.async } : {}),
      chunks: [...reference.chunks],
      id: reference.id,
      name: reference.name,
    };
  }

  return snapshot;
}

function cloneServerClientModuleMap(
  serverClientModuleMap: ReactRscServerClientModuleMap,
): ReactRscServerClientModuleMap {
  const snapshot: Record<string, Readonly<Record<string, string>>> = {};
  Object.setPrototypeOf(snapshot, null);

  for (const [serverModuleId, exportMappings] of Object.entries(serverClientModuleMap)) {
    const exportSnapshot: Record<string, string> = {};
    Object.setPrototypeOf(exportSnapshot, null);

    for (const [exportName, clientReferenceId] of Object.entries(exportMappings)) {
      exportSnapshot[exportName] = clientReferenceId;
    }

    snapshot[serverModuleId] = exportSnapshot;
  }

  return snapshot;
}

function validateManifest(input: ReactRscManifestInput): readonly ReactRscDiagnostic[] {
  const diagnostics: ReactRscDiagnostic[] = [];

  if (Object.keys(input.clientReferences).length === 0) {
    diagnostics.push({
      code: REACT_RSC_DIAGNOSTIC_CODES.emptyClientReferenceManifest,
      message: 'The experimental RSC client-reference manifest must contain at least one reference.',
      path: 'clientReferences',
    });
  }

  if (Object.keys(input.serverClientModuleMap).length === 0) {
    diagnostics.push({
      code: REACT_RSC_DIAGNOSTIC_CODES.emptyServerClientModuleMap,
      message: 'The experimental RSC server-to-client module map must contain at least one server module.',
      path: 'serverClientModuleMap',
    });
  }

  for (const [serverModuleId, exportMappings] of Object.entries(input.serverClientModuleMap)) {
    for (const [exportName, clientReferenceId] of Object.entries(exportMappings)) {
      if (Object.hasOwn(input.clientReferences, clientReferenceId)) {
        continue;
      }

      diagnostics.push({
        code: REACT_RSC_DIAGNOSTIC_CODES.unknownClientReference,
        message: `Server module "${serverModuleId}" export "${exportName}" maps to unknown client reference "${clientReferenceId}".`,
        path: `serverClientModuleMap.${serverModuleId}.${exportName}`,
      });
    }
  }

  return diagnostics;
}

/**
 * Validates and snapshots an application-owned RSC client-reference manifest and module map.
 *
 * @remarks
 * This seam is bundler-neutral and does not scan files, generate chunks, load React internals, or
 * model Server Functions. An application build adapter must provide both explicit inputs.
 *
 * @param input Client references and server module mappings produced by the application build.
 * @returns A defensive manifest snapshot or stable diagnostics for invalid mappings.
 */
export function createReactRscManifest(input: ReactRscManifestInput): ReactRscManifestResult {
  const diagnostics = validateManifest(input);

  if (diagnostics.length > 0) {
    return { diagnostics, ok: false };
  }

  const manifest: ReactRscManifest = {
    clientReferences: cloneClientReferences(input.clientReferences),
    serverClientModuleMap: cloneServerClientModuleMap(input.serverClientModuleMap),
  };

  return { diagnostics: [], manifest, ok: true };
}
