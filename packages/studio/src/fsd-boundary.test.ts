import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const packageRoot = new URL('..', import.meta.url);

const uiFiles = [
  'src/features/file-loader/ui/FileDropZone.tsx',
  'src/features/filters/ui/SnapshotFilters.tsx',
  'src/widgets/live-graph/ui/LiveGraphPanel.tsx',
  'src/widgets/request-flow/ui/RequestFlowPanel.tsx',
  'src/widgets/routes/ui/RoutesPanel.tsx',
  'src/widgets/static-report/ui/StaticReportPanel.tsx',
] as const;

describe('Studio FSD boundaries', () => {
  it('keeps shared dashboard actions out of sibling feature reducer imports', () => {
    for (const file of uiFiles) {
      const source = readFileSync(join(packageRoot.pathname, file), 'utf8');
      expect(source).not.toContain('features/live-connection/model/reducer.js');
      expect(source).not.toContain('live-connection/model/reducer.js');
    }
  });
});
