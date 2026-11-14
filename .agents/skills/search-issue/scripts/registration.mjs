import { spawnSync } from 'node:child_process';

import { assertLedger, assertTriage, registrationMarker } from './ledger-contract.mjs';

const gh = (args, options = {}) => {
  const result = spawnSync('gh', args, { encoding: 'utf8', timeout: 30000, ...options });
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
    // including closed issues, retaining only matches. Ten issues per response
    // bound memory to 8 MiB; each request has its own two-minute deadline, rather
    // than imposing a deadline on downloading the repository's entire history.
    const matches = [];
    let page = 1;
    while (true) {
      const response = gh(['api', '--include',
        `repos/${repository}/issues?state=all&sort=created&direction=asc&per_page=10&page=${page}`],
      { maxBuffer: 8 * 1024 * 1024, timeout: 120000 });
      const boundary = response.search(/\r?\n\r?\n/u);
      if (boundary === -1) throw new TypeError('Missing issue lookup response headers.');
      const headers = response.slice(0, boundary).split(/\r?\n/u);
      if (!/^HTTP\/[\d.]+\s+200(?:\s|$)/u.test(headers[0])) {
        throw new TypeError('Unsuccessful issue lookup response.');
      }
      const candidates = JSON.parse(response.slice(boundary).trim());
      if (!Array.isArray(candidates) || candidates.length > 10 ||
          candidates.some((candidate) => !candidate ||
            !Number.isSafeInteger(candidate.number) || candidate.number <= 0 ||
            typeof candidate.html_url !== 'string' ||
            (candidate.body !== null && typeof candidate.body !== 'string'))) {
        throw new TypeError('Malformed issue lookup page.');
      }
      for (const candidate of candidates) {
        if (candidate.body?.split('\n').includes(marker)) {
          matches.push({ number: candidate.number, url: candidate.html_url });
          if (matches.length > 1) throw new TypeError('Ambiguous registration lookup.');
        }
      }
      const linkHeaders = headers.filter((header) => /^link:/iu.test(header));
      if (linkHeaders.length > 1) throw new TypeError('Ambiguous issue pagination headers.');
      let nextPage = null;
      if (linkHeaders.length) {
        for (const link of linkHeaders[0].slice(5).trim().split(/,\s*/u)) {
          const relation = /^<([^>]+)>;\s*rel="(next|prev|first|last)"$/u.exec(link);
          if (relation === null) throw new TypeError('Malformed issue pagination link.');
          const target = new URL(relation[1]);
          if (target.origin !== 'https://api.github.com') throw new TypeError('Invalid issue pagination origin.');
          if (relation[2] === 'next') {
            const number = Number(target.searchParams.get('page'));
            if (nextPage !== null || !Number.isSafeInteger(number) || number !== page + 1 ||
                target.searchParams.get('per_page') !== '10') {
              throw new TypeError('Invalid next issue page.');
            }
            nextPage = number;
          }
        }
      }
      if (nextPage === null) return matches;
      if (candidates.length === 0) throw new TypeError('Truncated issue pagination.');
      page = nextPage;
    }
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
