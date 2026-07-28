import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const sourceRequirements = [
  ['packages/runtime/src/route-inspection.ts', ['createRuntimeRouteCatalog', 'createRuntimeInspectionSnapshot', 'pathParams']],
  ['packages/react/src/page-catalog.ts', ['createReactPageCatalog', "kind: 'react-page'", 'Object.freeze']],
  ['packages/react/src/index.ts', ['createReactPageCatalog']],
  ['packages/cli/src/commands/inspect.ts', ['createRuntimeInspectionSnapshot', 'describeRoutes']],
  [
    'packages/studio/src/contracts.ts',
    ['StudioRouteDescriptor', 'kind: value.kind === undefined', "? 'http'", 'params: params === undefined ? []'],
  ],
];

const documentationRequirements = [
  ['docs/CONTEXT.md', ['createReactPageCatalog', 'react-page']],
  ['docs/CONTEXT.ko.md', ['createReactPageCatalog', 'react-page']],
  ['docs/reference/package-surface.md', ['createReactPageCatalog', 'react-page']],
  ['docs/reference/package-surface.ko.md', ['createReactPageCatalog', 'react-page']],
  ['docs/reference/toolchain-contract-matrix.md', ['compiled route inspection', "kind: 'react-page'"]],
  ['docs/reference/toolchain-contract-matrix.ko.md', ['compiled route inspection', "kind: 'react-page'"]],
  ['packages/react/README.md', ['createReactPageCatalog', 'react-page']],
  ['packages/react/README.ko.md', ['createReactPageCatalog', 'react-page']],
  ['packages/runtime/README.md', ['createRuntimeInspectionSnapshot', 'react-page']],
  ['packages/runtime/README.ko.md', ['createRuntimeInspectionSnapshot', 'react-page']],
  ['packages/cli/README.md', ['routes[]', "kind: 'react-page'"]],
  ['packages/cli/README.ko.md', ['routes[]', "kind: 'react-page'"]],
  ['packages/studio/README.md', ['react-page', 'parameter-name-only `params`']],
  ['packages/studio/README.ko.md', ['react-page', 'parameter-name-only `params`']],
];

function assertRequiredMarkers(readText, requirements) {
  for (const [relativePath, requiredMarkers] of requirements) {
    const source = readText(relativePath);
    const missingMarkers = requiredMarkers.filter((marker) => !source.includes(marker));

    if (missingMarkers.length > 0) {
      throw new Error(`${relativePath} must keep the React page catalog contract markers: ${missingMarkers.join(', ')}.`);
    }
  }
}

export function enforceReactPageCatalogContract(
  readText = (relativePath) => readFileSync(resolve(repoRoot, relativePath), 'utf8'),
) {
  assertRequiredMarkers(readText, sourceRequirements);
  assertRequiredMarkers(readText, documentationRequirements);
}
