const governedCapabilities = [
  {
    id: 'full-nestjs-compatibility',
    positive: /(?:provide(?!r)|offer|support|deliver|enable|include)\w*[^\n;]*full\s+NestJS\s+Passport\s+compatibility|full\s+NestJS\s+Passport\s+compatibility[^\n;]*(?:available|provided|supported)|full\s+NestJS\s+Passport\s+compatibility[^\n;]*(?:제공|지원|가능|호환)|(?:제공|지원|호환)[^\n;]*full\s+NestJS\s+Passport\s+compatibility/iu,
    target: /full\s+NestJS\s+Passport\s+compatibility/iu,
  },
  {
    abbreviated: /\bcan\b[^\n;]*(?:enabled|install|mount|register)|(?:설치|마운트|등록|활성화)[^\n;]*수\s+있/iu,
    id: 'middleware-installation',
    positive: /(?:install|mount|register|provide(?!r)|support|manage|own)\w*[^\n;]*(?:(?:Passport(?:\.js)?\s+)?middleware|미들웨어)|(?:(?:Passport(?:\.js)?\s+)?middleware|미들웨어)[^\n;]*(?:available|can\s+be\s+(?:installed|mounted|registered)|provided|supported)|(?:middleware|미들웨어)[^\n;]*(?:설치|마운트|등록|제공|지원|관리|소유|활성화)|(?:설치|마운트|등록|제공|지원|관리|소유|활성화)[^\n;]*(?:middleware|미들웨어)/iu,
    target: /Passport(?:\.js)?\s+middleware|middleware|미들웨어/iu,
  },
  {
    abbreviated: /\b(?:available|configured|enabled|supported)\b|(?:session\s+)?support\s+becomes\s+available|(?:session|세션)[^\n;]*(?:구성|지원|활성화)/iu,
    id: 'session-ownership',
    positive: /(?:configure|enable|include|manage|own|provide(?!r)|support)\w*[^\n;]*(?:(?:Passport(?:\.js)?\s+)?sessions?|세션)|(?:(?:Passport(?:\.js)?\s+)?sessions?|세션)[^\n;]*(?:available|configured|enabled|managed|provided|supported)|(?:sessions?|세션)[^\n;]*(?:구성|관리|소유|지원|제공|포함|활성화)|(?:구성|관리|소유|지원|제공|포함|활성화)[^\n;]*(?:sessions?|세션)/iu,
    target: /Passport(?:\.js)?\s+sessions?|sessions?|세션/iu,
  },
  {
    id: 'serializer-ownership',
    positive: /(?:configure|enable|include|manage|own|provide(?!r)|register|support)\w*[^\n;]*(?:de)?serializers?|(?:de)?serializers?[^\n;]*(?:available|configured|enabled|managed|provided|registered|supported)|(?:de)?serializers?[^\n;]*(?:구성|관리|소유|지원|제공|포함|등록|활성화)|(?:구성|관리|소유|지원|제공|포함|등록|활성화)[^\n;]*(?:de)?serializers?/iu,
    target: /(?:de)?serializers?|(?:de)?serializer|직렬화기/iu,
  },
  {
    id: 'automatic-discovery',
    positive: /(?:discover|enable|provide(?!r)|support)\w*[^\n;]*(?:automatic\s+strategy\s+discovery|strateg(?:y|ies))|automatic\s+strategy\s+discovery[^\n;]*(?:available|enabled|provided|supported)|(?:automatic\s+strategy\s+discovery|strateg(?:y|ies))[^\n;]*(?:자동\s*발견|discovery|활성화)|(?:발견|지원|제공|활성화)[^\n;]*(?:automatic\s+strategy\s+discovery|strateg(?:y|ies))/iu,
    target: /automatic\s+strategy\s+discovery|automatic(?:ally)?\s+discover\w*|strateg(?:y|ies).*(?:discover|discovery)|자동.*strateg(?:y|ies).*(?:발견|discovery)/iu,
  },
  {
    id: 'implicit-guards',
    positive: /(?:add|apply|enable|install|provide(?!r)|support)\w*[^\n;]*implicit\s+guards?|implicit\s+guards?[^\n;]*(?:added|applied|available|enabled|installed|provided|supported)|implicit\s+guards?[^\n;]*(?:추가|적용|설치|지원|제공|활성화)|(?:추가|적용|설치|지원|제공|활성화)[^\n;]*implicit\s+guards?/iu,
    target: /implicit\s+guards?|암묵적\s+가드/iu,
  },
  {
    id: 'request-augmentation',
    positive: /(?:augment|enable|mutate|own|provide(?!r)|support)\w*[^\n;]*(?:request\s+augmentation|the\s+request)|request\s+augmentation[^\n;]*(?:available|enabled|owned|provided|supported)|request\s+augmentation[^\n;]*(?:변경|수정|소유|지원|제공|확장)|(?:변경|수정|소유|지원|제공|확장)[^\n;]*request\s+augmentation/iu,
    target: /request\s+augmentation|augment\w*\s+(?:the\s+)?request|요청\s+확장/iu,
  },
  {
    id: 'host-middleware-ownership',
    positive: /(?:control|manage|own|provide(?!r)|support)\w*[^\n;]*(?:host\s+middleware|호스트\s+미들웨어)|(?:host\s+middleware|호스트\s+미들웨어)[^\n;]*(?:controlled|managed|owned|provided|supported)|(?:host\s+middleware|호스트\s+미들웨어)[^\n;]*(?:관리|소유|지원|제공|통제)|(?:관리|소유|지원|제공|통제)[^\n;]*(?:host\s+middleware|호스트\s+미들웨어)/iu,
    target: /host\s+middleware|호스트\s+미들웨어/iu,
  },
];

