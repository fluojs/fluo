import defaultMdxComponents from 'fumadocs-ui/mdx';
import type { MDXComponents } from 'mdx/types';
import { CheckpointCode } from './checkpoint-code';
import { ExampleCode } from './example-code';

export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    CheckpointCode,
    ExampleCode,
    ...components,
  } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
