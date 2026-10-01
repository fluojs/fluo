import { createElement } from 'react';

/** Authored browser props, shared by initial and negotiated generated contracts. */
export type ProjectedPageProps = {
  readonly page: number;
  readonly product: string;
  readonly tags: string | readonly string[];
  readonly term: string;
};

/** Browser-only fixture component with a concrete JSON props contract. */
export default function ProjectedPage(props: ProjectedPageProps) {
  return createElement('main', null, `${props.product}:${props.term}:${props.page}`);
}
