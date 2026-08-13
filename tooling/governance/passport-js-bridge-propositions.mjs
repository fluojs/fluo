const governedCapabilities = [
  {
    id: 'full-nestjs-compatibility',
    positive: /(?:provide|offer|support|deliver|enable|include)\w*[^\n;]*full\s+NestJS\s+Passport\s+compatibility|full\s+NestJS\s+Passport\s+compatibility[^\n;]*(?:available|provided|supported)|full\s+NestJS\s+Passport\s+compatibility[^\n;]*(?:제공|지원|가능|호환)|(?:제공|지원|호환)[^\n;]*full\s+NestJS\s+Passport\s+compatibility/iu,
    target: /full\s+NestJS\s+Passport\s+compatibility/iu,
  },
  {
    abbreviated: /\bcan\b[^\n;]*(?:enabled|install|mount|register)|(?:설치|마운트|등록|활성화)[^\n;]*수\s+있/iu,
    id: 'middleware-installation',
    positive: /(?:install|mount|register|provide|support|manage|own)\w*[^\n;]*(?:Passport(?:\.js)?\s+)?middleware|(?:Passport(?:\.js)?\s+)?middleware[^\n;]*(?:available|can\s+be\s+(?:installed|mounted|registered)|provided|supported)|middleware[^\n;]*(?:설치|마운트|등록|제공|지원|관리|소유|활성화)|(?:설치|마운트|등록|제공|지원|관리|소유|활성화)[^\n;]*middleware/iu,
    target: /Passport(?:\.js)?\s+middleware|middleware/iu,
  },
  {
    abbreviated: /\b(?:available|configured|enabled|supported)\b|(?:session\s+)?support\s+becomes\s+available|(?:session|세션)[^\n;]*(?:구성|지원|활성화)/iu,
    id: 'session-ownership',
    positive: /(?:configure|enable|include|manage|own|provide|support)\w*[^\n;]*(?:Passport(?:\.js)?\s+)?sessions?|(?:Passport(?:\.js)?\s+)?sessions?[^\n;]*(?:available|configured|enabled|managed|provided|supported)|sessions?[^\n;]*(?:구성|관리|소유|지원|제공|포함|활성화)|(?:구성|관리|소유|지원|제공|포함|활성화)[^\n;]*sessions?/iu,
    target: /Passport(?:\.js)?\s+sessions?|sessions?|세션/iu,
  },
  {
    id: 'serializer-ownership',
    positive: /(?:configure|enable|include|manage|own|provide|register|support)\w*[^\n;]*(?:de)?serializers?|(?:de)?serializers?[^\n;]*(?:available|configured|enabled|managed|provided|registered|supported)|(?:de)?serializers?[^\n;]*(?:구성|관리|소유|지원|제공|포함|등록|활성화)|(?:구성|관리|소유|지원|제공|포함|등록|활성화)[^\n;]*(?:de)?serializers?/iu,
    target: /(?:de)?serializers?|(?:de)?serializer|직렬화기/iu,
  },
  {
    id: 'automatic-discovery',
    positive: /(?:discover|enable|provide|support)\w*[^\n;]*(?:automatic\s+strategy\s+discovery|strateg(?:y|ies))|automatic\s+strategy\s+discovery[^\n;]*(?:available|enabled|provided|supported)|(?:automatic\s+strategy\s+discovery|strateg(?:y|ies))[^\n;]*(?:자동\s*발견|discovery|활성화)|(?:발견|지원|제공|활성화)[^\n;]*(?:automatic\s+strategy\s+discovery|strateg(?:y|ies))/iu,
    target: /automatic\s+strategy\s+discovery|automatic(?:ally)?\s+discover\w*|strateg(?:y|ies).*(?:discover|discovery)|자동.*strateg(?:y|ies).*(?:발견|discovery)/iu,
  },
  {
    id: 'implicit-guards',
    positive: /(?:add|apply|enable|install|provide|support)\w*[^\n;]*implicit\s+guards?|implicit\s+guards?[^\n;]*(?:added|applied|available|enabled|installed|provided|supported)|implicit\s+guards?[^\n;]*(?:추가|적용|설치|지원|제공|활성화)|(?:추가|적용|설치|지원|제공|활성화)[^\n;]*implicit\s+guards?/iu,
    target: /implicit\s+guards?|암묵적\s+가드/iu,
  },
  {
    id: 'request-augmentation',
    positive: /(?:augment|enable|mutate|own|provide|support)\w*[^\n;]*(?:request\s+augmentation|the\s+request)|request\s+augmentation[^\n;]*(?:available|enabled|owned|provided|supported)|request\s+augmentation[^\n;]*(?:변경|수정|소유|지원|제공|확장)|(?:변경|수정|소유|지원|제공|확장)[^\n;]*request\s+augmentation/iu,
    target: /request\s+augmentation|augment\w*\s+(?:the\s+)?request|요청\s+확장/iu,
  },
  {
    id: 'host-middleware-ownership',
    positive: /(?:control|manage|own|provide|support)\w*[^\n;]*host\s+middleware|host\s+middleware[^\n;]*(?:controlled|managed|owned|provided|supported)|host\s+middleware[^\n;]*(?:관리|소유|지원|제공|통제)|(?:관리|소유|지원|제공|통제)[^\n;]*host\s+middleware/iu,
    target: /host\s+middleware|호스트\s+미들웨어/iu,
  },
];

const bridgeActorPattern = /\bbridge\b|브리지/u;
const externalActorPattern = /\b(?:applications?|hosts?)\b|애플리케이션|호스트/iu;
const negationPattern = /\b(?:cannot|can't|disabled|does?\s+not|never|no|not|outside\s+the\s+bridge|unsupported|without|won't)\b|(?:application-owned|꺼져|남(?:기|긴|고|는다|습니다)|못|비활성화|아니|않|없|외부|지원하지|제공하지|설치하지|관리하지|등록하지|소유하지)/iu;
const hangulPattern = /[가-힣]/u;

function splitPropositions(sentence) {
  return sentence
    .split(/\s*(?:\||;|,?\s+(?:but|however|nevertheless|while|whereas|yet)\s+|(?:그렇지만|그러나|다만|반면|하지만)|지만)\s*/iu)
    .map((clause) => clause.trim())
    .filter(Boolean);
}

function hasUnsupportedProposition(sentence, capability) {
  if (!bridgeActorPattern.test(sentence) || !capability.target.test(sentence)) {
    return false;
  }

  return splitPropositions(sentence).some((clause, index) => {
    if (negationPattern.test(clause)) {
      return false;
    }
    if (bridgeActorPattern.test(clause)) {
      return capability.positive.test(clause);
    }
    return index > 0 && !externalActorPattern.test(clause) && capability.abbreviated?.test(clause);
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
