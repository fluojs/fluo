import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { browserReport, consumeProduct, externalEvidence, productDomainPlan, reliabilityRun, requiredRows, validateMeasurementDiagnostics,
  validateMeasurementInventory, validateReliabilityInventory } from './react-product-acceptance.mjs';
import { buildReviewFact } from '../../.agents/skills/review-head/scripts/contracts.mjs';
import { localCheckBinding } from '../../.agents/skills/execute-lane/scripts/lane-v4.mjs';

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
    ciDomains: ['tooling', 'starters'].map((domain) => save(`${domain}.json`, {
      head, source: { head, clean: true }, status: 'domain-evidence-complete', domain,
      checks: [{ id: 'fixture-command' }], artifacts: [value.receipt.checks[0].log],
    })),
  };
  value.receipt.rows.forEach((row) => { row.verdict = 'passed'; });
  return { ...value, remote, save };
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

function measurementFixture(direct = false, development = false) {
  const rawFiles = new Map();
  const store = (path, value) => {
    const bytes = Buffer.from(JSON.stringify(value));
    rawFiles.set(path, { bytes, sha256: digest(bytes) });
    return { path, sha256: digest(bytes) };
  };
  const methodBinding = store('/original/method.json', { methodVersion: 'FA-V3' });
  const environmentBinding = store('/original/environment.json', { isolated: true });
  const receipts = ['desktop-native', 'desktop-matched-cache', 'tablet-native', 'tablet-matched-cache'].map((profile) => {
    const mode = profile.endsWith('matched-cache') ? 'matched-cache' : 'native';
    const sample = (framework, index, warmup, phase = 'production') => {
      const runId = `${profile}-${framework}-${warmup ? 'warmup' : 'measured'}-${index}`;
      const identity = { profile, mode, framework, runId };
      const sourceTraces = direct ? [] : [
        store(`/original/${runId}-${phase}-production.json`, { ...identity,
          correctness: { pass: true, steps: [{ name: 'crud', pass: true }] }, qualityFailures: [],
          metrics: { shellArrivalMs: 800, errorRate: 0 } }).path,
        store(`/original/${runId}-${phase}-development.json`, { ...identity,
          correctness: { pass: true, steps: [{ name: 'dev-ready', pass: true }] }, qualityFailures: [],
          metrics: { devReadyMs: 900 } }).path,
      ];
      const metrics = { shellArrivalMs: 800, errorRate: 0, devReadyMs: 900 };
      const trace = store(`/original/${runId}-${phase}-combined.json`, { ...identity,
        ...(direct ? { correctness: { pass: true, steps: [{ name: 'crud', pass: true }] } }
          : { sourceTraces, correctness: { production: 'pass', development: 'pass' } }),
        metrics }).path;
      return { ...identity, correctness: 'pass', qualityFailures: [], metrics, trace };
    };
    const frameworks = ['fluo', 'next', 'react-router', 'tanstack-start'];
    return { profile, mode, methodVersion: 'FA-V3', measurementPurpose: 'integrated',
      isolatedRepresentative: true, provenance: { commit: head }, methodBinding, environmentBinding,
      runs: frameworks.flatMap((framework) => Array.from({ length: 5 }, (_, index) => sample(framework, index, false))),
      warmups: frameworks.flatMap((framework) => Array.from({ length: 2 }, (_, index) => sample(framework, index, true))),
      ...(development ? {
        developmentMethodBinding: methodBinding, developmentEnvironmentBinding: environmentBinding,
        developmentWarmups: frameworks.flatMap((framework) => Array.from({ length: 2 },
          (_, index) => sample(framework, index, true, 'development'))),
      } : {}),
    };
  });
  return { value: { provenance: { commit: head }, receipts }, rawFiles };
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
        const second = runs[1];
        if (defect === 'sample') runs[1] = structuredClone(first);
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