const bridgeActorPattern = /\bbridge\b|브리지/iu;
const bridgeSubjectPattern = /^(?:the\s+)?bridge\b|^(?:이\s+)?(?:bridge|브리지)(?:는|은|이|가)?/iu;
const externalSubjectPattern = /^(?:the\s+)?(?:applications?|hosts?)\b|^(?:애플리케이션|호스트)(?:는|은|이|가)/iu;
const externalActionPattern = /\b(?:applications?|hosts?)\b\s+(?:(?:that|which)\s+|to\s+)?(?:configure|enable|install|manage|mount|own|register)\w*|(?:애플리케이션|호스트)(?:는|은|이|가)[^\n;]*(?:구성|관리|마운트|설치|소유|등록|활성화)|(?:구성|관리|마운트|설치|소유|등록|활성화)(?:하|해|할|한|하는|할\s+수\s+있는)[^\n;]*(?:애플리케이션|호스트)(?:을|를|에게|는|은|이|가)/iu;
const englishExternalPassiveActionPattern = /(?:middleware|sessions?)[^\n;]*(?:(?:is|are)\s+)?(?:configured|enabled|installed|managed|mounted|owned|registered)\s+by\s+(?:(?:an?|the)\s+)?(?:applications?|hosts?)/iu;
const englishBridgePassiveActionPattern = /(?:(?:Passport(?:\.js)?\s+)?(?:middleware|sessions?)|(?:de)?serializers?)[^\n;]*(?:is|are)\s+(?:configured|enabled|installed|managed|mounted|owned|registered)\s+by\s+(?:the\s+)?bridge\b/iu;
const bridgeExternalGuidancePattern = /^(?:the\s+)?bridge\s+(?:offers?|provides?|supports?)\b|^(?:이\s+)?(?:bridge|브리지)(?:는|은|이|가)?[^\n;]*(?:방법을\s+제공|구성을\s+지원)/iu;
const koreanExternalPassiveActionPattern = /(?:애플리케이션|호스트)(?:들)?(?:에\s*의해|에서)[^\n;]*?(?:(?:Passport(?:\.js)?\s+)?(?:middleware|sessions?)|미들웨어|세션)(?:이|가)?\s*(?:구성|관리|마운트|설치|소유|등록|활성화)(?:되는|됩니다)/iu;
const koreanExternalNegatedQualifierPattern = /(?:(?:Passport(?:\.js)?\s+)?(?:middleware|sessions?)|미들웨어|세션)(?:을|를|이|가)?\s*(?:구성|관리|마운트|설치|소유|등록|활성화)하지\s+않는\s+(?:애플리케이션|호스트)(?:(?:을|를)\s*위해|을|를|은|는|이|가)?/iu;
const negationPattern = /\b(?:cannot|can't|disabled|does?\s+not|never|no|not|outside\s+the\s+bridge|unsupported|without|won't)\b|(?:꺼져|남(?:기|긴|고|는다|습니다)|못|비활성화|아니|않|없|외부|지원하지|제공하지|설치하지|관리하지|등록하지|소유하지)/iu;
const hangulPattern = /[가-힣]/u;

