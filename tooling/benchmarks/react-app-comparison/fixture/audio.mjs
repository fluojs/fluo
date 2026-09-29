// The same local one-second tone is used by each comparison app without a remote asset.
export function createToneUrl() {
  const sampleRate = 8000;
  const samples = sampleRate;
  const bytes = new ArrayBuffer(44 + samples * 2);
  const wav = new DataView(bytes);
  for (const [offset, label] of [[0, 'RIFF'], [8, 'WAVE'], [12, 'fmt '], [36, 'data']]) {
    for (let index = 0; index < label.length; index += 1) wav.setUint8(offset + index, label.charCodeAt(index));
  }
  wav.setUint32(4, bytes.byteLength - 8, true);
  wav.setUint32(16, 16, true);
  wav.setUint16(20, 1, true);
  wav.setUint16(22, 1, true);
  wav.setUint32(24, sampleRate, true);
  wav.setUint32(28, sampleRate * 2, true);
  wav.setUint16(32, 2, true);
  wav.setUint16(34, 16, true);
  wav.setUint32(40, samples * 2, true);
  for (let index = 0; index < samples; index += 1) {
    wav.setInt16(44 + index * 2, Math.round(Math.sin(index * 2 * Math.PI * 440 / sampleRate) * 2800), true);
  }
  return URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
}
