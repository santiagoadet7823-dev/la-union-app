/** UUID v4 con fallback si el WebView no expone crypto.randomUUID. */
export function uid() {
  try { if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID() } catch (_) {}
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}
