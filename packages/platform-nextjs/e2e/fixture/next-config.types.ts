import {
  type FluoNextBackendOptions,
  withFluoNextBackend,
} from '@fluojs/platform-nextjs/next-config';
import type { NextConfig } from 'next';

// Next's real build typechecks the shipped declaration and public subpath.
const options = {
  include: /(?:^|\/)backend\.ts$/u,
  exclude: '**/*.test.ts',
  preserveModulePaths: true,
} satisfies FluoNextBackendOptions;

export const scopedConfig: NextConfig = withFluoNextBackend({}, options);
export const legacyConfig: NextConfig = withFluoNextBackend();
