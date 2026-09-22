import { defineDocs } from 'fumadocs-mdx/config';
import { pageSchema } from 'fumadocs-core/source/schema';

export const docs = defineDocs({
  dir: 'content/docs',
  docs: {
    schema: pageSchema.extend({
      package: pageSchema.shape.title.regex(/^@fluojs\/[a-z0-9.-]+$/).optional(),
    }),
  },
});
