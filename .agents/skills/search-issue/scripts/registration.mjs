import { spawnSync } from 'node:child_process';

import { assertLedger, assertTriage, registrationMarker } from './ledger-contract.mjs';

const gh = (args) => {
  const result = spawnSync('gh', args, { encoding: 'utf8', timeout: 30000 });
  if (result.error || result.status !== 0) {
    throw new TypeError(`gh ${args.slice(0, 2).join(' ')} failed: ${result.error?.message ?? result.stderr}`);
  }
  return result.stdout.trim();
};

export const githubTransport = ({ repository, intake }) => ({
  labels: () => {
    const labels = JSON.parse(gh(['label', 'list', '--repo', repository, '--limit', '1000', '--json', 'name']));
    if (!Array.isArray(labels) || labels.length >= 1000 ||
        labels.some((label) => typeof label?.name !== 'string')) throw new TypeError('Invalid label lookup.');
    return labels.map((label) => label.name);
  },
  lookup: (marker) => {
    // Search indexing can lag behind a successful create. Read every REST page
    // instead, including closed issues, before concluding that no marker exists.
    const pages = JSON.parse(gh(['api', '--paginate', '--slurp',
      `repos/${repository}/issues?state=all&per_page=100`]));
    if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page))) {
      throw new TypeError('Invalid or truncated issue lookup.');
    }
    const candidates = pages.flat();
    if (candidates.some((candidate) => !candidate ||
        !Number.isSafeInteger(candidate.number) || typeof candidate.html_url !== 'string' ||
        (candidate.body !== null && typeof candidate.body !== 'string'))) {
      throw new TypeError('Malformed issue lookup.');
    }
    return candidates.filter((candidate) => candidate.body?.split('\n').includes(marker))
      .map((candidate) => ({ number: candidate.number, url: candidate.html_url }));
  },
  create: ({ draft, decision, marker }) => {
    const body = [
      `Packages: ${draft.packages.join(', ')}`,
      `Audit purposes: ${intake.purposes.join(', ')}`,
      `Registration rationale: ${decision.reason}`,
      'Audit findings:', JSON.stringify(draft.findings, null, 2),
      'R&D briefs:', JSON.stringify(draft.rd_briefs, null, 2), marker,
    ].join('\n');
    const url = gh(['issue', 'create', '--repo', repository, '--title', draft.title, '--body', body,
      ...decision.labels.flatMap((label) => ['--label', label])]);
    const number = Number(url.split('/').at(-1));
    return { number, url };
  },
});

// Persist each receipt before attempting the next draft. A crash between remote
// creation and this write is recovered through the durable marker in the body.
export const registerLedger = ({ domain, ledger, transport, save = () => {} }) => {
  assertLedger(ledger);
  const triaged = assertTriage(ledger, domain);
  const canRegister = ledger.authority.explicit_harness_invocation &&
    !ledger.authority.investigation_only;
  let current = ledger;
  let labels;
  const ghCalls = [];
  for (const { decision, draft } of triaged) {
    if (current.registration_results.some((receipt) => receipt.draft_id === draft.draft_id)) continue;
    let receipt = { draft_id: draft.draft_id, decision: decision.decision,
      issue_number: null, issue_url: null, marker: null };
    if (decision.decision === 'register' && canRegister) {
      labels ??= transport.labels();
      if (decision.labels.some((label) => !labels.includes(label))) {
        throw new TypeError(`Required GitHub labels unavailable for ${draft.draft_id}.`);
      }
      const marker = registrationMarker(current, draft);
      const matches = transport.lookup(marker);
      if (matches.length > 1) throw new TypeError(`Ambiguous registration lookup for ${draft.draft_id}.`);
      const issue = matches[0] ?? transport.create({ draft, decision, marker });
      if (!Number.isSafeInteger(issue.number) || issue.number <= 0 ||
          issue.url !== `https://github.com/${ledger.repository}/issues/${issue.number}`) {
        throw new TypeError(`Malformed creation receipt for ${draft.draft_id}.`);
      }
      receipt = { ...receipt, issue_number: issue.number, issue_url: issue.url, marker };
      if (matches.length === 0) ghCalls.push({ draft_id: draft.draft_id, issue_number: issue.number });
    }
    current = assertLedger({
      ...current, status: 'registering', blocked_reason: null,
      registration_results: [...current.registration_results, receipt],
    });
    save(current);
  }
  return { ledger: current, ghCalls };
};

export const applyTriage = ({ domain, ledger, scenario }) =>
  registerLedger({
    domain, ledger,
    transport: {
      labels: () => domain.labels, lookup: () => [],
      create: ({ draft }) => {
        const number = scenario.fake_issue_numbers?.[draft.draft_id];
        return { number, url: `https://github.com/${ledger.repository}/issues/${number}` };
      },
    },
  });

export const registerAndPublish = async ({ domain, ledger, outputDirectory, scenario }) => {
  const registered = applyTriage({ domain, ledger, scenario });
  const { publishRun } = await import('./publication.mjs');
  return publishRun({ ...registered, outputDirectory, runId: ledger.run_id });
};
