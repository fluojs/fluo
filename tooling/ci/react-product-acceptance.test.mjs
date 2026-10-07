import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { finished } from 'node:stream/promises';
import { cpSync, createWriteStream, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { after } from 'node:test';
import { browserReport, consumeProduct, externalEvidence, productDomainPlan, reliabilityRun, requiredRows, validateMeasurementDiagnostics,
  validateMeasurementInventory, validateReliabilityInventory } from './react-product-acceptance.mjs';
import { buildReviewFact } from '../../.agents/skills/review-head/scripts/contracts.mjs';
import { localCheckBinding } from '../../.agents/skills/execute-lane/scripts/lane-v4.mjs';
import representative from '../benchmarks/react-app-comparison/config/representative.json' with { type: 'json' };
import { hashObject } from '../benchmarks/react-app-comparison/src/fa-v2.mjs';
import { environmentConfigIdentity, planMeasurements } from '../benchmarks/react-app-comparison/src/measure.mjs';

const head = '1'.repeat(40);
const tree = '2'.repeat(40);
const matrix = JSON.parse(readFileSync(new URL('../../examples/react-vite-ssr/tests/product-acceptance-matrix.json', import.meta.url)));
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

// These titles are Playwright report identifiers, not display-copy assertions.
const commonCaseTitles = {
  "background-interactions.spec.ts": [
    'real held searches complete out of order while an independent widget and shell remain usable',
    'two held row POSTs keep independent outcomes and confirm writes without history navigation',
    'actual page unmount settles its held row without reviving an old route or replaying POST',
    'native GET search and POST 303 GET queue remain usable without JavaScript',
    'a held shell widget survives approved tagged push replace back forward and explicit refresh',
    'two successful row writes acknowledge in reverse order and coalesce one latest page approval',
    'a live shell widget survives page approval while the departing page row does not',
    'logout closes the real shell ports and revokes held background results before late acknowledgements'
  ],
  "navigation-guard.spec.ts": [
    'stay and proceed preserve the actual editing DOM, head and operational shell before HTTP permission',
    'real backward and forward cancellation restore managed entry order without destination reads',
    'two actual POST acknowledgements settle out of order without overriding dirty navigation intent',
    'an open dirty decision cannot postpone explicit logout or actual resource cleanup'
  ],
  "product-acceptance.spec.ts": [
    'authenticated product: negotiated CSRF refusal -> no saved result or persisted CRUD change',
    'authenticated product: native CSRF refusal -> no saved result or persisted CRUD change',
    'authenticated product: enhanced invalid/correct/save/logout/relogin -> confirmed persistence and revocation',
    'authenticated product: js-disabled -> native POST303GET validation CRUD and relogin',
    'authenticated product: bootstrap-blocked -> native POST303GET validation CRUD and relogin'
  ],
  "product-faults.spec.ts": [
    'authenticated product: logout during handler save -> old continuation revoked without rollback claim',
    'authenticated product: logout during commit save -> old continuation revoked without rollback claim',
    'authenticated product: credentialed permission refusal -> forbidden identity and fresh relogin'
  ]
};
const exampleCaseTitles = {
  ...commonCaseTitles,
  "deployment-transition.spec.ts": [
    'serves direct HTML, negotiated v2, guarded writes and missing assets through real HTTP',
    'retains A assets and shell on B mismatch, then explicitly updates to B',
    'classifies a missing mapped A chunk as import failure without losing the shell'
  ],
  "navigation-failure.spec.ts": [
    'preserves a functional resource and approved page across network failure and fresh retry',
    'preserves a functional resource and approved page across server-error failure and fresh retry',
    'explicit document exit remains available after a preserved failure',
    'failed back and forward restore the approved history entry and remain traversable',
    'invalidation during back approval restores the approved URL without remounting the shell',
    'default navigation invalidation loads the activated document for an untagged back entry',
    'a rejected replace does not commit URL or params before retry',
    'repeated failures remain actionable without remounting the shell resource',
    'a recoverable chunk import failure keeps the page and offers document recovery'
  ],
  "production-hydration.spec.ts": [
    'hydrates streamed production HTML with generated Vite assets',
    'traverses admin QR and songs with a preserved shell, reset page state and focus',
    'keeps the approved page and head while a later HTTP destination is pending',
    'removes an approved page stylesheet without removing the global stylesheet',
    'ignores a superseded approval without replacing the newer route or head',
    'resets an approved render failure without reloading the document or the shell resource',
    'shows a separate usable view if the application error view throws',
    'applies pathname, query, fragment and traversal focus and scroll defaults',
    'preserves page-local state when a fragment focuses a target inside the approved slot',
    'keeps the shell resource operational after a malformed fragment',
    'keeps the official page slot and navigation controls reachable at mobile width',
    'keeps native new tabs and full-document fallback on server rejection',
    'submits the native mutation form without client JavaScript'
  ],
  "ssr-delivery.spec.ts": [
    'built Fastify product route sends a socket shell before the gated descendant'
  ],
  "progressive-forms.spec.ts": [
    'real HTTP JSON compatibility records native submission classification',
    'native production CRUD with disabled',
    'native production CRUD with bootstrap-blocked',
    'enhanced production save keeps unrelated input and recovers a failed read without POST replay',
    'cookie authorization and CSRF reject enhanced mutations without save acknowledgement',
    'actual listener barrier skips click Enter and requestSubmit while another form validates',
    'real transport failure before-drop never repeats a POST',
    'real transport failure before503 never repeats a POST',
    'real transport failure drop-after never repeats a POST',
    'real transport failure after500 never repeats a POST',
    'real transport failure bad-media never repeats a POST',
    'real transport failure bad-schema never repeats a POST',
    'real transport failure bad-version never repeats a POST',
    'real transport failure unsafe never repeats a POST',
    'real transport failure redirect303 never repeats a POST',
    'real transport failure redirect307 never repeats a POST',
    'late response body and cancelled commit cannot overwrite an explicit later save',
    'confirmed save survives incompatible follow-up and GET-only recovery',
    'confirmed save survives import follow-up and GET-only recovery',
    'listener records native and negotiated DTO pipeline identity and actual successful controls',
    'native and enhanced listeners enforce missing expired and tampered credentials identically',
    'unsupported get activation remains exactly native',
    'unsupported multipart activation remains exactly native',
    'unsupported image activation remains exactly native',
    'unsupported target activation remains exactly native',
    'unsupported external activation remains exactly native',
    'constraint-invalid and consumer-prevented submissions never reach the listener',
    'public prefetch and an older streamed read cannot replace fresh saved data or its resource',
    'a late committed acknowledgement cannot outlive cancel intent',
    'a late committed acknowledgement cannot outlive navigate intent',
    'a late committed acknowledgement cannot outlive scope intent',
    'explicit domain form rejection keeps HTTP status and editable input without persistence'
  ],
  "revalidation.spec.ts": [
    'revalidates external changes without replacing page history or the live shell',
    'retains the last value on a failed refresh and retries through fresh HTTP',
    'a second refresh supersedes a held older HTTP approval without losing the shell',
    'refresh during an unapproved back restores the approved page before failure and retry'
  ],
  "session-transition.spec.ts": [
    'legacy plain children leave through a real unauthorized document after revocation',
    'configured POST auth policy refresh performs one fresh GET and never replays POST',
    'configured GET auth refresh dispatches a fresh read then settles signed out',
    'revokes initial and soft protected pages, closes owned ports, and cancels held HTTP before release',
    '403 stays forbidden and a confirmed permissions save is separate from its rejected GET',
    'anonymous 401 keeps approval and external HttpOnly logout is applied only on a fresh credentialed 401'
  ],
  "long-session-cache.spec.ts": [
    'repeated public cache cycles preserve 32 entries single use and the 64 KiB entry ceiling',
    'four live prefetches admit no fifth queue and excess activation uses fresh HTTP'
  ],
  "long-session-ownership.spec.ts": [
    'a correctly framed incompatible build preserves the operational document and recovers by fresh approval',
    'obsolete import completion cannot replace fresh HTTP approval or initiate fallback',
    'obsolete policy completion cannot replace fresh HTTP approval or initiate fallback',
    'a superseded partial HTTP body and invalid payload cannot restore their obsolete authority',
    'saved plus failed follow-up is recovered by GET only without a second POST',
    'invalid current payload uses the native document boundary and explicit reload creates a new resource'
  ],
  "long-session.spec.ts": [
    'settles at least 1000 seeded jukebox actions in one operational document'
  ]
};
const packedCaseTitles = {
  ...commonCaseTitles,
  "product-authoring.spec.ts": [
    'authored third page: generated props and enhanced saved data -> real HTTP approval without manual wiring',
    'authored third page: disabled JavaScript -> typed native POST303GET roundtrip',
    'authored third page: interrupted HTTP approval -> no partial destination commit'
  ],
  "production-hydration.spec.ts": [
    'opens modified links as native documents without replacing the current page',
    'hydrates two DTO pages and preserves the shell during HTTP-approved navigation',
    'retains the approved page and metadata while an HTTP destination is pending',
    'resets a throwing approved page locally without a second request',
    'refreshes the same page without remounting the generated shell or adding history',
    'keeps native POST, 303 and GET usable without client JavaScript',
    'preserves a generated page on refresh error and retries a fresh approval',
    'preserves the generated shell resource across network and fresh retry',
    'preserves the generated shell resource across server-error and fresh retry',
    'a failed replace commits no unapproved URL or params and explicit document exit remains available',
    'failed back and forward recover the approved entry and remain traversable',
    'repeated transient failures keep one resource and a usable next retry',
    'does not preserve an HTTP 401 refusal in the generated starter',
    'does not preserve an HTTP 403 refusal in the generated starter',
    'does not preserve an HTTP 302 refusal in the generated starter',
    'does not preserve an HTTP 400 refusal in the generated starter',
    'updates a React component and CSS over the app WebSocket without losing eligible state',
    'retains the document and worker through server restart and failed-bootstrap correction',
    'keeps document navigation when JavaScript is disabled',
    'keeps modified links as native new-tab documents',
    'keeps native anchors usable before hydration',
    'falls back to a native document for an unsupported destination',
    'reloads a shared graph only after readiness and aligns SSR with the client',
    'rebuilds the installed dev process on watched env and Vite configuration saves',
    'retains the approved shell after a mapped page import fails until explicit document exit'
  ],
  "session-transition.spec.ts": [
    'packaged session forms revoke initial protected content and recover a distinct session',
    'native session login and logout retain POST 303 GET without JavaScript'
  ],
  "deployment-transition.spec.ts": [
    'keeps an A shell on B navigation and updates only after explicit document choice',
    'reports a real missing mapped asset and preserves the last approved page'
  ]
};
const developmentOnlyCases = [
  'updates a React component and CSS over the app WebSocket without losing eligible state',
  'retains the document and worker through server restart and failed-bootstrap correction',
  'reloads a shared graph only after readiness and aligns SSR with the client',
  'rebuilds the installed dev process on watched env and Vite configuration saves'
];
const productionOnlyCases = [
  'retains the approved shell after a mapped page import fails until explicit document exit'
];
const browserFiles = {
  "ordinary-browser": [
    'deployment-transition.spec.ts',
    'navigation-failure.spec.ts',
    'production-hydration.spec.ts',
    'ssr-delivery.spec.ts'
  ],
  "product-browser": [
    'product-acceptance.spec.ts'
  ],
  "fault-browser": [
    'background-interactions.spec.ts',
    'navigation-guard.spec.ts',
    'product-faults.spec.ts',
    'progressive-forms.spec.ts',
    'revalidation.spec.ts',
    'session-transition.spec.ts'
  ],
  "reliability-browser": [
    'background-interactions.spec.ts',
    'long-session-cache.spec.ts',
    'long-session-ownership.spec.ts',
    'long-session.spec.ts',
    'product-acceptance.spec.ts',
    'product-faults.spec.ts',
    'session-transition.spec.ts'
  ],
  "packed-dev": [
    'background-interactions.spec.ts',
    'navigation-guard.spec.ts',
    'product-acceptance.spec.ts',
    'product-authoring.spec.ts',
    'product-faults.spec.ts',
    'production-hydration.spec.ts',
    'session-transition.spec.ts'
  ],
  "packed-production": [
    'background-interactions.spec.ts',
    'navigation-guard.spec.ts',
    'product-acceptance.spec.ts',
    'product-authoring.spec.ts',
    'product-faults.spec.ts',
    'production-hydration.spec.ts',
    'session-transition.spec.ts'
  ],
  "packed-deployment": [
    'deployment-transition.spec.ts'
  ],
  "soak-browser": [
    'long-session-soak.spec.ts'
  ]
};

function reportFixture(id) {
  const packed = id.startsWith('packed-');
  const titles = id === 'soak-browser'
    ? { 'long-session-soak.spec.ts': ['operates the seeded event-driven jukebox for the declared soak duration'] }
    : packed ? packedCaseTitles : exampleCaseTitles;
  const projects = id === 'reliability-browser' ? ['chromium', 'firefox', 'webkit']
    : id === 'soak-browser' ? ['chromium'] : packed ? ['chrome'] : [''];
  return { errors: [], suites: [{ suites: browserFiles[id].map((file) => ({ file, specs: titles[file]
    .filter((title) => !(id === 'packed-dev' && productionOnlyCases.includes(title))
      && !(id === 'packed-production' && developmentOnlyCases.includes(title)))
    .map((title) => ({ file, title, tests: projects.map((projectName) => ({
      projectName, expectedStatus: 'passed', status: 'expected', results: [{ status: 'passed' }],
    })) })),
  })) }] };
}


function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'fluo-product-consumer-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const log = Buffer.from('actual deterministic fixture command completed\n');
  writeFileSync(join(root, 'command.log'), log);
  const checks = [...new Set(matrix.rows.flatMap((row) => row.checks))].map((id) => {
    let browserReference;
    if (browserFiles[id]) {
      const report = Buffer.from(JSON.stringify(reportFixture(id)));
      const path = `${id}.json`;
      writeFileSync(join(root, path), report);
      browserReference = { path, sha256: digest(report) };
    }
    return { id, head, status: 'passed', exitCode: 0, elapsedMs: 1, command: `fixture ${id}`,
      log: { path: 'command.log', sha256: digest(log) },
      ...(browserReference ? { browserReport: browserReference } : {}),
    };
  });
  return { root, matrix: structuredClone(matrix), receipt: {
    version: 1, issue: 3879, stage: 'local', head, preflightSha256: '3'.repeat(64),
    source: { head, tree: '2'.repeat(40), clean: true },
    matrixSha256: digest(Buffer.from(`${JSON.stringify(matrix, null, 2)}\n`)),
    checks,
    rows: matrix.rows.map((row) => ({ id: row.id, verdict: row.receipt === 'external' ? 'lead-owned-pending' : 'passed' })),
  } };
}

