function preserveTtyColorDetection(stream: NodeJS.WriteStream): void {
  try {
    Object.defineProperty(stream, 'isTTY', {
      configurable: true,
      value: true,
    });
  } catch (_error: unknown) {
    return;
  }
}

preserveTtyColorDetection(process.stdout);
preserveTtyColorDetection(process.stderr);
