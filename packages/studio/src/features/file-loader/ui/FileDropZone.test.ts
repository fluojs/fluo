// @vitest-environment happy-dom

import { act, createElement, useReducer } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initialStudioState } from '../../../entities/studio/model.js';
import { studioReducer } from '../../live-connection/model/reducer.js';
import { FileDropZone } from './FileDropZone.js';

let root: Root | undefined;

afterEach(() => {
  vi.unstubAllGlobals();
  root?.unmount();
  root = undefined;
  document.body.innerHTML = '';
});

function FileDropZoneHarness() {
  const [state, dispatch] = useReducer(studioReducer, initialStudioState);

  return createElement(
    'div',
    undefined,
    createElement(FileDropZone, { dispatch, state }),
    createElement('output', { id: 'loaded-json' }, state.staticReport.rawJson),
  );
}

function renderFileDropZone(): void {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.body.innerHTML = '<div id="app"></div>';
  const app = document.querySelector<HTMLDivElement>('#app');
  if (!app) {
    throw new Error('Expected the Studio app root to be rendered.');
  }

  const renderedRoot = createRoot(app);
  root = renderedRoot;
  act(() => {
    renderedRoot.render(createElement(FileDropZoneHarness));
  });
}

function getFileInput(): HTMLInputElement {
  const fileInput = document.querySelector<HTMLInputElement>('#file-input');
  if (!fileInput) {
    throw new Error('Expected the Studio file input to be rendered.');
  }

  return fileInput;
}

function selectFile(fileInput: HTMLInputElement, file: File): void {
  Object.defineProperty(fileInput, 'files', {
    configurable: true,
    value: [file],
  });
  fileInput.dispatchEvent(new Event('change', { bubbles: true }));
}

function staticPayload(componentId: string): string {
  return JSON.stringify({
    components: [
      {
        dependencies: [],
        details: {},
        health: { status: 'healthy' },
        id: componentId,
        kind: 'queue',
        ownership: {
          externallyManaged: false,
          ownsResources: true,
        },
        readiness: {
          critical: true,
          status: 'ready',
        },
        state: 'ready',
        telemetry: {
          namespace: 'fluo.test',
          tags: {},
        },
      },
    ],
    diagnostics: [],
    generatedAt: '2026-08-30T00:00:00.000Z',
    health: { status: 'healthy' },
    readiness: {
      critical: true,
      status: 'ready',
    },
  });
}

describe('FileDropZone', () => {
  it('shows a file read failure when the selected diagnostics file is unreadable', async () => {
    // Given
    renderFileDropZone();
    let rejectRead = (_error: Error): void => {};
    const unreadableFile = new File([], 'unreadable.json', { type: 'application/json' });
    Object.defineProperty(unreadableFile, 'text', {
      value: () => new Promise<string>((_resolve, reject) => {
        rejectRead = reject;
      }),
    });

    // When
    await act(async () => {
      selectFile(getFileInput(), unreadableFile);
      rejectRead(new Error('File access was denied.'));
      await Promise.resolve();
    });

    // Then
    expect(document.querySelector('#drop-zone')?.textContent).toContain('File access was denied.');
  });

  it('keeps the most recently selected diagnostics file when older reads resolve later', async () => {
    // Given
    renderFileDropZone();
    let resolveOlderRead = (_content: string): void => {};
    const olderFile = new File([], 'older.json', { type: 'application/json' });
    Object.defineProperty(olderFile, 'text', {
      value: () => new Promise<string>((resolve) => {
        resolveOlderRead = resolve;
      }),
    });
    let resolveNewerRead = (_content: string): void => {};
    const newerFile = new File([], 'newer.json', { type: 'application/json' });
    Object.defineProperty(newerFile, 'text', {
      value: () => new Promise<string>((resolve) => {
        resolveNewerRead = resolve;
      }),
    });
    const newerPayload = staticPayload('newer.default');

    // When
    await act(async () => {
      selectFile(getFileInput(), olderFile);
      selectFile(getFileInput(), newerFile);
      resolveNewerRead(newerPayload);
      await Promise.resolve();
    });
    await act(async () => {
      resolveOlderRead(staticPayload('stale.default'));
      await Promise.resolve();
    });

    // Then
    expect(document.querySelector('#loaded-json')?.textContent).toBe(newerPayload);
  });
});