test('product matrix: removed or unknown mandatory row -> fail closed before execution', async (t) => {
  const value = fixture(t);
  assert.equal(matrix.rows.length, requiredRows.length);
  value.matrix.rows.pop();

  await assert.rejects(consumeProduct(value.matrix, value.receipt, value.root, head, tree), /mandatory row/u);
});

test('product receipt: wrong clean source/head -> cannot reuse prior execution', async (t) => {
  const value = fixture(t);
  value.receipt.source.head = '4'.repeat(40);

  await assert.rejects(consumeProduct(value.matrix, value.receipt, value.root, head, tree), /source\/head/u);
});

for (const defect of ['reduced-checks', 'removed-reports', 'changed-surface', 'changed-receipt']) {
  test(`product matrix source binding: rehashed ${defect} -> rejects at canonical matrix guard`, async (t) => {
    const value = fixture(t);
    if (defect === 'reduced-checks' || defect === 'removed-reports') {
      value.matrix.rows.forEach((row) => { row.checks = ['docs-release']; });
      if (defect === 'removed-reports') value.receipt.checks = value.receipt.checks.filter((check) => !check.browserReport);
    }
    if (defect === 'changed-surface') value.matrix.rows[0].surfaces = ['source-only'];
    if (defect === 'changed-receipt') value.matrix.rows[0].receipt = 'external';
    value.receipt.matrixSha256 = digest(Buffer.from(`${JSON.stringify(value.matrix, null, 2)}\n`));

    await assert.rejects(consumeProduct(value.matrix, value.receipt, value.root, head, tree), /canonical matrix/u);
  });
}

for (const verdict of ['skip', 'todo', 'missing', 'failed', 'source-only-pass']) {
  test(`product row: ${verdict} -> no mandatory product PASS`, async (t) => {
    const value = fixture(t);
    value.receipt.rows[0].verdict = verdict;

    await assert.rejects(consumeProduct(value.matrix, value.receipt, value.root, head, tree), /Missing\/skip\/failed row/u);
  });
}

test('product check: nonzero exit -> numeric policy cannot excuse runtime failure', async (t) => {
  const value = fixture(t);
  value.receipt.checks[0].exitCode = 1;

  await assert.rejects(consumeProduct(value.matrix, value.receipt, value.root, head, tree), /Unverified execution/u);
});

test('product artifact: changed bytes -> receipt authentication fails', async (t) => {
  const value = fixture(t);
  writeFileSync(join(value.root, 'command.log'), 'truncated\n');

  await assert.rejects(consumeProduct(value.matrix, value.receipt, value.root, head, tree), /digest mismatch/u);
});

test('product external proof: local source cannot manufacture review or GitHub CI PASS', async (t) => {
  const value = fixture(t);
  value.receipt.rows.find((row) => row.id === 'ci-release').verdict = 'passed';

  await assert.rejects(consumeProduct(value.matrix, value.receipt, value.root, head, tree), /external proof/u);
});

test('product reliability: missing three-engine and timed trace inventory -> incomplete', async (t) => {
  const value = fixture(t);

  await assert.rejects(consumeProduct(value.matrix, value.receipt, value.root, head, tree), /engine inventory/u);
});

test('measurement numeric diagnostics: original FAIL and INCONCLUSIVE -> disclosed without relabeling', () => {
  for (const verdict of ['fail', 'inconclusive']) {
    const value = { methodVersion: 'FA-V3', verdict, checks: [
      { metric: 'shellArrivalMs', reason: 'absolute-budget', verdict, range: [700, 900] },
    ] };

    assert.deepEqual(validateMeasurementDiagnostics(value), { originalVerdict: verdict, numericBlocking: false });
  }
});

for (const verdict of ['fail', 'inconclusive']) {
  test(`measurement quality: ${verdict} -> still blocks despite numeric authorization`, () => {
    const value = { methodVersion: 'FA-V3', verdict, checks: [
      { reason: 'measurement-quality', verdict },
    ] };

    assert.throws(() => validateMeasurementDiagnostics(value), /quality\/authentication\/correctness/u);
  });
}

test('measurement Fluo error rate: positive warmup or measured rate -> blocking', () => {
  const value = { methodVersion: 'FA-V3', verdict: 'fail', checks: [
    { framework: 'fluo', metric: 'errorRate', reason: 'absolute-budget', verdict: 'fail', range: [0, 0.01] },
  ] };

  assert.throws(() => validateMeasurementDiagnostics(value), /zero/u);
});

test('measurement inventory: missing raw proof -> metadata cannot authenticate execution', () => {
  const value = { provenance: { commit: head }, receipts: ['desktop-native', 'desktop-matched-cache', 'tablet-native', 'tablet-matched-cache'].map((profile) => ({
    profile, methodVersion: 'FA-V3', measurementPurpose: 'integrated', isolatedRepresentative: true,
    provenance: { commit: head }, methodBinding: { path: 'original-method', sha256: '1'.repeat(64) },
    environmentBinding: { path: 'original-environment', sha256: '2'.repeat(64) },
    runs: [], warmups: [],
  })) };

  assert.throws(() => validateMeasurementInventory(value, new Map()), /original method\/environment/u);
});

function traceFixture(t) {
  const value = fixture(t);
  const live = { document: 'fixture-document', id: 'fixture-resource', actualInstanceRetained: true,
    mounts: 1, cleanups: 0, ports: 2, unhandled: 0, pendingInteractions: 0,
    pendingNavigation: false, harnessObservers: 0, globalListeners: 10, sockets: 0, interactionOwners: 5 };
  const checkpoint = { live, server: { requestScopes: 0, cleanupSubscriptions: 0 }, harness: { activeRequestReferences: 0 } };
  const events = [];
  const event = (phase, index, detail) => events.push({ phase, index, seed: 3886, detail });
  event('start', 0, { head, engine: 'chromium' });
  event('resource-ack', 0, { id: live.id, sequence: 1, acknowledgement: `${live.id}:1:ack` });
  for (const fault of ['network', 'server-error', 'slow', 'payload', 'import', 'render', 'deploy']) {
    event('fault-schedule', 0, { fault });
  }
  for (let index = 0; index < 1070; index++) {
    event('action-settled', index, 'fixture-action');
    event('resource-ack', index + 1, { id: live.id, sequence: index + 2,
      acknowledgement: `${live.id}:${index + 2}:ack` });
    if (index === 69) event('measurement', 70, { ...checkpoint, warmup: true });
  }
  event('measurement', 1070, { ...checkpoint, warmup: false });
  event('workload-complete', 1070, { index: 1070, elapsedMs: 3600001 });
  const receipt = { version: 1, issue: 3886, head, seed: 3886, engine: 'chromium', kind: 'soak',
    status: 'passed', firstFailure: null, actionCount: 1070, measuredActionCount: 1000,
    elapsedMs: 3600001, eventTrace: 'events.jsonl', surface: 'official-example-production' };
  const save = () => {
    const raw = Buffer.from(`${events.map((event) => JSON.stringify(event)).join('\n')}\n`);
    const bytes = Buffer.from(JSON.stringify(receipt));
    writeFileSync(join(value.root, 'events.jsonl'), raw);
    writeFileSync(join(value.root, 'receipt.json'), bytes);
    return { path: 'receipt.json', sha256: digest(bytes), trace: { path: 'events.jsonl', sha256: digest(raw) } };
  };
  return { ...value, events, receipt, save };
}

test('reliability trace: complete terminal/count/owner/ack inventory -> authenticated parsed run', async (t) => {
  const value = traceFixture(t);

  assert.deepEqual(await reliabilityRun(value.root, value.save(), head), value.receipt);
});

for (const defect of ['truncated', 'inflated-count', 'duration-mismatch', 'missing-fault', 'missing-ack', 'owner-leak', 'pageerror']) {
  test(`reliability trace: ${defect} -> no source-only stability PASS`, async (t) => {
    const value = traceFixture(t);
    if (defect === 'truncated') value.events.pop();
    if (defect === 'inflated-count') value.receipt.measuredActionCount++;
    if (defect === 'duration-mismatch') value.receipt.elapsedMs++;
    if (defect === 'missing-fault') value.events.splice(value.events.findIndex((event) => event.phase === 'fault-schedule'), 1);
    if (defect === 'missing-ack') value.events.splice(value.events.findIndex((event) => event.phase === 'resource-ack'), 1);
    if (defect === 'owner-leak') value.events.find((event) => event.phase === 'measurement').detail.live.cleanups = 1;
    if (defect === 'pageerror') value.events.splice(10, 0, { phase: 'pageerror', seed: 3886, index: 0, detail: 'fixture error' });

    await assert.rejects(reliabilityRun(value.root, value.save(), head));
  });
}

test('reliability inventory: missing engine or below one hour -> incomplete acceptance', () => {
  const runs = ['chromium', 'firefox', 'webkit'].map((engine) => ({ engine, kind: 'correctness' }));

  assert.throws(() => validateReliabilityInventory(runs.slice(0, 2), { kind: 'soak', elapsedMs: 3600001 }), /engine/u);
  assert.throws(() => validateReliabilityInventory(runs, { kind: 'soak', engine: 'chromium', elapsedMs: 3599999 }), /one-hour/u);
  validateReliabilityInventory(runs, { kind: 'soak', engine: 'chromium', elapsedMs: 3600001 });
});

test('CI capture plans: existing domain commands -> fresh separate builds and no invasive collectors', () => {
  const commands = ['tooling', 'starters', 'soak'].flatMap((domain) => productDomainPlan(domain, '/fixture'));
  const serialized = JSON.stringify(commands);

  assert.equal(serialized.includes('verify:local'), false);
  assert.equal(serialized.includes('Frida'), false);
  assert.equal(serialized.includes('frida'), false);
  assert.equal(commands.some((command) => command.id === 'packed-cold-dev'
    && command.args.includes('sandbox:matrix') && command.env.FLUO_CLI_SANDBOX_PROFILE === 'full'), true);
  assert.equal(commands.some((command) => command.id === 'soak-browser'
    && command.env.FLUO_RELIABILITY_SOAK_MS === '3600000'), true);
});

