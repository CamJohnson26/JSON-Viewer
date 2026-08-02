export async function readClipboardText(): Promise<string> {
  if (!navigator.clipboard?.readText)
    throw new Error('Clipboard reading is not available')
  try {
    return await navigator.clipboard.readText()
  } catch {
    throw new Error('Clipboard permission was denied')
  }
}

export async function writeClipboardText(text: string): Promise<void> {
  if (!navigator.clipboard?.writeText)
    throw new Error('Clipboard writing is not available')
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    throw new Error('Clipboard permission was denied')
  }
}
