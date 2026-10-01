import { createElement, useEffect, useRef, useState } from 'react';

/** A live shell-owned MessageChannel with acknowledgements after every operation. */
export function ResourceProbe() {
  const channel = useRef<MessageChannel | null>(null);
  const [identity, setIdentity] = useState('');
  const [acknowledgement, setAcknowledgement] = useState('');
  useEffect(() => {
    const session = new MessageChannel();
    const id = crypto.randomUUID();
    let operations = 0;
    channel.current = session;
    session.port2.onmessage = (event: MessageEvent<string>) => {
      operations++;
      session.port2.postMessage(`${id}:${operations}:${event.data}`);
    };
    session.port1.onmessage = (event: MessageEvent<string>) => setAcknowledgement(event.data);
    setIdentity(id);
    document.dispatchEvent(new CustomEvent('fluo-resource', { detail: { phase: 'mount', id, ports: [session.port1, session.port2] } }));
    return () => {
      channel.current = null;
      session.port1.close();
      session.port2.close();
      document.dispatchEvent(new CustomEvent('fluo-resource', { detail: { phase: 'cleanup', id, ports: [session.port1, session.port2] } }));
    };
  }, []);
  return createElement('div', { 'data-resource-id': identity },
    createElement('button', {
      onClick: () => channel.current?.port1.postMessage('ack'),
      type: 'button',
    }, 'Probe shell resource'),
    createElement('output', { 'aria-label': 'Resource acknowledgement' }, acknowledgement),
  );
}