test('final product: absent lead review/waiver/remote evidence -> never final PASS', async (t) => {
  const value = fixture(t);
  value.receipt.stage = 'final';

  await assert.rejects(consumeProduct(value.matrix, value.receipt, value.root, head, tree), /external proof/u);
});

function externalFixture(t) {
  const value = fixture(t);
  const save = (path, data) => {
    const bytes = Buffer.from(JSON.stringify(data));
    writeFileSync(join(value.root, path), bytes);
    return { path, sha256: digest(bytes) };
  };
  const policy = { sha256: '5'.repeat(64), active_axes: ['contract', 'code', 'verification'] };
  const acceptedAt = '2026-10-07T00:00:00.000Z';
  const review = buildReviewFact({
    head_sha: head, preflight_sha256: policy.sha256, active_axes: policy.active_axes,
    reviews: policy.active_axes.map((reviewer) => ({
      reviewer, reviewed_head_sha: head, preflight_sha256: policy.sha256,
      verdict_signal: 'PASS', blockers: [],
    })),
  }, head, policy);
  const binding = localCheckBinding(review, acceptedAt);
  const remote = {
    run: { head_sha: head, status: 'completed', path: '.github/workflows/ci.yml', conclusion: 'success' },
    jobs: { jobs: ['Verify', 'Primary build / build', 'Verify task (tooling-1) / tooling-1',
      'Verify task (starters) / starters'].map((name) => ({ name, status: 'completed', conclusion: 'success' })) },
  };
  value.receipt.stage = 'final';
  value.receipt.external = {
    laneId: 'fixture-lane', policy: save('policy.json', policy),
    review: save('review.json', { head, accepted_at: acceptedAt, value: review }),
    localCiWaiver: save('waiver.json', {
      head, accepted_at: acceptedAt, value: {
        laneId: 'fixture-lane', issue: 3879, status: 'waived', scope: 'full-local-ci',
        preflightSha256: binding.preflightSha256, reviewSha256: binding.reviewSha256,
        reviewAcceptedAt: binding.reviewAcceptedAt, authority: 'explicit-operator-instruction',
        evidence: { kind: 'accepted-preflight', contractSha256: value.receipt.preflightSha256,
          criteria: ['fixture operator instruction'] },
      },
    }),
    remoteCi: save('remote.json', remote),
    ciDomains: [],
  };
  const domains = ['tooling', 'starters'].map((domain) => domainFixture(join(value.root, domain), domain));
  value.receipt.external.ciDomains = domains.map((domain) => save(`${domain.domain}/${domain.domain}-receipt.json`, domain));
  value.receipt.rows.forEach((row) => { row.verdict = 'passed'; });
  return { ...value, remote, save, domains };
}

function domainFixture(root, domain) {
  mkdirSync(root, { recursive: true });
  const artifacts = [];
  const save = (path, data) => {
    const bytes = Buffer.from(typeof data === 'string' ? data : JSON.stringify(data));
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), bytes);
    const reference = { path, sha256: digest(bytes) };
    artifacts.push(reference);
    return reference;
  };
  const inputPaths = ['pnpm-lock.yaml', 'examples/react-vite-ssr/package.json',
    'examples/react-vite-ssr/vite.client.config.ts', 'examples/react-vite-ssr/vite.server.config.ts',
    'examples/react-vite-ssr/playwright.config.ts', 'examples/react-vite-ssr/playwright.reliability.config.ts',
    'tooling/ci/react-product-acceptance.mjs'];
  const repo = fileURLToPath(new URL('../..', import.meta.url));
  const inputDigests = Object.fromEntries(inputPaths.map((path) => [path, digest(readFileSync(join(repo, path)))]));
  const commands = productDomainPlan(domain, root).map((command) => ({
    id: command.id, head, status: 'passed', exitCode: 0, signal: null, elapsedMs: 1,
    command: [command.executable, ...command.args].join(' '), env: command.env,
    log: save(`${command.id}.log`, `fixture execution ${command.id}\n`),
    ...(command.browserReport ? { browserReport: save(command.browserReport, reportFixture(command.id)) } : {}),
    ...(command.id.endsWith('-build') ? { artifacts: [save(`${command.id}-identity.json`, {
      head, command: [command.executable, ...command.args].join(' '), env: command.env, inputDigests,
      identity: { 'dist/client/.vite/manifest.json': 'a'.repeat(64), 'dist/server/main.js': 'b'.repeat(64) },
    })] } : {}),
  }));
  const checks = structuredClone(commands);
  if (domain === 'starters') {
    const artifactEntry = (key, value) => {
      const reference = save(`packed-product/${value.replaceAll('/', '-')}`, `fixture artifact ${value}\n`);
      return { [key]: value, artifact: join(root, reference.path), sha256: reference.sha256, bytes: statBytes(reference) };
    };
    const statBytes = (reference) => readFileSync(join(root, reference.path)).length;
    const rejectionDiagnostics = {
      'missing-module': '/consumer/src/app.ts:126:5: Browser module ./absent-page.tsx is not in the frozen tsconfig graph; use its build-mapped module literal.',
      'duplicate-route': 'Duplicate route registration detected for GET:/products/third:<none>.',
      'invalid-route': '@GET() path "/third/:" is invalid at segment ":": Parameter names must match /[a-zA-Z_][a-zA-Z0-9_]*/. Only literal segments and full-segment ":param" placeholders are supported.',
      'negative-types': [[3, 1, 2322], [4, 1, 2322], [5, 1, 7053], [6, 1, 2322], [7, 1, 2322],
        [9, 1, 2322], [12, 17, 2345]].map(([line, column, code]) =>
        `src/acceptance-negative.ts(${line},${column}): error TS${code}: Argument is not assignable.`).join('\n'),
    };
    const packed = {
      head, source: { head, tree, clean: true }, status: 'passed', product: true, attempt: 'fixture',
      target: { projectName: 'starter-react-vite-ssr', starter: 'react-vite-ssr' }, directory: '/consumer',
      lockedGraph: { snapshotSha256: 'c'.repeat(64), installedLockfileSha256: 'd'.repeat(64) },
      tarballs: ['core', 'http', 'platform-fastify', 'react', 'runtime', 'validation', 'cli', 'testing', 'vite']
        .map((name) => artifactEntry('name', `@fluojs/${name}`)),
      installedFiles: ['client.js', 'client.d.ts', 'client/form.js', 'client/form.d.ts',
        'client/form-store.js', 'client/form-transport.js', 'client/store.js'].map((file) => artifactEntry('file', file)),
      installedTemplates: ['src/catalog.ts', 'src/page-products.tsx', 'tests/background-interactions.spec.ts',
        'tests/form-control.ts', 'tests/product-acceptance.spec.ts', 'tests/product-faults.spec.ts',
        'tests/product-authoring.spec.ts', 'src/app.ts', 'src/react-app.tsx', 'src/session-controls.tsx',
        'src/page-admin.tsx'].map((file) => artifactEntry('file', file)),
      authoring: {
        authored: ['src/page-acceptance.tsx', 'src/app.ts'], manualWiring: [],
        generated: ['src/generated/react-pages.ts'], validationFiles: ['src/acceptance-negative.ts'],
        files: ['src/page-acceptance.tsx', 'src/app.ts'].map((path) => artifactEntry('path', `authored/${path}`))
          .map((entry) => ({ ...entry, path: entry.path.slice('authored/'.length) })),
        journeys: {
          authenticatedCrud: { authored: ['src/catalog.ts', 'src/page-products.tsx', 'src/app.ts'],
            reused: ['src/react-app.tsx', 'src/session-controls.tsx'], manualWiring: [], generated: ['src/generated/react-pages.ts'] },
          jukebox: { authored: [], reused: ['src/page-admin.tsx', 'src/catalog.ts', 'src/react-app.tsx', 'src/session-controls.tsx'],
            manualWiring: [], generated: ['src/generated/react-pages.ts'] },
        },
      },
      commands: [],
    };
    const projection = save('packed-product/projection.ts', 'fixture generated projection\n');
    packed.authoring.generatedArtifact = join(root, projection.path);
    packed.authoring.generatedSha256 = projection.sha256;
    const labels = ['starter-provision', 'starter-typegen', 'starter-types', 'authoring-missing-module-rejection',
      'authoring-duplicate-route-rejection', 'authoring-invalid-route-rejection', 'authoring-negative-types',
      'authoring-positive-types', 'authoring-positive-compile', 'packed-dev', 'starter-tests', 'starter-build',
      'packed-production', 'packed-deployment'];
    for (const label of labels) {
      const rejection = Object.keys(rejectionDiagnostics).find((kind) => label === `authoring-${kind}-rejection`
        || kind === 'negative-types' && label === 'authoring-negative-types');
      const log = save(`packed-product/${label}.log`, `${rejection ? rejectionDiagnostics[rejection] : label}\n`);
      const report = browserFiles[label] ? save(`packed-product/${label}-${packed.attempt}.json`, reportFixture(label)) : undefined;
      const args = label === 'starter-provision'
        ? ['packages/cli/scripts/local-test-env.mjs', 'create', 'starter-react-vite-ssr']
        : label === 'authoring-negative-types' ? ['exec', 'tsc', '-p', 'tsconfig.json', '--noEmit']
        : report ? ['exec', 'playwright', 'test', '--config', 'playwright.config.ts', '--workers=1', '--reporter=json',
          `--output=${join(root, 'packed-product', `${label}-${packed.attempt}`)}`,
          ...(label === 'packed-deployment' ? ['tests/deployment-transition.spec.ts']
            : ['tests/production-hydration.spec.ts', 'tests/background-interactions.spec.ts',
              'tests/session-transition.spec.ts', 'tests/navigation-guard.spec.ts', 'tests/product-acceptance.spec.ts',
              'tests/product-faults.spec.ts', 'tests/product-authoring.spec.ts', '--grep-invert',
              label === 'packed-dev' ? productionOnlyCases[0]
                : 'updates a React component|retains the document and worker|reloads a shared graph|rebuilds the installed dev process'])]
        : [label === 'starter-tests' ? 'test' : label === 'starter-build' ? 'build'
          : ['starter-types', 'authoring-positive-compile'].includes(label) ? 'typecheck' : 'typegen'];
      const env = label === 'starter-provision'
        ? { FLUO_CLI_SANDBOX_ROOT: packed.directory, FLUO_CLI_SANDBOX_STARTER: 'react-vite-ssr',
          FLUO_CLI_SANDBOX_DEPENDENCIES: 'locked', FLUO_CLI_SANDBOX_PROFILE: 'smoke' }
        : report ? { FLUO_PRODUCT_ACCEPTANCE: '1',
          ...(label === 'packed-dev' ? { FLUO_REACT_STARTER_SERVER_COMMAND: 'dev' } : {}),
          FLUO_REACT_STARTER_TEST_PORT: label === 'packed-dev' ? '44981' : label === 'packed-production' ? '44982' : '44983',
          PLAYWRIGHT_JSON_OUTPUT_NAME: join(root, report.path) } : {};
      packed.commands.push({ label, command: [label === 'starter-provision' ? process.execPath : 'pnpm', ...args],
        cwd: packed.directory, env,
        exit: rejection ? rejection === 'negative-types' ? 2 : 1 : 0, signal: null,
        expectedRejection: Boolean(rejection), elapsedMs: 1, log: join(root, log.path), logSha256: log.sha256,
        ...(report ? { browserReport: join(root, report.path), browserReportSha256: report.sha256 } : {}) });
    }
    const reference = save('packed-product/pack-release-fixture.json', packed);
    commands.find((command) => command.id === 'packed-product').packagedReceipt = reference;
    checks.find((command) => command.id === 'packed-product').packagedReceipt = reference;
    checks.push({ ...checks.find((command) => command.id === 'packed-product'), id: 'packed-authoring' });
    for (const id of ['packed-dev', 'packed-production', 'packed-deployment']) {
      const entry = packed.commands.find((command) => command.label === id);
      checks.push({ id, head, status: 'passed', exitCode: entry.exit, elapsedMs: entry.elapsedMs,
        command: entry.command.join(' '), env: entry.env,
        log: { path: `packed-product/${id}.log`, sha256: entry.logSha256 },
        browserReport: { path: `packed-product/${id}-${packed.attempt}.json`, sha256: entry.browserReportSha256 },
        packagedReceipt: reference });
    }
  }
  return { version: 1, issue: 3879, head, source: { head, tree, clean: true }, inputDigests,
    runtime: { node: process.version, executable: process.execPath, platform: process.platform, arch: process.arch, pnpm: '10.4.1' },
    status: 'domain-evidence-complete', domain, commands, checks, artifacts };
}

