import { describe, expect, it } from 'vitest';

import { behavioralChangedFiles, type DocumentSnapshots } from './docs-navigation-changes.mjs';
import {
  enforceContractCompanionUpdates,
  enforceTerminusRuntimeHealthContractCompanions,
} from './verify-platform-consistency-governance.mjs';

const englishPath = 'book/beginner/ch18-health.md';
const koreanPath = 'book/beginner/ch18-health.ko.md';
const paths = [englishPath, koreanPath];
const start = '<!-- fluo:docs-navigation:start -->';
const end = '<!-- fluo:docs-navigation:end -->';
const navigation = `${start}\n> [Tutorial](../../apps/docs/content/docs/tutorial/index.mdx)\n\n${end}\n`;
const prefix = '# Health\n\n';
const contract = [
  '<!-- fluo-terminus-contract: unhealthy-status=503 -->',
  'Unhealthy responses return 503.',
  '',
  '<a id="health"></a>',
  '```ts',
  'const status = 503;',
  '```',
  '',
].join('\n');
const base = prefix + contract;
const head = prefix + navigation + contract;

function snapshots(baseText = base, headText = head): DocumentSnapshots {
  return Object.fromEntries(paths.map((path) => [path, { base: baseText, head: headText }]));
}

describe('documentation navigation changed-file classification', () => {
  it('does not demand behavioral companions for a strictly additive navigation pair', () => {
    // Given: navigation was inserted without changing any existing byte.
    const documents = snapshots();

    // When: the real companion gate consumes classified changed paths.
    const changed = behavioralChangedFiles(paths, documents);

    // Then: health README, migration, and runtime evidence are not falsely required.
    expect(changed).toEqual([]);
    expect(() => enforceTerminusRuntimeHealthContractCompanions(changed)).not.toThrow();
  });

  it('exempts learning navigation in both CONTEXT documents', () => {
    // Given: only a marked paragraph was added to the shared entrypoint.
    const contextPaths = ['docs/CONTEXT.md', 'docs/CONTEXT.ko.md'];
    const documents = Object.fromEntries(contextPaths.map((path) => [
      path,
      { base, head: head.replace('> [Tutorial]', '[Tutorial]') },
    ]));

    // When / Then: classification is not restricted to Book blockquotes.
    expect(behavioralChangedFiles(contextPaths, documents)).toEqual([]);
  });

  it.each([
    ['prose edit', head.replace('Unhealthy responses return 503.', 'Unhealthy responses return 200.')],
    ['code edit', head.replace('const status = 503;', 'const status = 200;')],
    ['prose deletion', head.replace('Unhealthy responses return 503.\n', '')],
    ['anchor edit', head.replace('id="health"', 'id="other"')],
    ['contract marker edit', head.replace('unhealthy-status=503', 'unhealthy-status=200')],
    ['moved prose', `${prefix}${navigation}${contract.replace('Unhealthy responses return 503.\n', '')}Unhealthy responses return 503.\n`],
    ['whitespace edit', `${head} `],
    ['line ending edit', head.replaceAll('\n', '\r\n')],
    ['unmarked prose addition', `${head}A new claim.\n`],
    ['wrapping existing claims', `${prefix}${start}\n${contract}${end}\n`],
  ])('retains non-navigation classification for %s in a legacy consumer', (_name, changedHead) => {
    // Given: a behavioral document also changed outside the new navigation block.
    const documents = snapshots(base, changedHead);

    // When: classification compares the entire remaining document.
    const changed = behavioralChangedFiles(paths, documents);

    // Then: matching code fences alone cannot exempt prose, anchors, or markers.
    expect(changed).toEqual(paths);
    // Book content remains visible to consumer checks, but is no longer a contract owner.
    expect(() => enforceTerminusRuntimeHealthContractCompanions(changed)).not.toThrow();
  });

  it.each([
    ['missing snapshot map', undefined],
    ['missing document snapshots', {}],
    ['missing base', { [englishPath]: { head }, [koreanPath]: { head } }],
    ['missing head', { [englishPath]: { base }, [koreanPath]: { base } }],
  ] satisfies readonly (readonly [string, DocumentSnapshots | undefined])[])(
    'fails closed for %s',
    (_name, documents) => {
      // Given / When: snapshots cannot prove a strictly additive change.
      const changed = behavioralChangedFiles(paths, documents);

      // Then: consumer enforcement still sees both documents without promoting either to owner.
      expect(changed).toEqual(paths);
      expect(() => enforceTerminusRuntimeHealthContractCompanions(changed)).not.toThrow();
    },
  );

  it.each([
    ['missing start', head.replace(`${start}\n`, '')],
    ['missing end', head.replace(`${end}\n`, '')],
    ['duplicate blocks', prefix + navigation + navigation + contract],
    ['nested blocks', head.replace(start, `${start}\n${start}`)],
    ['reversed markers', `${prefix}${end}\n> [Tutorial](./tutorial.md)\n${start}\n${contract}`],
    ['inline marker', head.replace(start, `text ${start}`)],
    ['misspelled marker', head.replace(':start', ':begin')],
    ['additional malformed marker', `${head}<!-- fluo:docs-navigation:unknown -->\n`],
    ['empty block', `${prefix}${start}\n\n${end}\n${contract}`],
    ['code fence in block', head.replace('> [Tutorial]', '```ts\nconst status = 200;\n```\n> [Tutorial]')],
    ['quoted fence in block', head.replace('> [Tutorial]', '> ```ts\n> const status = 200;\n> ```\n> [Tutorial]')],
    ['indented code in block', head.replace('> [Tutorial]', '    const status = 200;\n> [Tutorial]')],
    ['anchor in block', head.replace('> [Tutorial]', '<a id="health"></a>\n> [Tutorial]')],
    ['heading in block', head.replace('> [Tutorial]', '## Health\n> [Tutorial]')],
    ['contract marker in block', head.replace('> [Tutorial]', '<!-- fluo-health-contract: changed -->\n> [Tutorial]')],
    ['reference definition in block', head.replace('> [Tutorial]', '[health]: ./changed.md\n> [Tutorial]')],
    ['indented reference definition', head.replace('> [Tutorial]', '  [health]: ./changed.md\n> [Tutorial]')],
    ['indented fence', head.replace('> [Tutorial]', '  ```ts\nconst status = 200;\n  ```\n> [Tutorial]')],
    ['indented heading', head.replace('> [Tutorial]', '  ## Health\n> [Tutorial]')],
  ])('fails closed for %s', (_name, changedHead) => {
    // Given / When: a marker pair or its contents are ambiguous.
    const changed = behavioralChangedFiles(paths, snapshots(base, changedHead));

    // Then: an apparent insertion must not bypass behavioral enforcement.
    expect(changed).toEqual(paths);
  });

  it.each([
    ['editing an existing navigation block', head, head.replace('[Tutorial]', '[Other]')],
    ['deleting an existing navigation block', head, base],
    ['moving an existing navigation block', head, base + navigation],
    ['a malformed base marker', `${base}${start}\n`, head],
    ['no navigation addition', base, base],
    ['a base marker missing its separator', `${prefix}<!-- fluo:docs-navigation -->\n${contract}`, `${prefix}${navigation}<!-- fluo:docs-navigation -->\n${contract}`],
    ['a block inside fenced code', `${prefix}\`\`\`md\n\n${contract}`, `${prefix}\`\`\`md\n\n${navigation}${contract}`],
    ['a block inside an HTML comment', `${prefix}<!--\n\n${contract}`, `${prefix}<!--\n\n${navigation}${contract}`],
    ['a block inside HTML', `${prefix}<script>\n\n${contract}`, `${prefix}<script>\n\n${navigation}${contract}`],
  ])('does not exempt %s', (_name, baseText, headText) => {
    // Given / When: the change is not a first, strictly additive navigation block.
    const changed = behavioralChangedFiles(paths, snapshots(baseText, headText));

    // Then: removing both snapshots' marked regions must not hide existing edits.
    expect(changed).toEqual(paths);
  });

  it.each(paths)('requires the changed EN/KO counterpart for %s', (path) => {
    // Given: only one locale has a proved navigation insertion.
    const documents = snapshots();

    // When / Then: classification cannot erase locale companion enforcement.
    expect(() => behavioralChangedFiles([path], documents)).toThrow('EN/KO');
  });

  it('retains a behavioral locale when its counterpart only adds navigation', () => {
    // Given: one translation also changes a claim.
    const documents = {
      ...snapshots(),
      [koreanPath]: { base, head: head.replace('const status = 503;', 'const status = 200;') },
    };

    // When: the navigation-only locale is classified separately.
    const changed = behavioralChangedFiles(paths, documents);

    // Then: the changed consumer remains classified without regaining normative ownership.
    expect(changed).toEqual([koreanPath]);
    expect(() => enforceTerminusRuntimeHealthContractCompanions(changed)).not.toThrow();
  });

  it.each([
    'docs/CONTEXT.md',
    'docs/CONTEXT.ko.md',
  ])('requires Docs owners for genuine health drift beside navigation in %s', (path) => {
    // Given: a shared health sentinel changes in addition to navigation.
    const changedHead = head.replace('unhealthy-status=503', 'unhealthy-status=200');
    const documents = { [path]: { base, head: changedHead } };
    const patch = '- <!-- fluo-terminus-contract: unhealthy-status=503 -->\n'
      + '+ <!-- fluo-terminus-contract: unhealthy-status=200 -->';

    // When: classification feeds the real Terminus companion gate with that patch.
    const changed = behavioralChangedFiles([path], documents);

    // Then: retained health drift requires the canonical EN/KO owner, not a Book edit.
    expect(changed).toEqual([path]);
    expect(() => enforceTerminusRuntimeHealthContractCompanions(changed, () => patch)).toThrow(
      'docs/contracts/health-and-readiness.md, docs/contracts/health-and-readiness.ko.md',
    );
    expect(() => enforceTerminusRuntimeHealthContractCompanions([
      ...changed,
      'docs/contracts/health-and-readiness.md',
      'docs/contracts/health-and-readiness.ko.md',
    ], () => patch)).not.toThrow();
  });

  it.each([
    ['docs/contracts/health-and-readiness.md', 'docs/contracts/health-and-readiness.ko.md'],
    ['docs/contracts/health-and-readiness.ko.md', 'docs/contracts/health-and-readiness.md'],
  ])('cannot exempt canonical owner %s with navigation markers', (owner, counterpart) => {
    // Given / When: an owner attempts the same additive-navigation exemption.
    const changed = behavioralChangedFiles([owner], { [owner]: { base, head } });

    // Then: Docs owners remain authoritative even for a marked insertion.
    expect(changed).toEqual([owner]);
    expect(() => enforceTerminusRuntimeHealthContractCompanions(changed)).toThrow(counterpart);
  });

  it.each([
    'book/README.md',
    'book/advanced/toc.md',
    'packages/terminus/README.md',
    'docs/contracts/behavioral-contract-policy.md',
    'packages/terminus/src/module.ts',
  ])('does not extend the exemption to %s', (path) => {
    // Given / When: markers appear outside the supported navigation documents.
    const changed = behavioralChangedFiles([path], { [path]: { base, head } });

    // Then: source, root hubs, and ordinary contract documents remain governed.
    expect(changed).toEqual([path]);
  });

  it('does not blanket-exempt Book introduction rewrites', () => {
    // Given: an introduction gains navigation and replaces existing guidance.
    const introPaths = ['book/advanced/ch00-introduction.md', 'book/advanced/ch00-introduction.ko.md'];
    const documents = Object.fromEntries(introPaths.map((path) => [
      path,
      { base, head: head.replace('Unhealthy responses return 503.', 'Different guidance.') },
    ]));

    // When / Then: an introduction is subject to the same full-document comparison.
    expect(behavioralChangedFiles(introPaths, documents)).toEqual(introPaths);
  });

  it('still requires ordinary contract companions beside navigation-only changes', () => {
    // Given: a contract policy also changed.
    const policy = 'docs/contracts/behavioral-contract-policy.md';

    // When: navigation-only changed files are removed from behavioral evidence.
    const changed = behavioralChangedFiles([...paths, policy], snapshots());

    // Then: the ordinary gate still demands discoverability companions.
    expect(() => enforceContractCompanionUpdates(changed)).toThrow(
      'contract-governing doc updates must include docs/CONTEXT.md',
    );
  });
});