function splitPropositions(sentence) {
  return sentence
    .split(/\s*(?:\||;|,?\s+(?:and|but|however|nevertheless|while|whereas|yet)\s+|\s+(?:그리고|그렇지만|그러나|다만|반면|하지만|않고|않으며)\s+|지만)\s*/iu)
    .map((clause) => clause.trim())
    .filter(Boolean);
}

function propositionActor(clause, inheritedActor) {
  if (externalSubjectPattern.test(clause)) {
    return 'external';
  }
  if (bridgeSubjectPattern.test(clause) || bridgeActorPattern.test(clause)) {
    return 'bridge';
  }
  return inheritedActor;
}

function outerAction(clause) {
  const scopedClause = clause.replace(koreanExternalNegatedQualifierPattern, '');
  const boundaries = [
    scopedClause.search(/\b(?:that|where|which)\b/iu),
    scopedClause.search(externalActionPattern),
    scopedClause.search(koreanExternalPassiveActionPattern),
  ].filter((boundary) => boundary >= 0);
  return boundaries.length === 0 ? scopedClause : scopedClause.slice(0, Math.min(...boundaries));
}

function hasBridgeCapabilityAction(clause, capability) {
  const action = outerAction(clause);
  return capability.target.test(action) && capability.positive.test(action);
}

function hasExternalPassiveActionOwner(clause) {
  return englishExternalPassiveActionPattern.test(clause) || koreanExternalPassiveActionPattern.test(clause);
}

function hasBridgePassiveActionOwner(clause, capability) {
  return capability.target.test(clause) && englishBridgePassiveActionPattern.test(clause);
}

function hasGovernedActionNegation(action, capability) {
  const negation = negationPattern.exec(action);
  if (!negation) {
    return false;
  }
  const negatedScope = action.slice(negation.index);
  if (/^without\b/iu.test(negation[0])) {
    return capability.target.test(negatedScope);
  }
  if (capability.target.test(negatedScope)) {
    return true;
  }
  return !governedCapabilities.some((otherCapability) =>
    otherCapability !== capability && otherCapability.target.test(negatedScope));
}

function hasUnsupportedProposition(sentence, capability) {
  if (!bridgeActorPattern.test(sentence) || !capability.target.test(sentence)) {
    return false;
  }

  let actor;
  return splitPropositions(sentence).some((clause, index) => {
    actor = propositionActor(clause, actor);
    if (actor === 'bridge') {
      const action = outerAction(clause);
      if (hasGovernedActionNegation(action, capability)) {
        return false;
      }
      if (hasExternalPassiveActionOwner(clause) && bridgeExternalGuidancePattern.test(clause)) {
        return false;
      }
      if (hasBridgeCapabilityAction(action, capability)) {
        return true;
      }
      if (hasBridgePassiveActionOwner(clause, capability)) {
        return true;
      }
    }
    if (hasGovernedActionNegation(clause, capability)) {
      return false;
    }
    if (externalActionPattern.test(clause)) {
      return false;
    }
    if (hasExternalPassiveActionOwner(clause)) {
      return false;
    }
    if (actor === 'external') {
      return false;
    }
    if (actor === 'bridge') {
      return capability.positive.test(clause) || capability.abbreviated?.test(clause) === true;
    }
    return index > 0 && capability.abbreviated?.test(clause) === true;
  });
}

export function collectUnsupportedPassportBridgeClaims(content) {
  const claims = new Set();

  for (const sentence of content.split(/\n|[!?。！？]+|\.(?=\s|$)/u).map((value) => value.trim()).filter(Boolean)) {
    for (const capability of governedCapabilities) {
      if (hasUnsupportedProposition(sentence, capability)) {
        claims.add(`${capability.id}${hangulPattern.test(sentence) ? '-ko' : ''}`);
      }
    }
  }

  return [...claims];
}