for (const domain of ['tooling', 'starters']) {
  for (const defect of ['fixture-only', 'missing-command', 'missing-check', 'wrong-head', 'failed-exit',
    'missing-log', 'wrong-log-digest', 'missing-report', 'removed-case', 'missing-artifact', 'wrong-input',
    'failed-status', 'signal', 'invalid-duration', 'wrong-command', 'wrong-env', 'wrong-tree', 'removed-project']) {
    test(`final CI domain authentication: ${domain} ${defect} -> rejects incomplete mandatory execution`, (t) => {
      const value = externalFixture(t);
      const receipt = value.domains.find((entry) => entry.domain === domain);
      if (defect === 'fixture-only') { receipt.commands = []; receipt.checks = [{ id: 'fixture-command' }]; }
      if (defect === 'missing-command') receipt.commands.pop();
      if (defect === 'missing-check') receipt.checks.pop();
      if (defect === 'wrong-head') receipt.commands[0].head = '0'.repeat(40);
      if (defect === 'failed-exit') receipt.commands[0].exitCode = 1;
      if (defect === 'failed-status') receipt.commands[0].status = 'failed';
      if (defect === 'signal') receipt.commands[0].signal = 'SIGTERM';
      if (defect === 'invalid-duration') receipt.commands[0].elapsedMs = -1;
      if (defect === 'wrong-command') receipt.commands[0].command = 'pnpm source-only';
      if (defect === 'wrong-env') receipt.commands[0].env = { OMIT_MANDATORY_CASES: '1' };
      if (defect === 'wrong-tree') receipt.source.tree = '0'.repeat(40);
      if (defect === 'missing-log') delete receipt.commands[0].log;
      if (defect === 'wrong-log-digest') receipt.commands[0].log.sha256 = '0'.repeat(64);
      const browser = receipt.checks.find((entry) => entry.browserReport);
      if (defect === 'missing-report') delete browser.browserReport;
      if (defect === 'removed-case' || defect === 'removed-project') {
        const report = JSON.parse(readFileSync(join(value.root, domain, browser.browserReport.path)));
        if (defect === 'removed-case') report.suites[0].suites[0].specs.pop();
        else report.suites[0].suites[0].specs[0].tests[0].projectName = 'unrelated-project';
        const updated = value.save(`${domain}/${browser.browserReport.path}`, report);
        browser.browserReport.sha256 = updated.sha256;
        receipt.artifacts.find((entry) => entry.path === browser.browserReport.path).sha256 = updated.sha256;
      }
      if (defect === 'missing-artifact') receipt.artifacts.pop();
      if (defect === 'wrong-input') receipt.inputDigests['pnpm-lock.yaml'] = '0'.repeat(64);
      value.receipt.external.ciDomains[domain === 'tooling' ? 0 : 1] = value.save(`${domain}/${domain}-receipt.json`, receipt);

      assert.throws(() => externalEvidence(value.root, value.receipt, head),
        defect === 'removed-case' || defect === 'removed-project' ? /mandatory browser case\/project/u
          : defect === 'missing-report' ? /Missing actual browser report/u : undefined);
    });
  }
  for (const command of productDomainPlan(domain, '/fixture')) {
    for (const collection of ['commands', 'checks']) {
      test(`final CI required inventory: ${domain} removed ${collection} ${command.id} -> rejects canonical plan omission`, (t) => {
        const value = externalFixture(t);
        const receipt = value.domains.find((entry) => entry.domain === domain);
        receipt[collection] = receipt[collection].filter((entry) => entry.id !== command.id);
        value.receipt.external.ciDomains[domain === 'tooling' ? 0 : 1] =
          value.save(`${domain}/${domain}-receipt.json`, receipt);

        assert.throws(() => externalEvidence(value.root, value.receipt, head), /mandatory CI domain|canonical command\/check/u);
      });
    }
  }
  for (const collection of ['commands', 'checks']) {
    test(`final CI required inventory: ${domain} extra ${collection} -> rejects noncanonical execution`, (t) => {
      const value = externalFixture(t);
      const receipt = value.domains.find((entry) => entry.domain === domain);
      receipt[collection].push({ ...structuredClone(receipt[collection][0]), id: 'unreviewed-extra-command' });
      value.receipt.external.ciDomains[domain === 'tooling' ? 0 : 1] =
        value.save(`${domain}/${domain}-receipt.json`, receipt);

      assert.throws(() => externalEvidence(value.root, value.receipt, head), /mandatory CI domain execution inventory/u);
    });
  }
  for (const field of ['head', 'exitCode', 'command', 'env', 'log']) {
    test(`final CI canonical authentication: ${domain} mutually matching wrong ${field} -> rejects rehashed command and check`, (t) => {
      const value = externalFixture(t);
      const receipt = value.domains.find((entry) => entry.domain === domain);
      const command = receipt.commands[0];
      if (field === 'head') command.head = '0'.repeat(40);
      if (field === 'exitCode') command.exitCode = 1;
      if (field === 'command') command.command = 'pnpm source-only';
      if (field === 'env') command.env = { SOURCE_ONLY: '1' };
      if (field === 'log') command.log.sha256 = '0'.repeat(64);
      receipt.checks[0] = structuredClone(command);
      value.receipt.external.ciDomains[domain === 'tooling' ? 0 : 1] =
        value.save(`${domain}/${domain}-receipt.json`, receipt);

      assert.throws(() => externalEvidence(value.root, value.receipt, head),
        ['head', 'exitCode'].includes(field) ? /Unverified execution/u
          : field === 'log' ? /Artifact digest mismatch/u : /canonical command\/check/u);
    });
  }
}

for (const collection of ['tarballs', 'installedFiles', 'installedTemplates', 'commands', 'authoring-files']) {
  test(`final CI packed inventory: removed ${collection} -> rejects rehashed producer receipt`, (t) => {
    const value = externalFixture(t);
    const domain = value.domains[1];
    const reference = domain.commands.find((entry) => entry.id === 'packed-product').packagedReceipt;
    const packed = JSON.parse(readFileSync(join(value.root, 'starters', reference.path)));
    (collection === 'authoring-files' ? packed.authoring.files : packed[collection]).pop();
    const updated = { ...value.save(`starters/${reference.path}`, packed), path: reference.path };
    for (const entry of [...domain.commands, ...domain.checks]) {
      if (entry.packagedReceipt) entry.packagedReceipt = updated;
    }
    domain.artifacts.find((entry) => entry.path === reference.path).sha256 = updated.sha256;
    value.receipt.external.ciDomains[1] = value.save('starters/starters-receipt.json', domain);

    assert.throws(() => externalEvidence(value.root, value.receipt, head), /packed|Packed/u);
  });
}

for (const defect of ['wrong-head', 'wrong-tree', 'signal', 'wrong-exit', 'wrong-command', 'wrong-env',
  'wrong-log-digest', 'wrong-report-digest', 'wrong-artifact-digest', 'missing-negative-diagnostic']) {
  test(`final CI packed authentication: rehashed ${defect} -> rejects producer mismatch`, (t) => {
    const value = externalFixture(t);
    const domain = value.domains[1];
    const reference = domain.commands.find((entry) => entry.id === 'packed-product').packagedReceipt;
    const packed = JSON.parse(readFileSync(join(value.root, 'starters', reference.path)));
    if (defect === 'wrong-head') packed.head = '0'.repeat(40);
    if (defect === 'wrong-tree') packed.source.tree = '0'.repeat(40);
    if (defect === 'signal') packed.commands[0].signal = 'SIGINT';
    if (defect === 'wrong-exit') packed.commands[0].exit = 1;
    if (defect === 'wrong-command') packed.commands[0].command = ['pnpm', 'stub'];
    if (defect === 'wrong-env') packed.commands[0].env = {};
    if (defect === 'wrong-log-digest') packed.commands[0].logSha256 = '0'.repeat(64);
    if (defect === 'wrong-report-digest') packed.commands.find((entry) => entry.label === 'packed-dev').browserReportSha256 = '0'.repeat(64);
    if (defect === 'wrong-artifact-digest') packed.installedFiles[0].sha256 = '0'.repeat(64);
    if (defect === 'missing-negative-diagnostic') {
      const entry = packed.commands.find((entry) => entry.label === 'authoring-negative-types');
      const bytes = Buffer.from('src/acceptance-negative.ts(12,17): error TS2345: Argument is not assignable.\n');
      writeFileSync(entry.log, bytes);
      entry.logSha256 = digest(bytes);
      domain.artifacts.find((ref) => join(value.root, 'starters', ref.path) === entry.log).sha256 = entry.logSha256;
    }
    const updated = { ...value.save(`starters/${reference.path}`, packed), path: reference.path };
    for (const entry of [...domain.commands, ...domain.checks]) if (entry.packagedReceipt) entry.packagedReceipt = updated;
    domain.artifacts.find((entry) => entry.path === reference.path).sha256 = updated.sha256;
    value.receipt.external.ciDomains[1] = value.save('starters/starters-receipt.json', domain);

    assert.throws(() => externalEvidence(value.root, value.receipt, head), /packed|Packed|digest mismatch/u);
  });
}

