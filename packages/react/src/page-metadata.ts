import { createElement, type ReactElement } from 'react';

import type { ReactRenderContext } from './render.js';
import type { ReactRenderPolicies } from './render-policy.js';
import {
  createReactRenderPolicyDecorator,
  type ReactRenderPolicyDecorator,
} from './render-policy-metadata.js';

/** Request-scoped, response-free context supplied to page metadata factories. */
export type ReactPageMetadataContext = {
  readonly container: ReactRenderContext['container'];
  readonly request: ReactRenderContext['request'];
  readonly requestId?: ReactRenderContext['requestId'];
};

/** One name- or property-addressed React document meta descriptor. */
export type ReactPageMeta =
  | {
      readonly content: string;
      readonly name: string;
      readonly property?: never;
    }
  | {
      readonly content: string;
      readonly name?: never;
      readonly property: string;
    };

/** One bounded React document link descriptor. */
export type ReactPageLink = {
  readonly href: string;
  readonly media?: string;
  readonly rel: string;
  readonly type?: string;
};

/** Composed document-head metadata for one matched React page request. */
export type ReactPageMetadata = {
  readonly links?: readonly ReactPageLink[];
  readonly meta?: readonly ReactPageMeta[];
  readonly title?: string;
};

/** Synchronous request-aware factory for one React page metadata declaration. */
export type ReactPageMetadataFactory = (
  context: ReactPageMetadataContext,
) => ReactPageMetadata;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPageLinkHref(href: string): boolean {
  if (/^https?:\/\//iu.test(href)) {
    return true;
  }
  return href.startsWith('/') && new URL(href, 'https://fluo.invalid').origin === 'https://fluo.invalid';
}

/**
 * Validate the bounded page-owned head subset crossing the HTTP/browser representation.
 *
 * @param value Untrusted head descriptors from a navigation payload or resolved render policy.
 * @returns A bounded head snapshot, or undefined for malformed or oversized descriptors.
 */
export function parseReactPageMetadata(value: unknown): ReactPageMetadata | undefined {
  if (!isRecord(value) || Object.keys(value).some((key) => !['title', 'meta', 'links'].includes(key))
    || value.title !== undefined && (typeof value.title !== 'string' || value.title.length > 512)
    || value.meta !== undefined && (!Array.isArray(value.meta) || value.meta.length > 32)
    || value.links !== undefined && (!Array.isArray(value.links) || value.links.length > 32)) {
    return undefined;
  }
  const meta: ReactPageMeta[] = [];
  const links: ReactPageLink[] = [];
  const metaKeys = new Set<string>();
  const linkKeys = new Set<string>();
  for (const entry of value.meta ?? []) {
    if (!isRecord(entry) || typeof entry.content !== 'string' || entry.content.length > 2048
      || (typeof entry.name === 'string') === (typeof entry.property === 'string')
      || Object.keys(entry).some((key) => !['name', 'property', 'content'].includes(key))) {
      return undefined;
    }
    const descriptor: ReactPageMeta = typeof entry.name === 'string'
      ? { name: entry.name, content: entry.content }
      : { property: String(entry.property), content: entry.content };
    const identity = metaIdentity(descriptor);
    if (metaKeys.has(identity) || (descriptor.name ?? descriptor.property).length > 128) {
      return undefined;
    }
    metaKeys.add(identity);
    meta.push(descriptor);
  }
  for (const entry of value.links ?? []) {
    if (!isRecord(entry) || typeof entry.rel !== 'string' || entry.rel.length > 128
      || typeof entry.href !== 'string' || entry.href.length > 2048
      || !isPageLinkHref(entry.href)
      || entry.media !== undefined && (typeof entry.media !== 'string' || entry.media.length > 128)
      || entry.type !== undefined && (typeof entry.type !== 'string' || entry.type.length > 128)
      || Object.keys(entry).some((key) => !['rel', 'href', 'media', 'type'].includes(key))) {
      return undefined;
    }
    const descriptor: ReactPageLink = {
      href: entry.href,
      rel: entry.rel,
      ...(typeof entry.media === 'string' ? { media: entry.media } : {}),
      ...(typeof entry.type === 'string' ? { type: entry.type } : {}),
    };
    const identity = linkIdentity(descriptor);
    if (linkKeys.has(identity)) {
      return undefined;
    }
    linkKeys.add(identity);
    links.push(descriptor);
  }
  return Object.freeze({
    ...(typeof value.title === 'string' ? { title: value.title } : {}),
    ...(value.meta === undefined ? {} : { meta: Object.freeze(meta.map((entry) => Object.freeze(entry))) }),
    ...(value.links === undefined ? {} : { links: Object.freeze(links.map((entry) => Object.freeze(entry))) }),
  });
}

