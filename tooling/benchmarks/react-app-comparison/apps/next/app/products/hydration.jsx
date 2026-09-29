'use client';

import { useEffect, useState } from 'react';

export default function HydrationSignal() {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return <span hidden data-benchmark-hydrated={hydrated} />;
}