let captureCheckout;
async function descendantLifecycle(t, signal, mode) {
  const root = process.env.FLUO_PRODUCT_TEST_EVIDENCE ?? mkdtempSync(join(tmpdir(), 'fluo-descendants-'));
  mkdirSync(root, { recursive: true });
  const output = mkdtempSync(join(root, 'descendants-'));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new assert.AssertionError({
    message: 'Owned grandchildren must release inherited pipes and sockets before command settlement',
  })), 15_000);
  const pids = new Set();
  const sockets = [];
  const socketClosures = [];
  const socketErrors = [];
  const ready = new Set();
  const exited = new Set();
  const registered = new Set();
  const nested = mode.startsWith('nested');
  let leader;
  let leaderKilled = false;
  const events = [];
  let child;
  let triggered = false;
  const count = nested ? 2 : 1;
  const trigger = () => {
    if (triggered || ready.size !== count || mode === 'normal') return;
    if ((mode === 'parent-exit' || mode === 'forced-exit') && exited.size !== count) return;
    if (mode === 'nested-forced') {
      if (registered.size !== count) return;
      if (!leaderKilled) { leaderKilled = true; process.kill(leader, 'SIGKILL'); return; }
      if (!exited.has(0)) return;
    }
    triggered = true; child.kill(signal);
  };
  const server = createServer((socket) => {
    sockets.push(socket);
    socket.on('error', (error) => socketErrors.push(error.code));
    const closure = new Promise((done, reject) => {
      socket.once('close', done);
      controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true });
    });
    void closure.catch(() => {});
    socketClosures.push(closure);
    let pending = '';
    socket.on('data', (chunk) => {
      pending += chunk;
      const lines = pending.split('\n'); pending = lines.pop();
      for (const line of lines) {
        const event = JSON.parse(line);
        events.push(event);
        if (event.state === 'ready') {
          pids.add(event.pid); pids.add(event.parent); ready.add(event.id);
        }
        if (mode === 'normal' && event.state === 'stopped') socket.write('release\n');
      }
      trigger();
    });
    socket.resume();
  });
  const listening = once(server, 'listening', { signal: controller.signal });
  server.listen(0, '127.0.0.1');
  await listening;
  const grandchild = (id) => `
    const socket = require('node:net').connect(${server.address().port}, '127.0.0.1');
    const emit = (state) => socket.write(JSON.stringify({ id: ${JSON.stringify(id)}, pid: process.pid, parent: process.ppid, state }) + '\\n');
    let stopped = false;
    let released = false;
    const finish = () => { if (stopped && released) socket.end(() => process.exit(0)); };
    socket.on('data', () => { released = true; finish(); });
    process.on('SIGTERM', () => {
      ${mode === 'stubborn' ? '' : "if (stopped) return; stopped = true; emit('stopped'); finish();"}
    });
    socket.on('connect', () => { console.log('GRANDCHILD_READY ' + process.pid); emit('ready'); if (process.send) process.send('ready'); });
  `;
  const parent = (id) => `
    const cp = require('node:child_process');
    const script = ${JSON.stringify(grandchild(id))};
    if (${JSON.stringify(mode)} === 'active-sync' || ${JSON.stringify(mode)} === 'stubborn') {
      cp.spawnSync(process.execPath, ['-e', script], { stdio: 'inherit' });
    } else {
      const child = cp.spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
      child.on('message', () => {
        if (${JSON.stringify(mode)} === 'parent-exit' || ${JSON.stringify(mode)} === 'normal') process.exit(0);
        if (${JSON.stringify(mode)} === 'forced-exit') process.kill(process.pid, 'SIGTERM');
      });
      if (${JSON.stringify(mode)} !== 'forced-exit') process.on('SIGTERM', () => child.kill('SIGTERM'));
      child.on('close', () => process.exit(0));
    }
  `;
  const scripts = Array.from({ length: count }, (_, i) => parent(String(i)));
  const inner = `
    if (${JSON.stringify(mode)} === 'nested-late') {
      const send = process.send.bind(process);
      const pending = [];
      process.send = (message) => {
        if (message.action === 'register') { pending.push(message); return true; }
        return send(message);
      };
      process.on('SIGTERM', () => { for (const message of pending.splice(0)) send(message); });
    }
    import { createCommandRunner } from ${JSON.stringify(process.env.FLUO_BACKGROUND_TEST_IMPLEMENTATION ?? fileURLToPath(new URL('../../examples/react-vite-ssr/tests/verify-background-starter.mjs', import.meta.url)))};
    const commands = [];
    const { run, dispose } = createCommandRunner(${JSON.stringify(output)}, commands);
    const results = await Promise.allSettled(${JSON.stringify(scripts)}.map((script, i) =>
      run('inner-' + i, ['-e', script], process.cwd(), {}, process.execPath)));
    dispose();
    if (results.some(({ status }) => status === 'rejected')) process.exitCode = 1;
  `;
  if (!captureCheckout) {
    captureCheckout = realpathSync(mkdtempSync(join(tmpdir(), 'fluo-capture-checkout-')));
    execFileSync('git', ['clone', '--quiet', '--shared', '--no-hardlinks',
      fileURLToPath(new URL('../..', import.meta.url)), captureCheckout]);
  }
  assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: captureCheckout, encoding: 'utf8' }), '');
  mkdirSync(join(captureCheckout, '.omo/verification/issue-3879'), { recursive: true });
  const captureOutput = mkdtempSync(join(captureCheckout, '.omo/verification/issue-3879/descendant-'));
  const targetPath = join(captureCheckout, 'tooling/ci/react-product-acceptance.mjs');
  const implementation = process.env.FLUO_PRODUCT_TEST_IMPLEMENTATION
    ?? fileURLToPath(new URL('./react-product-acceptance.mjs', import.meta.url));
  const driver = `
    import cp from 'node:child_process';
    import fs from 'node:fs';
    import { registerHooks, syncBuiltinESMExports } from 'node:module';
    import { pathToFileURL } from 'node:url';
    const originalSpawn = cp.spawn;
    const target = pathToFileURL(${JSON.stringify(targetPath)}).href;
    const runnerTarget = new URL('../../examples/react-vite-ssr/tests/verify-background-starter.mjs', target).href;
    registerHooks({ load(url, context, next) {
      if (url === target) return { format: 'module', source: fs.readFileSync(${JSON.stringify(implementation)}, 'utf8'), shortCircuit: true };
      if (url === runnerTarget) return { format: 'module', source: fs.readFileSync(${JSON.stringify(
        process.env.FLUO_BACKGROUND_TEST_IMPLEMENTATION
          ?? fileURLToPath(new URL('../../examples/react-vite-ssr/tests/verify-background-starter.mjs', import.meta.url)))}, 'utf8'), shortCircuit: true };
      return next(url, context);
    } });
    let starts = 0;
    cp.spawn = (_executable, _args, options) => {
      const script = starts++ === 0 ? ${JSON.stringify(nested ? inner : scripts[0])} : 'console.log("SUCCESS")';
      const child = originalSpawn(process.execPath, [${nested ? "'--input-type=module'," : ''} '-e', script], options);
      process.send({ ownedLeader: child.pid });
      child.on('owned-descendant', (pid) => process.send({ registered: pid }));
      child.once('exit', () => process.send({ leaderExit: 0 }));
      return child;
    };
    syncBuiltinESMExports();
    const { captureDomain } = await import(target);
    const listeners = [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')];
    let cancellations = 0;
    let repeated;
    const repetition = new Promise((done) => { repeated = done; });
    const acknowledge = () => { process.send({ cancellation: ++cancellations }); if (cancellations === 2) repeated(); };
    process.on(${JSON.stringify(signal)}, acknowledge);
    process.channel.ref();
    let failure;
    try { await captureDomain('tooling', ${JSON.stringify(captureOutput)}); }
    catch (error) { failure = error.message; }
    if (cancellations) await repetition;
    process.off(${JSON.stringify(signal)}, acknowledge);
    const receipt = JSON.parse(fs.readFileSync(${JSON.stringify(join(captureOutput, 'tooling-receipt.json'))}, 'utf8'));
    process.send({ result: { receipt, starts, failure,
      listenersRestored: listeners.every((count, i) => count === process.listenerCount(['SIGINT', 'SIGTERM'][i])) } });
    process.disconnect();
  `;
  child = spawn(process.execPath, ['--input-type=module', '-e', driver], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  const raw = createWriteStream(join(output, 'driver.log'));
  const terminalClosed = once(child, 'close');
  const closed = once(child, 'close', { signal: controller.signal });
  const observed = new Promise((resolveResult, rejectResult) => {
    child.on('message', (message) => {
      if (message.ownedLeader !== undefined) { leader = message.ownedLeader; pids.add(leader); trigger(); }
      else if (message.registered !== undefined) { registered.add(message.registered); trigger(); }
      else if (message.leaderExit !== undefined) { exited.add(message.leaderExit); trigger(); }
      else if (message.cancellation === 1) child.kill(signal);
      else if (message.cancellation === 2 && mode !== 'nested-forced') {
        for (const socket of sockets) socket.write('release\n');
      }
      else if (message.result) resolveResult(message.result);
    });
    controller.signal.addEventListener('abort', () => rejectResult(controller.signal.reason), { once: true });
  });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => raw.write(chunk));
  t.after(async () => {
    clearTimeout(timeout);
    for (const pid of pids) {
      try { process.kill(pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    child.kill('SIGKILL');
    await terminalClosed;
    for (const socket of sockets) socket.destroy();
    server.close();
    raw.end(); await finished(raw);
    writeFileSync(join(output, 'socket-events.json'), JSON.stringify({ signal, mode, ready: [...ready], exited: [...exited], registered: [...registered], events }, null, 2));
    cpSync(captureOutput, join(output, 'capture'), { recursive: true });
    if (!process.env.FLUO_PRODUCT_TEST_EVIDENCE) rmSync(root, { recursive: true, force: true });
  });

  const [result, [exit, exitSignal]] = await Promise.all([observed, closed]);
  await Promise.all(socketClosures);

  assert.equal(exit, 0);
  assert.equal(exitSignal, null);
  assert.equal(ready.size, count);
  assert.equal(sockets.length, count);
  assert.deepEqual(socketErrors.filter((code) => mode !== 'nested-forced' || code !== 'ECONNRESET'), []);
  assert.equal(result.listenersRestored, true);
  if (mode === 'nested-late' || mode === 'nested-forced') assert.equal(registered.size, 2);
  if (mode === 'nested-forced') assert.equal(result.receipt.commands[0].signal, 'SIGKILL');
  cpSync(captureOutput, join(output, 'capture'), { recursive: true });
  assert.equal(result.starts, mode === 'normal' ? 3 : 1);
  assert.equal(result.receipt.status, 'failed');
  assert.equal(result.receipt.commands[0].status, mode === 'normal' ? 'passed' : 'failed');
  if (mode === 'normal') assert.doesNotMatch(result.failure, /cancelled/u);
  else assert.match(result.failure, /cancelled/u);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  for (const mode of ['active-sync', 'parent-exit', 'forced-exit', 'stubborn', 'nested', 'nested-forced', 'nested-late', 'normal']) {
    test(`capture descendants: ${signal} ${mode} -> settles real inherited pipes and owned sockets`,
      (t) => descendantLifecycle(t, signal, mode));
  }
}

after(() => { if (captureCheckout) rmSync(captureCheckout, { recursive: true, force: true }); });

async function captureCancellation(t, signal, phase) {
  const implementation = process.env.FLUO_PRODUCT_TEST_IMPLEMENTATION
    ?? fileURLToPath(new URL('./react-product-acceptance.mjs', import.meta.url));
  if (!captureCheckout) {
    captureCheckout = realpathSync(mkdtempSync(join(tmpdir(), 'fluo-capture-checkout-')));
    execFileSync('git', ['clone', '--quiet', '--shared', '--no-hardlinks',
      fileURLToPath(new URL('../..', import.meta.url)), captureCheckout]);
  }
  // The disposable checkout really is clean. Load the assigned implementation
  // in memory; never override git status or label the shared dirty tree clean.
  assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: captureCheckout, encoding: 'utf8' }), '');
  const evidenceRoot = join(captureCheckout, '.omo/verification/issue-3879');
  mkdirSync(evidenceRoot, { recursive: true });
  const output = mkdtempSync(join(evidenceRoot, 'cancellation-'));
  const modulePath = join(captureCheckout, 'tooling/ci/react-product-acceptance.mjs');
  const driver = `
    import cp from 'node:child_process';
    import fs from 'node:fs';
    import { once } from 'node:events';
    import { registerHooks, syncBuiltinESMExports } from 'node:module';
    import { pathToFileURL } from 'node:url';
    const signal = ${JSON.stringify(signal)};
    const phase = ${JSON.stringify(phase)};
    process.channel.ref();
    const target = pathToFileURL(${JSON.stringify(modulePath)}).href;
    const runnerTarget = new URL('../../examples/react-vite-ssr/tests/verify-background-starter.mjs', target).href;
    registerHooks({ load(url, context, next) {
      if (url === target) return { format: 'module', source: fs.readFileSync(${JSON.stringify(implementation)}, 'utf8'), shortCircuit: true };
      if (url === runnerTarget) return { format: 'module', source: fs.readFileSync(${JSON.stringify(
        process.env.FLUO_BACKGROUND_TEST_IMPLEMENTATION
          ?? fileURLToPath(new URL('../../examples/react-vite-ssr/tests/verify-background-starter.mjs', import.meta.url)))}, 'utf8'), shortCircuit: true };
      return next(url, context);
    } });
    const originalSpawn = cp.spawn;
    const originalStream = fs.createWriteStream;
    let starts = 0;
    const pids = [];
    let injected = false;
    const cancel = async () => {
      const received = once(process, signal);
      process.kill(process.pid, signal);
      await received;
      injected = true;
    };
    cp.spawn = (_executable, _args, options) => {
      starts++;
      const script = phase === 'active' && starts === 1
        ? 'process.on("SIGTERM", () => { console.log("HANDLED_EXIT_ZERO"); process.exit(0); }); require("node:net").createServer().listen(0, () => console.log("READY"));'
        : 'console.log("SUCCESS");';
      const child = originalSpawn(process.execPath, ['-e', script], options);
      pids.push(child.pid);
      process.stdout.write('CAPTURE_CHILD ' + child.pid + '\\n');
      if (starts === 1 && phase === 'active') {
        let pending = '';
        child.stdout.on('data', (chunk) => {
          pending += chunk;
          if (pending.includes('READY\\n') && !injected) { injected = true; void cancel(); }
        });
      }
      if (starts === 1 && phase === 'exit-before-close') {
        let cancellation;
        child.once('exit', () => { cancellation = cancel(); });
        const emit = child.emit;
        child.emit = function(event, ...args) {
          if (event === 'close') { void cancellation.then(() => emit.call(this, event, ...args)); return true; }
          return emit.call(this, event, ...args);
        };
      }
      return child;
    };
    if (phase === 'between-commands') fs.createWriteStream = (...args) => {
      const stream = originalStream(...args);
      const emit = stream.emit;
      stream.emit = function(event, ...values) {
        if (event === 'finish' && !injected) {
          void cancel().then(() => emit.call(this, event, ...values)); return true;
        }
        return emit.call(this, event, ...values);
      };
      return stream;
    };
    syncBuiltinESMExports();
    const listeners = [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')];
    const { captureDomain } = await import(target);
    let failure;
    try { await captureDomain('tooling', ${JSON.stringify(output)}); }
    catch (error) { failure = error.message; }
    const receipt = JSON.parse(fs.readFileSync(${JSON.stringify(join(output, 'tooling-receipt.json'))}, 'utf8'));
    process.send({ failure, starts, pids, receipt, listeners, after: [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')] });
    process.disconnect();
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', driver], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  const controller = new AbortController();
  const ownedPids = new Set();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  t.after(() => {
    clearTimeout(timeout);
    for (const pid of ownedPids) {
      try { process.kill(pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    child.kill('SIGKILL');
  });
  // Subscribe to the terminal result before any child readiness can trigger a signal.
  const result = once(child, 'message', { signal: controller.signal });
  const closed = once(child, 'close', { signal: controller.signal });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
    for (const match of stdout.matchAll(/^CAPTURE_CHILD (\d+)$/gmu)) ownedPids.add(Number(match[1]));
  });
  child.stderr.on('data', (chunk) => { stderr += chunk; });

  const [[observed], [exit, exitSignal]] = await Promise.all([result, closed]);
  assert.equal(exit, 0, stderr);
  assert.equal(exitSignal, null);
  if (process.env.FLUO_PRODUCT_TEST_EVIDENCE) {
    const destination = mkdtempSync(join(resolve(process.env.FLUO_PRODUCT_TEST_EVIDENCE), `${signal}-${phase}-`));
    cpSync(output, destination, { recursive: true });
  }
  assert.equal(observed.starts, phase === 'uncancelled' ? 3 : 1, stdout);
  assert.equal(observed.receipt.commands.length, observed.starts);
  assert.equal(observed.receipt.commands[0].exitCode, 0);
  assert.equal(observed.receipt.status, 'failed');
  if (phase === 'uncancelled') assert.doesNotMatch(observed.failure, /cancelled/u);
  else assert.match(observed.failure, /cancelled/u);
  assert.deepEqual(observed.after, observed.listeners);
  for (const pid of observed.pids) assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
}

test('capture commands: no cancellation -> retains sequential zero-exit execution and listener cleanup',
  (t) => captureCancellation(t, 'SIGTERM', 'uncancelled'));

for (const signal of ['SIGINT', 'SIGTERM']) {
  for (const phase of ['active', 'exit-before-close', 'between-commands']) {
    test(`capture cancellation: ${signal} ${phase} with child exit zero -> latches and blocks next command`,
      (t) => captureCancellation(t, signal, phase));
  }
}

test('final external evidence: expanded reusable job identities -> passes through product domain guards', async (t) => {
  const value = externalFixture(t);

  assert.doesNotThrow(() => externalEvidence(value.root, value.receipt, head));
  await assert.rejects(consumeProduct(value.matrix, value.receipt, value.root, head, tree), /engine inventory/u);
});

for (const name of ['Verify', 'Primary build / build', 'Verify task (tooling-1) / tooling-1',
  'Verify task (starters) / starters']) {
  test(`final external evidence: removed ${name} -> rejects at required job guard`, (t) => {
    const value = externalFixture(t);
    value.remote.jobs.jobs = value.remote.jobs.jobs.filter((job) => job.name !== name);
    value.receipt.external.remoteCi = value.save('remote.json', value.remote);

    assert.throws(() => externalEvidence(value.root, value.receipt, head), /product domain jobs/u);
  });
}

for (const id of Object.keys(browserFiles)) {
  test(`browser inventory: complete applicable ${id} cases and projects -> accepted`, () => {
    const report = reportFixture(id);

    assert.equal(browserReport(report, browserFiles[id], id),
      report.suites[0].suites.flatMap((suite) => suite.specs).reduce((count, spec) => count + spec.tests.length, 0));
  });

  test(`browser inventory: each removed ${id} case/project -> cannot be covered by surviving cases`, () => {
    const complete = reportFixture(id);
    for (const [suiteIndex, suite] of complete.suites[0].suites.entries()) {
      for (const [specIndex, spec] of suite.specs.entries()) {
        for (const [testIndex, execution] of spec.tests.entries()) {
          const report = structuredClone(complete);
          report.suites[0].suites[suiteIndex].specs[specIndex].tests.splice(testIndex, 1);

          assert.throws(() => browserReport(report, browserFiles[id], id), /mandatory browser case\/project/u,
            `${spec.file}: ${spec.title} (${execution.projectName})`);
        }
      }
    }
  });

  for (const defect of ['duplicate', 'replacement', 'wrong-project']) {
    test(`browser inventory: ${id} ${defect} -> rejects even with nonzero successful tests`, () => {
      const report = reportFixture(id);
      const specs = report.suites[0].suites[0].specs;
      if (defect === 'duplicate') specs.push(structuredClone(specs[0]));
      if (defect === 'replacement') specs[0].title = 'unrelated successful machine case';
      if (defect === 'wrong-project') specs[0].tests[0].projectName = 'unrelated-project';

      assert.throws(() => browserReport(report, browserFiles[id], id), /browser case\/project/u);
    });
  }
}

for (const defect of ['failed', 'skipped', 'retried', 'unexpected', 'report-error']) {
  test(`browser validity: ${defect} execution -> remains blocking`, () => {
    const report = reportFixture('product-browser');
    const execution = report.suites[0].suites[0].specs[0].tests[0];
    if (defect === 'failed') execution.results[0].status = 'failed';
    if (defect === 'skipped') execution.expectedStatus = 'skipped';
    if (defect === 'retried') execution.results.push({ status: 'passed' });
    if (defect === 'unexpected') execution.status = 'unexpected';
    if (defect === 'report-error') report.errors.push({ message: 'fixture execution error' });

    assert.throws(() => browserReport(report, browserFiles['product-browser'], 'product-browser'));
  });
}

test('product consumption: native case removed from authenticated report -> fails before row or reliability gates', async (t) => {
  const value = fixture(t);
  const report = reportFixture('product-browser');
  report.suites[0].suites[0].specs.splice(1, 1);
  const bytes = Buffer.from(JSON.stringify(report));
  writeFileSync(join(value.root, 'product-browser.json'), bytes);
  value.receipt.checks.find((check) => check.id === 'product-browser').browserReport.sha256 = digest(bytes);

  await assert.rejects(consumeProduct(value.matrix, value.receipt, value.root, head, tree), /mandatory browser case\/project/u);
});

function measurementFixture(direct = false, development = false, relations = false) {
  const rawFiles = new Map();
  const store = (path, value) => {
    const bytes = Buffer.from(JSON.stringify(value));
    rawFiles.set(path, { bytes, sha256: digest(bytes) });
    return { path, sha256: digest(bytes) };
  };
  const provenance = { commit: head, root: '/original', baselineSha256: 'a'.repeat(64),
    sourceSha256: 'b'.repeat(64), lockfile: { '.': 'c'.repeat(64) }, builds: { fluo: 'pnpm build' } };
  const receipts = ['desktop-native', 'desktop-matched-cache', 'tablet-native', 'tablet-matched-cache'].map((profile) => {
    const mode = profile.endsWith('matched-cache') ? 'matched-cache' : 'native';
    const configuration = { ...structuredClone(representative.measurement), methodVersion: 'FA-V3',
      measurementPurpose: 'integrated', measurementKind: 'production', pairId: 'fixture-pair',
      pairPhase: 'before', warmupRuns: 2, measurementRuns: 5,
      nativeLifetime: { enabled: true, python: '/original/python' }, profile, mode,
      apps: Object.fromEntries(['fluo', 'next', 'react-router', 'tanstack-start']
        .map((framework, index) => [framework, `http://127.0.0.1:${32000 + index}/`])), provenance };
    const developmentConfiguration = { ...configuration, measurementPurpose: 'timing',
      measurementKind: 'development', nativeLifetime: { enabled: false } };
    const bindMethod = (config, phase) => {
      const { measurementPurpose, nativeLifetime, provenance, serverPids,
        environmentBinding, isolatedRepresentative, ...stimuli } = config;
      const record = { methodVersion: config.methodVersion, measurementPurpose, measurementKind: config.measurementKind,
        pairId: config.pairId, pairPhase: config.pairPhase, executionId: `${profile}-${phase}`,
        configSha256: hashObject(config), stimuliSha256: hashObject(stimuli), productSha256: hashObject(provenance),
        baselineSha256: provenance.baselineSha256, productionDescriptorSha256: hashObject(representative.measurement),
        configuration: config };
      const { configuration, ...binding } = record;
      return { ...binding, ...store(`/original/${profile}-${phase}-method.json`, record) };
    };
    const bindEnvironment = (config, phase) => {
      const { provenance, serverPids, environmentBinding, isolatedRepresentative, ...configurationEvidence } = config;
      const configuration = structuredClone(configurationEvidence);
      if (configuration.nativeLifetime.python) configuration.nativeLifetime.python = '$authenticated-python';
      const identity = { guest: { platform: 'linux', arch: 'arm64', browser: { version: '149.0.7827.0' } } };
      const record = { schemaVersion: 1, method: 'isolated-linux-representative-v1',
        invocation: { invocationId: `${profile}-${phase}` }, identity, configuration, configurationEvidence, provenance,
        identitySha256: hashObject(identity), configSha256: environmentConfigIdentity(config) };
      return { method: record.method, invocationId: record.invocation.invocationId,
        identitySha256: record.identitySha256, configSha256: record.configSha256,
        ...store(`/original/${profile}-${phase}-environment.json`, record) };
    };
    const methodBinding = bindMethod(configuration, 'production');
    const developmentMethodBinding = bindMethod(developmentConfiguration, 'development');
    const environmentBinding = bindEnvironment(configuration, 'production');
    const developmentEnvironmentBinding = bindEnvironment(developmentConfiguration, 'development');
    const environmentPairRelation = relations ? { phase: 'production', after: environmentBinding } : undefined;
    const developmentEnvironmentPairRelation = relations
      ? { phase: 'development', after: developmentEnvironmentBinding } : undefined;
    const sample = (item, phase = 'production') => {
      const { runId } = item;
      const identity = { ...item, provenance };
      const productionMetadata = { methodVersion: 'FA-V3', measurementPurpose: 'integrated',
        measurementKind: 'production', methodBinding, environmentBinding, isolatedRepresentative: true,
        environmentPairRelation };
      const developmentMetadata = { ...productionMetadata, measurementPurpose: 'timing',
        measurementKind: 'development', methodBinding: developmentMethodBinding,
        environmentBinding: developmentEnvironmentBinding, environmentPairRelation: developmentEnvironmentPairRelation };
      const sourceTraces = direct ? [] : [
        store(`/original/${runId}-${phase}-production.json`, { ...identity, ...productionMetadata,
          correctness: { pass: true, steps: [{ name: 'crud', pass: true }] }, qualityFailures: [],
          metrics: { shellArrivalMs: 800, errorRate: 0 } }).path,
        store(`/original/${runId}-${phase}-development.json`, { ...identity, ...developmentMetadata,
          correctness: { pass: true, steps: [{ name: 'dev-ready', pass: true }] }, qualityFailures: [],
          metrics: { devReadyMs: 900 } }).path,
      ];
      const metrics = { shellArrivalMs: 800, errorRate: 0, devReadyMs: 900 };
      const trace = store(`/original/${runId}-${phase}-combined.json`, { ...identity,
        ...(phase === 'development' ? developmentMetadata : productionMetadata),
        ...(direct ? { correctness: { pass: true, steps: [{ name: 'crud', pass: true }] } }
          : { ...productionMetadata, sourceTraces, sourceMethodBindings: [methodBinding, developmentMethodBinding],
            sourceEnvironmentBindings: [environmentBinding, developmentEnvironmentBinding],
            sourceEnvironmentPairRelations: [environmentPairRelation ?? null, developmentEnvironmentPairRelation ?? null],
            correctness: { production: 'pass', development: 'pass' } }),
        metrics }).path;
      return { ...identity, warmupRuns: configuration.warmupRuns,
        correctness: 'pass', qualityFailures: [], metrics, trace };
    };
    const plan = planMeasurements(configuration);
    return { profile, mode, methodVersion: 'FA-V3', measurementPurpose: 'integrated',
      isolatedRepresentative: true, provenance, methodBinding, environmentBinding, environmentPairRelation,
      runs: plan.filter((item) => !item.warmup).map((item) => sample(item)),
      warmups: plan.filter((item) => item.warmup).map((item) => sample(item)),
      ...(!direct || development ? {
        developmentMethodBinding, developmentEnvironmentBinding, developmentEnvironmentPairRelation,
        developmentWarmups: plan.filter((item) => item.warmup).map((item) => sample(item, 'development')),
      } : {}),
    };
  });
  return { value: { provenance, receipts }, rawFiles };
}

