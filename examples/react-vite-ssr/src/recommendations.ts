import { createElement } from 'react';

export type RecommendationsProps = {
  readonly sku: string;
};

export function Recommendations({ sku }: RecommendationsProps) {
  return createElement('section', { 'aria-label': 'Recommendations' }, `Recommended for ${sku}`);
}
