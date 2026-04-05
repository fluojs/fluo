import {
  createKonektiBabelDecoratorsPlugin,
  type KonektiBabelDecoratorsPlugin,
  resolveNearestBabelConfigFile,
} from './babel-decorators-plugin.js';

export function konektiBabelDecoratorsPlugin(): KonektiBabelDecoratorsPlugin {
  return createKonektiBabelDecoratorsPlugin(resolveNearestBabelConfigFile);
}