function replaceEntry<Value>(entries: Map<string, Value>, key: string, value: Value): void {
  entries.delete(key);
  entries.set(key, value);
}

function metaIdentity(meta: ReactPageMeta): string {
  return meta.name !== undefined
    ? JSON.stringify(['name', meta.name])
    : JSON.stringify(['property', meta.property]);
}

function linkIdentity(link: ReactPageLink): string {
  return JSON.stringify([link.rel, link.href]);
}

function cloneMeta(meta: ReactPageMeta): ReactPageMeta {
  return meta.name !== undefined
    ? Object.freeze({ content: meta.content, name: meta.name })
    : Object.freeze({ content: meta.content, property: meta.property });
}

function cloneLink(link: ReactPageLink): ReactPageLink {
  return Object.freeze({
    href: link.href,
    ...(link.media === undefined ? {} : { media: link.media }),
    rel: link.rel,
    ...(link.type === undefined ? {} : { type: link.type }),
  });
}

/**
 * Marks a React router class or `@Path(...)` method with one page metadata factory.
 *
 * @param factory Synchronous request-aware factory consumed by the application page renderer.
 * @returns A class-or-method decorator that records render-only metadata without changing HTTP matching.
 */
export function PageMetadata(factory: ReactPageMetadataFactory): ReactRenderPolicyDecorator {
  return createReactRenderPolicyDecorator('page-metadata', factory);
}

/**
 * Resolves ordered page metadata factories for one active request.
 *
 * @param policies Matched page policies supplied to the application renderer.
 * @param context Active request-scoped React render context.
 * @returns A frozen metadata snapshot with deterministic nearest-title and descriptor replacement semantics.
 */
export function resolveReactPageMetadata(
  policies: ReactRenderPolicies,
  context: ReactRenderContext,
): ReactPageMetadata {
  const metadataContext: ReactPageMetadataContext = Object.freeze({
    container: context.container,
    request: context.request,
    ...(context.requestId === undefined ? {} : { requestId: context.requestId }),
  });
  const meta = new Map<string, ReactPageMeta>();
  const links = new Map<string, ReactPageLink>();
  let title: string | undefined;

  for (const factory of policies.pageMetadata ?? []) {
    const declaration = factory(metadataContext);
    if (declaration.title !== undefined) {
      title = declaration.title;
    }
    for (const descriptor of declaration.meta ?? []) {
      const cloned = cloneMeta(descriptor);
      replaceEntry(meta, metaIdentity(cloned), cloned);
    }
    for (const descriptor of declaration.links ?? []) {
      const cloned = cloneLink(descriptor);
      replaceEntry(links, linkIdentity(cloned), cloned);
    }
  }

  return Object.freeze({
    ...(links.size === 0 ? {} : { links: Object.freeze([...links.values()]) }),
    ...(meta.size === 0 ? {} : { meta: Object.freeze([...meta.values()]) }),
    ...(title === undefined ? {} : { title }),
  });
}

/**
 * Creates escaped ordinary React head elements from resolved page metadata.
 *
 * @param metadata Resolved metadata snapshot for one matched page request.
 * @returns Frozen title, meta, and link elements in deterministic composition order.
 */
export function createReactPageMetadataElements(
  metadata: ReactPageMetadata,
): readonly ReactElement[] {
  const elements: ReactElement[] = [];

  if (metadata.title !== undefined) {
    elements.push(createElement('title', { key: 'title' }, metadata.title));
  }
  for (const meta of metadata.meta ?? []) {
    elements.push(
      meta.name !== undefined
        ? createElement('meta', {
            content: meta.content,
            key: `meta:${metaIdentity(meta)}`,
            name: meta.name,
          })
        : createElement('meta', {
            content: meta.content,
            key: `meta:${metaIdentity(meta)}`,
            property: meta.property,
          }),
    );
  }
  for (const link of metadata.links ?? []) {
    elements.push(createElement('link', {
      href: link.href,
      key: `link:${linkIdentity(link)}`,
      ...(link.media === undefined ? {} : { media: link.media }),
      rel: link.rel,
      ...(link.type === undefined ? {} : { type: link.type }),
    }));
  }

  return Object.freeze(elements);
}
