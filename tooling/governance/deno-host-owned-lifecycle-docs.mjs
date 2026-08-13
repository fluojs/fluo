const governedDocuments = [
  ['packages/platform-deno/README.md', 'en'],
  ['packages/platform-deno/README.ko.md', 'ko'],
  ['docs/reference/package-surface.md', 'en'],
  ['docs/reference/package-surface.ko.md', 'ko'],
  ['docs/getting-started/migrate-from-nestjs.md', 'en'],
  ['docs/getting-started/migrate-from-nestjs.ko.md', 'ko'],
  ['docs/CONTEXT.md', 'en'],
  ['docs/CONTEXT.ko.md', 'ko'],
  ['book/intermediate/ch23-deno.md', 'en'],
  ['book/intermediate/ch23-deno.ko.md', 'ko'],
  ['apps/docs/content/docs/guides/runtime-adapters.mdx', 'en'],
  ['apps/docs/content/docs/guides/runtime-adapters.ko.mdx', 'ko'],
];
const migrationDocuments = [
  ['docs/getting-started/migrate-from-nestjs.md', 'en'],
  ['docs/getting-started/migrate-from-nestjs.ko.md', 'ko'],
];
const contextDocuments = [
  ['docs/CONTEXT.md', 'docs/getting-started/migrate-from-nestjs.md'],
  ['docs/CONTEXT.ko.md', 'docs/getting-started/migrate-from-nestjs.ko.md'],
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Deno host-owned lifecycle contract check failed: ${message}`);
  }
}

function sentences(content) {
  return content
    .split(/(?<=[.!?;。！？；])\s+|\n+/u)
    .map((sentence) => sentence.replace(/\s+/gu, ' ').trim())
    .filter(Boolean);
}

function localePatterns(locale) {
  return locale === 'en'
    ? {
        handlerReference: /^\s*(?:it|the handler|this handler|the function|this function)\b/iu,
        handlerSubject: /\b(?:it|the handler|this handler|the function|this function)\b/iu,
        hostSubject: /\b(?:(?:surrounding|external|caller-owned|application-owned)\s+hosts?|hosts?\b(?!-owned))/iu,
        negative: /\b(?:cannot|does not|do not|never|no|not|without)\b/iu,
        connector: /(?:,\s*|\s+)(?:and|but|however|yet|while|whereas)\s+/iu,
        seams: [
          ['server startup', /\b(?:starts?|opens?|runs?|owns?)\b[^.!?;]*(?:server|Deno\.serve)/iu],
          ['signal handlers', /\b(?:installs?|registers?|wires?|handles?|owns?)\b[^.!?;]*signals?\b/iu],
          ['shutdown', /\b(?:owns?|performs?|coordinates?|handles?|manages?)\b[^.!?;]*shutdown\b/iu],
          ['websocket upgrades', /\b(?:automatically\s+)?(?:performs?|handles?|owns?|upgrades?)\b[^.!?;]*websocket/iu],
        ],
      }
    : {
        handlerReference: /^\s*(?:이|해당)\s*(?:handler|함수|경로)(?:가|는|은|이)?/u,
        handlerSubject: /(?:이|해당)\s*(?:handler|함수|경로)|(?:handler|함수|경로)(?:가|는|은|이)/u,
        hostSubject: /(?:주변|외부|caller-owned|application-owned)?\s*host\b(?!-owned)/u,
        negative: /(?:않|없|아니|못|불가|지원하지|수행하지|시작하지|설치하지|소유하지)/u,
        connector: /(?:지만|않으며|않고|않으면서|반면|그러나|하지만)\s*/u,
        seams: [
          ['server startup', /(?:server|Deno\.serve)[^.!?;。！？；]*(?:시작|실행|소유)|(?:시작|실행|소유)[^.!?;。！？；]*(?:server|Deno\.serve)/u],
          ['signal handlers', /(?:signal|시그널)[^.!?;。！？；]*(?:설치|등록|연결|처리|소유)|(?:설치|등록|연결|처리|소유)[^.!?;。！？；]*(?:signal|시그널)/u],
          ['shutdown', /shutdown[^.!?;。！？；]*(?:소유|수행|조율|처리|관리)|(?:소유|수행|조율|처리|관리)[^.!?;。！？；]*shutdown/u],
          ['websocket upgrades', /websocket[^.!?;。！？；]*(?:자동|upgrade|업그레이드|소유|처리|수행)|(?:자동|upgrade|업그레이드|소유|처리|수행)[^.!?;。！？；]*websocket/u],
        ],
      };
}

function contradictionMessage(content, locale) {
  const patterns = localePatterns(locale);
  let handlerAntecedent = false;
  for (const sentence of sentences(content)) {
    const handlerStart = sentence.indexOf('createDenoFetchHandler(...)');
    const continuesHandler = handlerAntecedent && patterns.handlerReference.test(sentence);
    if (handlerStart === -1 && !continuesHandler) {
      handlerAntecedent = false;
      continue;
    }
    const scopedSentence = handlerStart === -1 ? sentence : sentence.slice(handlerStart);
    const propositions = scopedSentence.split(patterns.connector);
    let owner = 'handler';
    for (const proposition of propositions) {
      if (patterns.handlerSubject.test(proposition)) owner = 'handler';
      if (patterns.hostSubject.test(proposition)) owner = 'host';
      if (patterns.negative.test(proposition) || owner === 'host') continue;
      for (const [seam, pattern] of patterns.seams) {
        if (pattern.test(proposition)) return `must not claim that createDenoFetchHandler(...) owns ${seam}.`;
      }
    }
    handlerAntecedent = handlerStart !== -1;
  }
  return undefined;
}

function hasPositiveSignalAction(content, locale) {
  const signalActionPattern = locale === 'en'
    ? /(?:install|register|wire|remove|own|handle)[^.!?;]*(?:shutdown\s+)?signals?/iu
    : /(?:signal|시그널)[^.!?;。！？；]*(?:설치|등록|연결|제거|소유|처리)|(?:설치|등록|연결|제거|소유|처리)[^.!?;。！？；]*(?:signal|시그널)/u;
  const negativePattern = locale === 'en'
    ? /\b(?:cannot|does not|do not|never|no|not|without)\b/iu
    : /(?:않|없|아니|못|불가|지원하지|설치하지|등록하지|소유하지)/u;
  return signalActionPattern.test(content) && !negativePattern.test(content);
}

function appListenSignalOwnershipMessage(content, locale) {
  const ownershipConnector = locale === 'en'
    ? /,?\s+(?:or|whereas|while)\s+/iu
    : /(?:사용하고,?\s*|또는\s+|반면\s+)/u;
  return sentences(content).some((sentence) => sentence
    .split(ownershipConnector)
    .some((proposition) => proposition.includes('app.listen()') && hasPositiveSignalAction(proposition, locale)))
    ? 'app.listen() must not own shutdown signal registration.'
    : undefined;
}

function enforceManagedMigrationGuidance(relativePath, content, locale) {
  const migrationSentences = sentences(content).filter((sentence) =>
    sentence.includes('runDenoApplication(...)') || sentence.includes('app.listen()'));
  const appListenGuidance = migrationSentences.filter((sentence) => sentence.includes('app.listen()')).join(' ');
  const runGuidance = migrationSentences.filter((sentence) => sentence.includes('runDenoApplication(...)')).join(' ');
  const startupPattern = /server|Deno\.serve/iu;
  const closePattern = locale === 'en' ? /shutdown|close|drain/iu : /shutdown|close|drain|종료/u;
  const websocketPattern = /websocket/iu;
  assert(
    appListenGuidance.length > 0 && startupPattern.test(appListenGuidance) && closePattern.test(appListenGuidance) && websocketPattern.test(appListenGuidance),
    `${relativePath} must attribute managed server startup, adapter close/drain, and configured websocket upgrades to app.listen().`,
  );
  assert(
    !sentences(appListenGuidance).some((sentence) => hasPositiveSignalAction(sentence, locale)),
    `${relativePath} app.listen() must not own shutdown signal registration.`,
  );
  assert(
    runGuidance.length > 0 && sentences(runGuidance).some((sentence) => hasPositiveSignalAction(sentence, locale)),
    `${relativePath} must attribute shutdown signal registration to runDenoApplication(...).`,
  );
}

function enforceMigrationGuidance(readText) {
  for (const [relativePath, locale] of migrationDocuments) {
    const content = readText(relativePath);
    const handlerGuidance = content.split('\n').filter((line) => line.includes('createDenoFetchHandler(...)')).join(' ');
    enforceManagedMigrationGuidance(relativePath, content, locale);
    assert(
      handlerGuidance.length > 0 && (locale === 'en' ? /does not|never/iu : /않|없|아니/u).test(handlerGuidance),
      `${relativePath} must state that createDenoFetchHandler(...) does not own the host lifecycle.`,
    );
    assert(
      [/server|Deno\.serve/iu, /shutdown/iu, /signal/iu, /websocket/iu].every((pattern) => pattern.test(handlerGuidance)),
      `${relativePath} must leave startup, shutdown, signals, and websocket upgrades to the surrounding host.`,
    );
  }
  for (const [relativePath, migrationPath] of contextDocuments) {
    const denoContext = readText(relativePath).split('\n').filter((line) => line.includes('createDenoFetchHandler(...)')).join(' ');
    assert(denoContext.includes(migrationPath), `${relativePath} must link the Deno lifecycle contract to ${migrationPath}.`);
  }
}

export function enforceDenoHostOwnedLifecycleDocs(readText) {
  for (const [relativePath, locale] of governedDocuments) {
    const content = readText(relativePath);
    const contradiction = contradictionMessage(content, locale);
    assert(!contradiction, `${relativePath} ${contradiction ?? ''}`);
    const appListenContradiction = appListenSignalOwnershipMessage(content, locale);
    assert(!appListenContradiction, `${relativePath} ${appListenContradiction ?? ''}`);
  }
  enforceMigrationGuidance(readText);
}
