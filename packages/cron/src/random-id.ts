/** Creates a platform-neutral random identifier for Cron ownership boundaries. */
export function createCronRandomId(): string {
  const randomUUID = globalThis.crypto?.randomUUID;

  if (randomUUID) {
    return randomUUID.call(globalThis.crypto);
  }

  return `cron-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
