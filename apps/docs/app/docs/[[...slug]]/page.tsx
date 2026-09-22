import { getMDXComponents } from '@/components/mdx';
import { source } from '@/lib/source';
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/layouts/docs/page';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export default async function Page(props: PageProps<'/docs/[[...slug]]'>) {
  const params = await props.params;
  const page = source.getPage(params.slug);

  if (!page) {
    notFound();
  }

  const MDX = page.data.body;
  const packageName = page.data.package;
  const packageManifest: { version: string } | undefined = packageName
    ? JSON.parse(await readFile(
        path.resolve(process.cwd(), '../../packages', packageName.slice('@fluojs/'.length), 'package.json'),
        'utf8',
      ))
    : undefined;

  return (
    <DocsPage toc={page.data.toc}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      {packageName && packageManifest && (
        <p className="text-sm text-fd-muted-foreground">
          <code>{packageName}</code> · Source version {packageManifest.version}.
          {' '}Check your installed release when following examples.
        </p>
      )}
      <DocsBody>
        <MDX components={getMDXComponents()} />
      </DocsBody>
    </DocsPage>
  );
}

export async function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(props: PageProps<'/docs/[[...slug]]'>): Promise<Metadata> {
  const params = await props.params;
  const page = source.getPage(params.slug);

  if (!page) {
    notFound();
  }

  return {
    title: page.data.title,
    description: page.data.description,
  };
}
