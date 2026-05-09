import fluoLogo from '../../../../src/fluo.png';

import Image from 'next/image';
import Link from 'next/link';

import styles from './landing.module.css';

export default async function Home({ params }: PageProps<'/[lang]'>) {
  const { lang } = await params;
  const isKorean = lang === 'ko';
  const copy = isKorean ? koreanCopy : englishCopy;

  return (
    <main className={styles.page}>
      <div className={styles.aurora} aria-hidden="true" />
      <section className={styles.hero}>
        <div className={styles.copyStack}>
          <p className={styles.eyebrow}>{copy.eyebrow}</p>
          <h1 className={`${styles.title} ${isKorean ? styles.koreanTitle : ''}`}>
            {copy.title.map((line) => (
              <span key={line.map((part) => part.text).join('')} className={styles.titleLine}>
                {line.map((part) => (
                  <span key={part.text} className={part.accent ? styles.titleAccent : undefined}>
                    {part.text}
                  </span>
                ))}
              </span>
            ))}
          </h1>
          <p className={styles.subtitle}>{copy.subtitle}</p>
          <div className={styles.actions}>
            <Link href={`/${lang}/docs/getting-started/quick-start`} className={styles.primaryAction}>
              {copy.primaryAction}
            </Link>
            <Link href={`/${lang}/docs/packages`} className={styles.secondaryAction}>
              {copy.secondaryAction}
            </Link>
          </div>
          <dl className={styles.stats}>
            {copy.stats.map((stat) => (
              <div key={stat.label} className={styles.statCard}>
                <dt>{stat.value}</dt>
                <dd>{stat.label}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className={styles.logoStage} aria-label={copy.logoLabel}>
          <div className={styles.orbitOne} aria-hidden="true" />
          <div className={styles.orbitTwo} aria-hidden="true" />
          <div className={styles.logoPanel}>
            <Image src={fluoLogo} alt="fluo" priority className={styles.logo} />
          </div>
          <div className={styles.codeCard}>
            <span>{copy.codeBadge}</span>
            <code>{copy.code}</code>
          </div>
        </div>
      </section>

      <section className={styles.flowGrid} aria-label={copy.flowLabel}>
        {copy.flows.map((flow) => (
          <Link key={flow.href} href={`/${lang}${flow.href}`} className={styles.flowCard}>
            <span>{flow.kicker}</span>
            <strong>{flow.title}</strong>
            <p>{flow.description}</p>
          </Link>
        ))}
      </section>
    </main>
  );
}

const englishCopy = {
  eyebrow: 'Standard-first TypeScript backend framework',
  title: [
    [{ text: 'fluo', accent: true }, { text: ' backend.' }],
    [{ text: 'No legacy magic.' }],
  ],
  subtitle:
    'fluo gives you Nest-like structure, Hono-like speed, and explicit runtime contracts across Node.js, Bun, Deno, Workers, Fastify, and Express.',
  primaryAction: 'Start building',
  secondaryAction: 'Explore 40 packages',
  logoLabel: 'fluo logo composition',
  codeBadge: 'no legacy flags',
  code: '@Module({ providers: [UsersService] })',
  flowLabel: 'Primary documentation paths',
  stats: [
    { value: '40', label: 'official packages' },
    { value: '6', label: 'runtime adapters' },
    { value: '2', label: 'first-class languages' },
  ],
  flows: [
    {
      kicker: 'Overview',
      title: 'Why fluo?',
      description: 'Understand the standard-first model before comparing framework tradeoffs.',
      href: '/docs/why-fluo',
    },
    {
      kicker: 'Fundamentals',
      title: 'First feature slice',
      description: 'Move from module to controller to validation and tests in one path.',
      href: '/docs/guides/first-feature',
    },
    {
      kicker: 'API Reference',
      title: 'Package matrix',
      description: 'Find the package that owns HTTP, auth, data, realtime, ops, or tooling.',
      href: '/docs/packages/matrix',
    },
    {
      kicker: 'Recipes',
      title: 'Runnable examples',
      description: 'Jump into minimal, RealWorld, auth, and operations example apps.',
      href: '/docs/examples',
    },
  ],
};

const koreanCopy = {
  eyebrow: 'Standard-first TypeScript 백엔드 프레임워크',
  title: [
    [{ text: 'fluo', accent: true }, { text: ' 백엔드.' }],
    [{ text: '레거시 없이.' }],
  ],
  subtitle:
    'fluo는 Nest 같은 구조, Hono 같은 속도, 그리고 Node.js, Bun, Deno, Workers, Fastify, Express를 가로지르는 명시적 런타임 계약을 제공합니다.',
  primaryAction: '바로 시작하기',
  secondaryAction: '40개 패키지 보기',
  logoLabel: 'fluo 로고 구성',
  codeBadge: 'legacy flag 없음',
  code: '@Module({ providers: [UsersService] })',
  flowLabel: '주요 문서 경로',
  stats: [
    { value: '40', label: '공식 패키지' },
    { value: '6', label: '런타임 어댑터' },
    { value: '2', label: '일급 언어' },
  ],
  flows: [
    {
      kicker: 'Overview',
      title: '왜 fluo인가요?',
      description: '프레임워크를 비교하기 전에 standard-first 모델을 이해합니다.',
      href: '/docs/why-fluo',
    },
    {
      kicker: 'Fundamentals',
      title: '첫 기능 slice',
      description: 'Module에서 controller, validation, test까지 한 번에 따라갑니다.',
      href: '/docs/guides/first-feature',
    },
    {
      kicker: 'API Reference',
      title: '패키지 매트릭스',
      description: 'HTTP, auth, data, realtime, ops, tooling의 소유 패키지를 찾습니다.',
      href: '/docs/packages/matrix',
    },
    {
      kicker: 'Recipes',
      title: '실행 가능한 예제',
      description: 'Minimal, RealWorld, auth, operations 예제 앱으로 이동합니다.',
      href: '/docs/examples',
    },
  ],
};
