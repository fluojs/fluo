import { describe, expect, it } from 'vitest';

import { collectUnsupportedPassportBridgeClaims } from './passport-js-bridge-propositions.mjs';

describe('Passport.js bridge unsupported propositions', () => {
  it.each([
    ['full-nestjs-compatibility', 'The bridge provides full NestJS Passport compatibility.'],
    ['middleware-installation', 'The bridge installs Passport middleware.'],
    ['session-ownership', 'The bridge manages Passport sessions.'],
    ['serializer-ownership', 'The bridge registers Passport serializers.'],
    ['automatic-discovery', 'The bridge automatically discovers all Passport.js strategies.'],
    ['implicit-guards', 'The bridge provides implicit guards.'],
    ['request-augmentation', 'The bridge augments the request.'],
    ['host-middleware-ownership', 'The bridge owns host middleware.'],
    ['full-nestjs-compatibility-ko', 'bridge는 full NestJS Passport compatibility를 제공한다.'],
    ['middleware-installation-ko', 'bridge는 Passport middleware를 설치한다.'],
    ['session-ownership-ko', 'bridge는 Passport sessions를 관리한다.'],
    ['serializer-ownership-ko', 'bridge는 Passport serializers를 등록한다.'],
    ['automatic-discovery-ko', 'bridge는 Passport.js strategy를 자동으로 discovery한다.'],
    ['implicit-guards-ko', 'bridge는 implicit guards를 제공한다.'],
    ['request-augmentation-ko', 'bridge는 request augmentation을 소유한다.'],
    ['host-middleware-ownership-ko', 'bridge는 host middleware를 소유한다.'],
  ] as const)('rejects the unsupported %s claim', (claimName, claim) => {
    // Given / When
    const detectedClaims = collectUnsupportedPassportBridgeClaims(claim);

    // Then
    expect(detectedClaims).toContain(claimName);
  });

  it.each([
    ['middleware-installation', 'The bridge does not install Passport middleware by default, but can when enabled.'],
    ['session-ownership', 'The bridge does not own sessions normally; however, session support becomes available after configuration.'],
    ['serializer-ownership', 'Serializer registration is not automatic, but the bridge can register serializers on request.'],
    ['automatic-discovery', 'Automatic strategy discovery is disabled by default; enable the bridge to discover strategies.'],
    ['middleware-installation-ko', 'bridge는 기본적으로 Passport middleware를 설치하지 않지만 옵션을 켜면 설치할 수 있습니다.'],
    ['session-ownership-ko', 'bridge는 평소 session을 관리하지 않지만 설정하면 session 지원이 활성화됩니다.'],
    ['serializer-ownership-ko', 'serializer 등록은 자동이 아니지만 bridge가 필요할 때 serializer를 등록할 수 있습니다.'],
    ['automatic-discovery-ko', '기본값에서는 automatic strategy discovery가 꺼져 있지만 bridge를 활성화하면 strategy를 자동 발견합니다.'],
  ] as const)('rejects the compound or paraphrased %s proposition', (claimName, claim) => {
    // Given / When
    const detectedClaims = collectUnsupportedPassportBridgeClaims(claim);

    // Then
    expect(detectedClaims).toContain(claimName);
  });

  it.each([
    [
      'host-middleware-ownership',
      'The bridge does not install middleware and owns host middleware.',
    ],
    [
      'host-middleware-ownership-ko',
      '브리지는 Passport 미들웨어를 설치하지 않고 호스트 미들웨어를 소유합니다.',
    ],
  ] as const)('inherits the bridge actor across the compound %s proposition', (claimName, claim) => {
    // Given / When
    const detectedClaims = collectUnsupportedPassportBridgeClaims(claim);

    // Then
    expect(detectedClaims).toContain(claimName);
  });

  it.each([
    'The bridge supports applications that install Passport middleware.',
    'The bridge provides a way for hosts to manage sessions.',
    '브리지는 Passport 미들웨어를 설치하는 애플리케이션을 지원합니다.',
    '브리지는 호스트가 세션을 관리할 수 있는 방법을 제공합니다.',
  ] as const)('accepts external-actor ownership guidance: %s', (guidance) => {
    // Given / When
    const detectedClaims = collectUnsupportedPassportBridgeClaims(guidance);

    // Then
    expect(detectedClaims).toEqual([]);
  });

  it.each([
    'The bridge never installs Passport middleware, even when configured.',
    'Sessions and serializers remain application-owned; the bridge cannot configure them.',
    'The bridge does not provide automatic strategy discovery.',
    'The bridge does not install middleware; applications can install it at the host boundary.',
    'bridge는 설정하더라도 Passport middleware를 설치하지 않습니다.',
    'Session과 serializer는 application-owned 상태로 남고 bridge가 관리하지 않습니다.',
    'bridge는 automatic strategy discovery를 제공하지 않습니다.',
    'bridge는 middleware를 설치하지 않으며 애플리케이션이 host boundary에서 직접 설치할 수 있습니다.',
  ] as const)('accepts direct negative-only guidance: %s', (guidance) => {
    // Given / When
    const detectedClaims = collectUnsupportedPassportBridgeClaims(guidance);

    // Then
    expect(detectedClaims).toEqual([]);
  });
});