function replaceMeasurementRaw(rawFiles, path, value) {
  const bytes = Buffer.from(JSON.stringify(value));
  rawFiles.set(path, { bytes, sha256: digest(bytes) });
}

for (const direct of [true, false]) {
  test(`measurement frozen authentication: ${direct ? 'direct' : 'composite'} measured/warmup swap -> rejects unchanged raw promotion`, () => {
    const { value, rawFiles } = measurementFixture(direct, true, true);
    const receipt = value.receipts[0];
    const measured = receipt.runs.findIndex((run) => run.framework === receipt.warmups[0].framework);
    [receipt.runs[measured], receipt.warmups[0]] = [receipt.warmups[0], receipt.runs[measured]];

    assert.throws(() => validateMeasurementInventory(value, rawFiles), /Frozen measured inventory mismatch/u);
  });

  for (const inventory of ['runs', 'warmups', 'developmentWarmups']) {
    for (const defect of ['warmup', 'cycle', 'slot', 'order', 'warmupRuns']) {
      test(`measurement frozen authentication: ${direct ? 'direct' : 'composite'} ${inventory} ${defect} -> rejects original plan mismatch`, () => {
        const { value, rawFiles } = measurementFixture(direct, true, true);
        const samples = value.receipts[0][inventory];
        if (defect === 'order') [samples[0], samples[1]] = [samples[1], samples[0]];
        else samples[0][defect] = defect === 'warmup' ? !samples[0].warmup : 99;

        assert.throws(() => validateMeasurementInventory(value, rawFiles), /Frozen (measured|warmup|development warmup) inventory mismatch/u);
      });
    }

    for (const target of direct ? ['direct'] : ['composite', 'production', 'development']) {
      for (const field of ['warmup', 'cycle', 'slot', 'provenance',
        ...(target === 'composite' ? [] : ['device', 'url'])]) {
        for (const defect of ['missing', 'wrong']) {
          test(`measurement frozen authentication: ${inventory} ${target} ${defect} ${field} -> rejects rehashed original raw mismatch`, () => {
            const { value, rawFiles } = measurementFixture(direct, true, true);
            const run = value.receipts[0][inventory][0];
            const composite = JSON.parse(rawFiles.get(run.trace).bytes);
            const path = target === 'production' || target === 'development'
              ? composite.sourceTraces[target === 'production' ? 0 : 1] : run.trace;
            const raw = JSON.parse(rawFiles.get(path).bytes);
            if (defect === 'missing') delete raw[field];
            else raw[field] = field === 'provenance' ? { ...raw.provenance, commit: '0'.repeat(40) }
              : field === 'warmup' ? !raw.warmup : 99;
            replaceMeasurementRaw(rawFiles, path, raw);

            assert.throws(() => validateMeasurementInventory(value, rawFiles),
              field === 'provenance' ? /Original raw source provenance mismatch/u : /Frozen raw inventory mismatch/u);
          });
        }
      }
    }
  }

  for (const phase of ['production', 'development']) {
    for (const target of ['method', 'environment']) {
      for (const defect of ['missing-configuration', 'wrong-configuration', 'missing-provenance', 'wrong-provenance',
        ...(target === 'method' && phase === 'production' ? ['wrong-python'] : []),
        ...(target === 'environment' ? ['rebound-configuration'] : [])]) {
        test(`measurement frozen authentication: ${direct ? 'direct' : 'composite'} ${phase} ${target} ${defect} -> rejects rehashed artifact content`, () => {
          const { value, rawFiles } = measurementFixture(direct, true, true);
          const receipt = value.receipts[0];
          const binding = target === 'method'
            ? phase === 'production' ? receipt.methodBinding : receipt.developmentMethodBinding
            : phase === 'production' ? receipt.environmentBinding : receipt.developmentEnvironmentBinding;
          const raw = JSON.parse(rawFiles.get(binding.path).bytes);
          const config = target === 'method' ? raw.configuration : raw;
          if (defect === 'missing-configuration') delete raw.configuration;
          if (defect === 'wrong-configuration') raw.configuration.profile = 'tablet-native';
          if (defect === 'missing-provenance') delete config.provenance;
          if (defect === 'wrong-provenance') config.provenance.commit = '0'.repeat(40);
          if (defect === 'wrong-python') raw.configuration.nativeLifetime.python = '/original/other-python';
          if (defect === 'rebound-configuration') {
            raw.configuration.apps.next = 'http://127.0.0.1:39999/';
            raw.configurationEvidence.apps.next = raw.configuration.apps.next;
            raw.configSha256 = hashObject(raw.configuration);
            binding.configSha256 = raw.configSha256;
          }
          replaceMeasurementRaw(rawFiles, binding.path, raw);
          binding.sha256 = rawFiles.get(binding.path).sha256;
          for (const [path, entry] of rawFiles) {
            const trace = JSON.parse(entry.bytes);
            if (trace.methodBinding?.path === binding.path) trace.methodBinding = binding;
            if (trace.environmentBinding?.path === binding.path) trace.environmentBinding = binding;
            if (trace.environmentPairRelation?.after?.path === binding.path) trace.environmentPairRelation.after = binding;
            for (const relation of trace.sourceEnvironmentPairRelations ?? []) {
              if (relation?.after?.path === binding.path) relation.after = binding;
            }
            for (const bindings of [trace.sourceMethodBindings, trace.sourceEnvironmentBindings]) {
              if (bindings) bindings.forEach((entry, index) => { if (entry.path === binding.path) bindings[index] = binding; });
            }
            replaceMeasurementRaw(rawFiles, path, trace);
          }

          assert.throws(() => validateMeasurementInventory(value, rawFiles),
            target === 'method' ? /Original method configuration/u : /Original environment (configuration|provenance)/u);
        });
      }
    }
    for (const field of ['configSha256', 'stimuliSha256', 'baselineSha256', 'productionDescriptorSha256']) {
      test(`measurement frozen authentication: ${direct ? 'direct' : 'composite'} ${phase} rebound ${field} -> rejects original method header mismatch`, () => {
        const { value, rawFiles } = measurementFixture(direct, true, true);
        const binding = phase === 'production' ? value.receipts[0].methodBinding : value.receipts[0].developmentMethodBinding;
        binding[field] = '0'.repeat(64);
        for (const [path, entry] of rawFiles) {
          const trace = JSON.parse(entry.bytes);
          if (trace.methodBinding?.path === binding.path) trace.methodBinding = binding;
          for (const [index, sourceBinding] of (trace.sourceMethodBindings ?? []).entries()) {
            if (sourceBinding.path === binding.path) trace.sourceMethodBindings[index] = binding;
          }
          replaceMeasurementRaw(rawFiles, path, trace);
        }

        assert.throws(() => validateMeasurementInventory(value, rawFiles), /Original method configuration\/product identity mismatch/u);
      });
    }
  }
}

