import type { Plugin } from 'vite';

/**
 * Calls the fluoDecoratorsPlugin transform hook directly, mirroring the
 * package's own transform-level test seam. Exposes narrow accessors instead
 * of casting so fixture code keeps honest types.
 */

export function runDecoratorsTransform(plugin: Plugin, code: string, id: string): Promise<unknown> {
  if (typeof plugin.transform !== 'function') {
    throw new Error('Expected fluoDecoratorsPlugin to expose a callable transform hook.');
  }

  return Reflect.apply(plugin.transform, {}, [code, id]) as Promise<unknown>;
}

export function readTransformedCode(result: unknown): string {
  if (typeof result !== 'object' || result === null || !('code' in result)) {
    throw new Error('expected the transform hook to return transformed code');
  }

  const code: unknown = result.code;
  if (typeof code !== 'string') {
    throw new Error('expected the transform hook to return a string code field');
  }

  return code;
}
