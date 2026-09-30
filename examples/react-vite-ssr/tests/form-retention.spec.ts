import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { build } from 'vite';
import type { ClientFormStore } from '../../../packages/react/src/client/form-store';

declare global {
  interface Window {
    readonly FluoFormRetention: {
      readonly createClientFormStore: () => ClientFormStore;
    };
  }
}

let output: string;
test.beforeAll(async () => {
  output = await mkdtemp(join(tmpdir(), 'fluo-form-retention-'));
  await build({
    configFile: false,
    publicDir: false,
    logLevel: 'silent',
    build: {
      outDir: output,
      emptyOutDir: true,
      lib: {
        entry: process.env.FLUO_FORM_RETENTION_SOURCE
          ?? fileURLToPath(new URL('../../../packages/react/src/client/form-store.ts', import.meta.url)),
        name: 'FluoFormRetention',
        formats: ['iife'],
        fileName: () => 'form-retention.js',
      },
    },
  });
});
test.afterAll(async () => {
  if (output !== undefined) await rm(output, { recursive: true, force: true });
});

for (const selected of [[], [''], ['a', 'b'], ['a', 'a', 'b']]) {
  test(`retains native multiple-select submission values ${JSON.stringify(selected)}`, async ({ page }) => {
    // Given: the actual form store and native browser DOM, not a DOM-model FormData.
    await page.setContent('<main>Form retention regression</main>');
    await page.addScriptTag({ path: join(output, 'form-retention.js') });
    const observed = await page.evaluate((selected) => {
      const store = window.FluoFormRetention.createClientFormStore();
      const options = '<option value="">Empty</option><option value="a">A</option><option value="a">Another A</option><option value="b">B</option><option value="c" selected>C</option>';
      const original = document.createElement('form');
      original.innerHTML = `<select name="tag" multiple>${options}</select>`;
      document.body.append(original);
      const remaining = [...selected];
      for (const option of original.querySelectorAll('option')) {
        const index = remaining.indexOf(option.value);
        option.selected = index !== -1;
        if (index !== -1) remaining.splice(index, 1);
      }
      const before = new FormData(original).getAll('tag');
      store.attach(original);
      store.remember();
      const replacement = document.createElement('form');
      replacement.innerHTML = `<select name="tag" multiple>${options}</select>`;
      document.body.append(replacement);

      // When: retained input attaches to a new form element.
      store.attach(replacement);
      return {
        before,
        selected: Array.from(replacement.querySelectorAll('option'))
          .filter((option) => option.selected).map((option) => option.value),
        submitted: new FormData(replacement).getAll('tag'),
      };
    }, selected);

    // Then: both actual options and every successful-control value survive.
    expect(observed).toEqual({ before: selected, selected, submitted: selected });
  });
}