for (const inventory of ['runs', 'warmups', 'developmentWarmups']) {
  for (const field of ['methodVersion', 'measurementPurpose', 'measurementKind', 'methodBinding',
    'environmentBinding', 'isolatedRepresentative', 'environmentPairRelation']) {
    for (const defect of ['missing', 'wrong']) {
      test(`measurement direct phase binding: ${inventory} ${defect} ${field} -> rejects authenticated receipt mismatch`, () => {
        const { value, rawFiles } = measurementFixture(true, true, true);
        const run = value.receipts[0][inventory][0];
        const trace = JSON.parse(rawFiles.get(run.trace).bytes);
        if (defect === 'missing') delete trace[field];
        else trace[field] = field.endsWith('Binding') ? { ...trace[field], sha256: 'c'.repeat(64) } : 'wrong-phase';
        const bytes = Buffer.from(JSON.stringify(trace));
        rawFiles.set(run.trace, { bytes, sha256: digest(bytes) });

        assert.throws(() => validateMeasurementInventory(value, rawFiles), /Direct source phase binding mismatch/u);
      });
    }
  }

  for (const field of ['measurementPurpose', 'measurementKind', 'methodBinding', 'environmentBinding',
    'environmentPairRelation']) {
    test(`measurement direct phase binding: ${inventory} borrowed counterpart ${field} -> rejects wrong execution phase`, () => {
      const { value, rawFiles } = measurementFixture(true, true, true);
      const receipt = value.receipts[0];
      const run = receipt[inventory][0];
      const trace = JSON.parse(rawFiles.get(run.trace).bytes);
      const counterpart = inventory === 'developmentWarmups' ? receipt.runs[0] : receipt.developmentWarmups[0];
      trace[field] = JSON.parse(rawFiles.get(counterpart.trace).bytes)[field];
      const bytes = Buffer.from(JSON.stringify(trace));
      rawFiles.set(run.trace, { bytes, sha256: digest(bytes) });

      assert.throws(() => validateMeasurementInventory(value, rawFiles), /Direct source phase binding mismatch/u);
    });
  }
}

for (const direct of [true, false]) {
  test(`measurement phase binding: complete ${direct ? 'direct' : 'composite'} distinct environment relations -> accepted`, () => {
    const { value, rawFiles } = measurementFixture(direct, true, true);

    assert.doesNotThrow(() => validateMeasurementInventory(value, rawFiles));
  });

  for (const field of ['methodVersion', 'measurementPurpose', 'measurementKind', 'pairId', 'pairPhase',
    'productSha256', 'executionId']) {
    test(`measurement phase binding: ${direct ? 'direct' : 'composite'} development method wrong ${field} -> rejects internally matching raw binding`, () => {
      const { value, rawFiles } = measurementFixture(direct, true, true);
      const method = value.receipts[0].developmentMethodBinding;
      method[field] = field === 'executionId' ? value.receipts[0].methodBinding.executionId : 'wrong-phase';
      for (const [path, raw] of rawFiles) {
        const trace = JSON.parse(raw.bytes);
        if (trace.methodBinding?.path === method.path) trace.methodBinding = method;
        if (trace.sourceMethodBindings) trace.sourceMethodBindings[1] = method;
        const bytes = Buffer.from(JSON.stringify(trace));
        rawFiles.set(path, { bytes, sha256: digest(bytes) });
      }

      assert.throws(() => validateMeasurementInventory(value, rawFiles),
        direct ? /Direct source phase binding mismatch/u : /Composite source phase binding/u);
    });
  }
}

for (const inventory of ['warmups', 'developmentWarmups']) {
  for (const target of ['composite', 'production', 'development']) {
    for (const field of ['methodVersion', 'measurementPurpose', 'measurementKind', 'methodBinding',
      'environmentBinding', 'isolatedRepresentative', 'environmentPairRelation']) {
      for (const defect of ['missing', 'wrong']) {
        test(`measurement composite phase binding: ${inventory} ${target} ${defect} ${field} -> rejects phase mismatch`, () => {
          const { value, rawFiles } = measurementFixture(false, true, true);
          const run = value.receipts[0][inventory][0];
          const composite = JSON.parse(rawFiles.get(run.trace).bytes);
          const path = target === 'composite' ? run.trace : composite.sourceTraces[target === 'production' ? 0 : 1];
          const trace = JSON.parse(rawFiles.get(path).bytes);
          if (defect === 'missing') delete trace[field];
          else trace[field] = field.endsWith('Binding') ? { ...trace[field], sha256: 'c'.repeat(64) } : 'wrong-phase';
          const bytes = Buffer.from(JSON.stringify(trace));
          rawFiles.set(path, { bytes, sha256: digest(bytes) });

          assert.throws(() => validateMeasurementInventory(value, rawFiles), /Composite source phase binding/u);
        });
      }
    }
  }
}

