import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { enforceRequestPipelineImportBoundary } from './request-pipeline-import-boundary.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

function overrideFile(relativePath: string, transform: (content: string) => string): (requestedPath: string) => string {
  return (requestedPath) => {
    if (requestedPath !== relativePath) {
      return read(requestedPath);
    }

    const original = read(requestedPath);
    const mutated = transform(original);

    if (mutated === original) {
      throw new Error(
        `Governance fixture for ${relativePath} left the source unchanged: its anchor text has drifted away from the current implementation. `
        + 'Update the fixture so it actually breaks the seam under test, otherwise this guard is asserting nothing.',
      );
    }

    return mutated;
  };
}

describe('request-pipeline import boundary governance', () => {
  it('keeps first-party DTO readers on the @fluojs/core/request-pipeline seam', () => {
    // Given
    const runGovernanceGuard = () => enforceRequestPipelineImportBoundary();

    // When / Then
    expect(runGovernanceGuard).not.toThrow();
  });

  it('rejects HTTP DTO binding reads routed through @fluojs/core/internal', () => {
    // Given
    const readWithInternalHttpImport = overrideFile('packages/http/src/adapters/dto-binding-plan.ts', (content) =>
      content.replace("} from '@fluojs/core/request-pipeline';", "} from '@fluojs/core/internal';"));

    // When
    const runGovernanceGuard = () => enforceRequestPipelineImportBoundary(readWithInternalHttpImport);

    // Then
    expect(runGovernanceGuard).toThrow(
      /packages\/http\/src\/adapters\/dto-binding-plan\.ts must import .*getDtoBindingSchema.* from @fluojs\/core\/request-pipeline/u,
    );
  });

  it('rejects GraphQL input processing reads routed through @fluojs/core/internal', () => {
    // Given
    const readWithInternalGraphqlImport = overrideFile('packages/graphql/src/pipeline/input-pipeline.ts', (content) =>
      content.replace("from '@fluojs/core/request-pipeline';", "from '@fluojs/core/internal';"));

    // When
    const runGovernanceGuard = () => enforceRequestPipelineImportBoundary(readWithInternalGraphqlImport);

    // Then
    expect(runGovernanceGuard).toThrow(
      /packages\/graphql\/src\/pipeline\/input-pipeline\.ts must import getDtoValidationSchema from @fluojs\/core\/request-pipeline/u,
    );
  });

  it('rejects dropping the request-pipeline seam read from a governed consumer', () => {
    // Given
    const readWithoutSeamImport = overrideFile('packages/validation/src/internal/dto-metadata-cache.ts', (content) =>
      content.replace("} from '@fluojs/core/request-pipeline';", "} from './dto-metadata-shim.js';"));

    // When
    const runGovernanceGuard = () => enforceRequestPipelineImportBoundary(readWithoutSeamImport);

    // Then
    expect(runGovernanceGuard).toThrow(
      /packages\/validation\/src\/internal\/dto-metadata-cache\.ts must keep reading DTO validation or binding metadata through @fluojs\/core\/request-pipeline/u,
    );
  });
});
