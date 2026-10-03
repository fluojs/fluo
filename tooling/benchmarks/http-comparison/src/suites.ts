import { SCENARIOS, type ScenarioConfig, STAGE_SCENARIOS } from './scenarios';

export function selectSuite(suite = process.env.BENCH_SUITE ?? 'business'): readonly ScenarioConfig[] {
  switch (suite) {
    case 'business': return SCENARIOS;
    case 'stages': return STAGE_SCENARIOS;
    case 'all': return [...SCENARIOS, ...STAGE_SCENARIOS];
    default: throw new TypeError(`Unknown BENCH_SUITE: ${suite}`);
  }
}
