import type { ChangeEvent, Dispatch, DragEvent } from 'react';
import { parseStudioPayload, renderMermaid } from '../../../contracts.js';
import type { StudioAction } from '../../../entities/studio/actions.js';
import type { StudioDashboardState } from '../../../entities/studio/model.js';
import { selectStaticSnapshot } from '../../../entities/studio/model.js';

interface FileDropZoneProps {
  dispatch: Dispatch<StudioAction>;
  state: StudioDashboardState;
}

function downloadTextFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function copyToClipboard(text: string): Promise<void> {
  if (!navigator.clipboard) {
    throw new Error('Clipboard API is unavailable.');
  }

  await navigator.clipboard.writeText(text);
}

/**
 * Provides File Drop Zone behavior for the Studio devtool.
 */
export function FileDropZone({ dispatch, state }: FileDropZoneProps) {
  const snapshot = selectStaticSnapshot(state);
  const rawJson = state.staticReport.rawJson;

  async function handleFile(file: File): Promise<void> {
    const raw = await file.text();
    try {
      dispatch({
        message: 'Diagnostics file loaded successfully.',
        parsed: parseStudioPayload(raw),
        type: 'static-payload',
      });
    } catch (error) {
      dispatch({
        message: error instanceof Error ? error.message : 'Failed to parse diagnostics file.',
        type: 'file-error',
      });
    }
  }

  async function handleInput(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    if (file) {
      await handleFile(file);
    }
  }

  async function handleDrop(event: DragEvent<HTMLElement>): Promise<void> {
    event.preventDefault();
    event.currentTarget.classList.remove('drag-active');
    const file = event.dataTransfer.files[0];
    if (file) {
      await handleFile(file);
    }
  }

  async function copyJson(): Promise<void> {
    if (!rawJson) {
      return;
    }

    try {
      await copyToClipboard(rawJson);
      dispatch({ connection: { message: 'Loaded JSON copied to clipboard.', status: 'static' }, type: 'connection' });
    } catch (error) {
      dispatch({ connection: { message: error instanceof Error ? error.message : 'Failed to copy JSON.', status: 'error' }, type: 'connection' });
    }
  }

  async function copyMermaid(): Promise<void> {
    if (!snapshot) {
      return;
    }

    try {
      await copyToClipboard(renderMermaid(snapshot));
      dispatch({ connection: { message: 'Mermaid copied to clipboard.', status: 'static' }, type: 'connection' });
    } catch (error) {
      dispatch({ connection: { message: error instanceof Error ? error.message : 'Failed to copy Mermaid text.', status: 'error' }, type: 'connection' });
    }
  }

  return (
    <section
      className="card uploader"
      id="drop-zone"
      onDragLeave={(event) => event.currentTarget.classList.remove('drag-active')}
      onDragOver={(event) => {
        event.preventDefault();
        event.currentTarget.classList.add('drag-active');
      }}
      onDrop={(event) => void handleDrop(event)}
    >
      <div className="section-title-row">
        <div>
          <p className="eyebrow">Compatibility mode</p>
          <h2>Diagnostics file input</h2>
        </div>
        <span className="mode-badge">static/report JSON</span>
      </div>
      <p>Drag & drop a JSON file, or choose one manually. Live mode remains the primary path through <code>fluo dev --studio</code>.</p>
      <input type="file" id="file-input" accept="application/json" onChange={(event) => void handleInput(event)} />
      <div className="actions">
        <button disabled={!rawJson} onClick={() => rawJson && downloadTextFile('fluo-diagnostics.json', rawJson)} type="button">Download loaded JSON</button>
        <button disabled={!rawJson} onClick={() => void copyJson()} type="button">Copy loaded JSON</button>
        <button disabled={!snapshot} onClick={() => void copyMermaid()} type="button">Copy Mermaid</button>
      </div>
      {state.message ? <p className="notice">{state.message}</p> : null}
    </section>
  );
}
