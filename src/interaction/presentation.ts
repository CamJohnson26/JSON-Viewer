export function presentEditorMessage(message: string): string {
  return message
    .replace(/\bobjects?\b/gi, 'named JSON')
    .replace(/\barrays?\b/gi, 'ordered JSON')
    .replace(/\bcontainers?\b/gi, 'headers')
    .replace(/\bcollections?\b/gi, 'headers')
    .replace(/\bkeys?\b/gi, 'captions')
}