for (const defect of ['missing-production', 'missing-development', 'empty', 'extra', 'non-array']) {
  test(`measurement phase inventory: ${defect} composite -> rejects even with matching remaining metrics`, () => {
    const { value, rawFiles } = measurementFixture(false, true);
    const run = value.receipts[0].runs.find((sample) => sample.framework === 'next');
    const trace = JSON.parse(rawFiles.get(run.trace).bytes);
    if (defect.startsWith('missing-')) {
      trace.sourceTraces.splice(defect === 'missing-production' ? 0 : 1, 1);
      run.metrics = JSON.parse(rawFiles.get(trace.sourceTraces[0]).bytes).metrics;
    }
    if (defect === 'empty') trace.sourceTraces = [];
    if (defect === 'extra') trace.sourceTraces.push('/original/extra.json');
    if (defect === 'non-array') trace.sourceTraces = {};
    const bytes = Buffer.from(JSON.stringify(trace));
    rawFiles.set(run.trace, { bytes, sha256: digest(bytes) });

    assert.throws(() => validateMeasurementInventory(value, rawFiles), /Composite source phase inventory/u);
  });
}

for (const target of ['composite', 'production', 'development']) {
  for (const field of ['methodVersion', 'measurementPurpose', 'measurementKind', 'methodBinding',
    'environmentBinding', 'isolatedRepresentative', 'environmentPairRelation']) {
    for (const defect of ['missing', 'wrong']) {
      test(`measurement phase binding: ${target} ${defect} ${field} -> rejects authoritative phase mismatch`, () => {
        const { value, rawFiles } = measurementFixture(false, true);
        const receipt = value.receipts[0];
        const run = receipt.runs[0];
        const composite = JSON.parse(rawFiles.get(run.trace).bytes);
        const path = target === 'composite' ? run.trace : composite.sourceTraces[target === 'production' ? 0 : 1];
        const trace = JSON.parse(rawFiles.get(path).bytes);
        if (field === 'environmentPairRelation') {
          receipt.environmentPairRelation = { path: '/original/pair.json', sha256: 'b'.repeat(64) };
          receipt.developmentEnvironmentPairRelation = receipt.environmentPairRelation;
          composite.environmentPairRelation = receipt.environmentPairRelation;
          composite.sourceEnvironmentPairRelations = [receipt.environmentPairRelation, receipt.environmentPairRelation];
          for (const sourcePath of composite.sourceTraces) {
            const source = JSON.parse(rawFiles.get(sourcePath).bytes);
            source.environmentPairRelation = receipt.environmentPairRelation;
            const bytes = Buffer.from(JSON.stringify(source));
            rawFiles.set(sourcePath, { bytes, sha256: digest(bytes) });
          }
          trace.environmentPairRelation = receipt.environmentPairRelation;
          const bytes = Buffer.from(JSON.stringify(composite));
          rawFiles.set(run.trace, { bytes, sha256: digest(bytes) });
        }
        if (defect === 'missing') delete trace[field];
        else trace[field] = field.endsWith('Binding') ? { ...trace[field], sha256: 'c'.repeat(64) } : 'wrong-phase';
        const bytes = Buffer.from(JSON.stringify(trace));
        rawFiles.set(path, { bytes, sha256: digest(bytes) });

        assert.throws(() => validateMeasurementInventory(value, rawFiles), /Composite source phase binding/u);
      });
    }
  }
}

for (const field of ['sourceMethodBindings', 'sourceEnvironmentBindings', 'sourceEnvironmentPairRelations']) {
  for (const defect of ['missing', 'incomplete', 'extra', 'swapped']) {
    test(`measurement phase binding: ${defect} ${field} -> rejects incomplete phase authentication`, () => {
      const { value, rawFiles } = measurementFixture(false, true);
      const run = value.receipts[0].runs[0];
      const trace = JSON.parse(rawFiles.get(run.trace).bytes);
      if (field === 'sourceEnvironmentPairRelations') trace[field] = [{ phase: 'production' }, { phase: 'development' }];
      if (defect === 'missing') delete trace[field];
      if (defect === 'incomplete') trace[field].pop();
      if (defect === 'extra') trace[field].push(trace[field][0]);
      if (defect === 'swapped') trace[field].reverse();
      const bytes = Buffer.from(JSON.stringify(trace));
      rawFiles.set(run.trace, { bytes, sha256: digest(bytes) });

      assert.throws(() => validateMeasurementInventory(value, rawFiles), /Composite source phase binding/u);
    });
  }
}

test('measurement inventory: complete original four-profile composite sources -> remains usable with nonblocking numeric verdicts', () => {
  const { value, rawFiles } = measurementFixture();

  assert.doesNotThrow(() => validateMeasurementInventory(value, rawFiles));
  for (const verdict of ['fail', 'inconclusive']) {
    assert.equal(validateMeasurementDiagnostics({ ...value, methodVersion: 'FA-V3', verdict,
      checks: [{ metric: 'shellArrivalMs', reason: 'absolute-budget', verdict, range: [800, 900] }],
    }).originalVerdict, verdict);
  }
});

test('measurement inventory: complete direct object correctness -> remains usable', () => {
  const { value, rawFiles } = measurementFixture(true);

  assert.doesNotThrow(() => validateMeasurementInventory(value, rawFiles));
});

for (const direct of [true, false]) {
  for (const inventory of ['runs', 'warmups', 'developmentWarmups']) {
    for (const defect of ['sample', 'identity', 'trace']) {
      test(`measurement uniqueness: ${direct ? 'direct' : 'composite'} ${inventory} reused ${defect} -> rejects independent repetition substitution`, () => {
        const { value, rawFiles } = measurementFixture(direct, true);
        const runs = value.receipts[0][inventory];
        const first = runs[0];
        const secondIndex = runs.findIndex((run, index) => index > 0 && run.framework === first.framework);
        const second = runs[secondIndex];
        if (defect === 'sample') runs[secondIndex] = structuredClone(first);
        if (defect === 'identity') second.runId = first.runId;
        if (defect === 'trace') second.trace = first.trace;

        assert.throws(() => validateMeasurementInventory(value, rawFiles),
          defect === 'trace' ? /Reused measurement trace locator/u : /Duplicate measurement sample identity/u);
      });
    }
  }

  test(`measurement uniqueness: ${direct ? 'direct' : 'composite'} distinct paired warmup executions -> accepts shared logical IDs`, () => {
    const { value, rawFiles } = measurementFixture(direct, true);

    assert.doesNotThrow(() => validateMeasurementInventory(value, rawFiles));
  });

  for (const target of ['runs', 'developmentWarmups']) {
    test(`measurement uniqueness: ${direct ? 'direct' : 'composite'} warmup trace reused in ${target} -> rejects missing execution phase`, () => {
      const { value, rawFiles } = measurementFixture(direct, true);
      value.receipts[0][target][0].trace = value.receipts[0].warmups[0].trace;

      assert.throws(() => validateMeasurementInventory(value, rawFiles), /Reused measurement trace locator/u);
    });
  }
}

for (const inventory of ['runs', 'warmups']) {
  test(`measurement uniqueness: composite ${inventory} repeated source locator -> rejects missing source execution`, () => {
    const { value, rawFiles } = measurementFixture();
    const run = value.receipts[0][inventory][0];
    const trace = JSON.parse(rawFiles.get(run.trace).bytes);
    trace.sourceTraces[1] = trace.sourceTraces[0];
    const bytes = Buffer.from(JSON.stringify(trace));
    rawFiles.set(run.trace, { bytes, sha256: digest(bytes) });

    assert.throws(() => validateMeasurementInventory(value, rawFiles), /Reused measurement trace locator/u);
  });
}

for (const inventory of ['runs', 'warmups']) {
  for (const field of ['profile', 'mode', 'framework', 'runId']) {
    for (const defect of ['missing', 'mismatched']) {
      test(`measurement direct identity: ${inventory} ${defect} ${field} -> rejects valid metrics and correctness`, () => {
        const { value, rawFiles } = measurementFixture(true);
        const run = value.receipts[0][inventory][0];
        const trace = JSON.parse(rawFiles.get(run.trace).bytes);
        if (defect === 'missing') delete trace[field];
        else trace[field] = 'other-identity';
        const bytes = Buffer.from(JSON.stringify(trace));
        rawFiles.set(run.trace, { bytes, sha256: digest(bytes) });

        assert.throws(() => validateMeasurementInventory(value, rawFiles), /Raw sample identity mismatch/u);
      });
    }
  }
  for (const field of ['framework', 'runId']) {
    test(`measurement direct identity: ${inventory} absent profile and wrong ${field} -> cannot bypass identity`, () => {
      const { value, rawFiles } = measurementFixture(true);
      const run = value.receipts[0][inventory][0];
      const trace = JSON.parse(rawFiles.get(run.trace).bytes);
      delete trace.profile;
      trace[field] = 'other-identity';
      const bytes = Buffer.from(JSON.stringify(trace));
      rawFiles.set(run.trace, { bytes, sha256: digest(bytes) });

      assert.throws(() => validateMeasurementInventory(value, rawFiles), /Raw sample identity mismatch/u);
    });
  }
}

for (const inventory of ['runs', 'warmups']) {
  for (const defect of ['object-fail', 'step-fail']) {
    test(`measurement direct: ${inventory} ${defect} -> raw failure cannot hide behind receipt success`, () => {
      const { value, rawFiles } = measurementFixture(true);
      const run = value.receipts[0][inventory][0];
      const trace = JSON.parse(rawFiles.get(run.trace).bytes);
      if (defect === 'object-fail') trace.correctness.pass = false;
      else trace.correctness.steps[0].pass = false;
      const bytes = Buffer.from(JSON.stringify(trace));
      rawFiles.set(run.trace, { bytes, sha256: digest(bytes) });

      assert.throws(() => validateMeasurementInventory(value, rawFiles), /source trace.*correctness/u);
    });
  }
}

for (const inventory of ['runs', 'warmups']) {
  for (const phase of ['production', 'development']) {
    for (const verdict of ['fail', 'inconclusive', 'missing']) {
      test(`measurement composite: ${inventory} ${phase} ${verdict} -> valid sources cannot hide summary failure`, () => {
        const { value, rawFiles } = measurementFixture();
        const run = value.receipts[0][inventory][0];
        const trace = JSON.parse(rawFiles.get(run.trace).bytes);
        if (verdict === 'missing') delete trace.correctness[phase];
        else trace.correctness[phase] = verdict;
        const bytes = Buffer.from(JSON.stringify(trace));
        rawFiles.set(run.trace, { bytes, sha256: digest(bytes) });

        assert.throws(() => validateMeasurementInventory(value, rawFiles), /composite.*correctness/u);
      });
    }
  }
}

for (const sourceIndex of [0, 1]) {
  for (const defect of ['correctness-fail', 'correctness-inconclusive', 'object-fail', 'step-fail',
    'quality-fail', 'profile', 'mode', 'framework', 'runId', 'missing-identity', 'metrics']) {
    test(`measurement source: source ${sourceIndex} ${defect} -> composite success cannot hide original failure`, () => {
      const { value, rawFiles } = measurementFixture();
      const run = value.receipts[0].runs[0];
      const composite = JSON.parse(rawFiles.get(run.trace).bytes);
      const path = composite.sourceTraces[sourceIndex];
      const source = JSON.parse(rawFiles.get(path).bytes);
      if (defect === 'correctness-fail') source.correctness = 'fail';
      if (defect === 'correctness-inconclusive') source.correctness = 'inconclusive';
      if (defect === 'object-fail') source.correctness.pass = false;
      if (defect === 'step-fail') source.correctness.steps[0].pass = false;
      if (defect === 'quality-fail') source.qualityFailures.push('fixture source collection failure');
      if (['profile', 'mode', 'framework', 'runId'].includes(defect)) source[defect] = 'other-identity';
      if (defect === 'missing-identity') delete source.profile;
      if (defect === 'metrics') source.metrics = { ...source.metrics, shellArrivalMs: 801 };
      const bytes = Buffer.from(JSON.stringify(source));
      rawFiles.set(path, { bytes, sha256: digest(bytes) });

      assert.throws(() => validateMeasurementInventory(value, rawFiles), /source trace|metrics/u);
    });
  }
}

for (const engine of ['firefox', 'webkit']) {
  test(`soak inventory: parsed one-hour ${engine} receipt -> rejects without changing three-engine correctness`, async (t) => {
    const value = traceFixture(t);
    value.receipt.engine = engine;
    value.events[0].detail.engine = engine;
    const soak = await reliabilityRun(value.root, value.save(), head);
    const correctness = ['chromium', 'firefox', 'webkit'].map((engine) => ({ engine, kind: 'correctness' }));

    assert.throws(() => validateReliabilityInventory(correctness, soak), /Chromium/u);
  });
}
