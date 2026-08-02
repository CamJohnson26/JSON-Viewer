import { useEffect } from 'react'

import type { JsonDocument, NodeId } from '../../domain/document/index.ts'
import { serializeSelection } from '../../domain/operations/index.ts'
import {
  readClipboardText,
  writeClipboardText,
} from '../../infrastructure/index.ts'
import { presentEditorMessage } from '../../interaction/presentation.ts'
import { selectValidRoots } from '../../state/selectors.ts'
import type { DocumentStore } from '../../state/store.ts'

type PasteMode = 'automatic' | 'into' | 'beside' | 'replace'

export interface EditorClipboard {
  readonly copy: () => Promise<string | null>
  readonly paste: (mode?: PasteMode) => Promise<string | null>
  readonly pasteText: (source: string, mode?: PasteMode) => string | null
}

export function useEditorClipboard({
  store,
  document,
  selectedIds,
  activeId,
  treeElement,
  onApplied,
  onStatus,
  onError,
}: {
  readonly store: DocumentStore
  readonly document: JsonDocument
  readonly selectedIds: readonly NodeId[]
  readonly activeId: NodeId
  readonly treeElement: HTMLElement | null
  readonly onApplied: (focusId: NodeId, selectedIds?: readonly NodeId[]) => void
  readonly onStatus: (message: string) => void
  readonly onError: (message: string | null) => void
}): EditorClipboard {
  const copyText = (): string | null => {
    const result = serializeSelection(
      document,
      selectValidRoots(document, selectedIds),
      2,
    )
    if (!result.ok) {
      onStatus(presentEditorMessage(result.error.message))
      return null
    }
    return result.text
  }

  const applyPaste = (source: string, mode: PasteMode): string | null => {
    const target = document.nodes[activeId]
    if (!target) return 'The paste target is unavailable'
    const type =
      mode === 'automatic'
        ? target.type === 'container'
          ? 'json.pasteInto'
          : 'json.pasteBeside'
        : mode === 'into'
          ? 'json.pasteInto'
          : mode === 'beside'
            ? 'json.pasteBeside'
            : 'json.pasteReplace'
    const result = store.execute({
      version: 1,
      expectedRevision: store.getSnapshot().revision,
      type,
      targetId: activeId,
      source,
    })
    if (!result.ok) {
      const message = presentEditorMessage(result.error.message)
      onError(message)
      onStatus(message)
      return message
    }
    if (result.status === 'applied') {
      onError(null)
      onApplied(result.focusId, result.selectedIds)
      onStatus('Pasted JSON')
    }
    return null
  }

  useEffect(() => {
    if (!treeElement) return
    const copy = (event: ClipboardEvent): void => {
      if (isTextEntry(event.target)) return
      const text = copyText()
      if (text === null || !event.clipboardData) return
      event.preventDefault()
      event.clipboardData.setData('text/plain', text)
      onStatus('Copied selection')
    }
    const paste = (event: ClipboardEvent): void => {
      if (isTextEntry(event.target)) return
      const source = event.clipboardData?.getData('text/plain')
      if (!source) return
      event.preventDefault()
      applyPaste(source, 'automatic')
    }
    treeElement.addEventListener('copy', copy)
    treeElement.addEventListener('paste', paste)
    return () => {
      treeElement.removeEventListener('copy', copy)
      treeElement.removeEventListener('paste', paste)
    }
  })

  return {
    copy: async () => {
      const text = copyText()
      if (text === null) return 'The selection could not be copied'
      try {
        await writeClipboardText(text)
        onStatus('Copied selection')
        return null
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Copy failed'
        onStatus(message)
        return message
      }
    },
    paste: async (mode = 'automatic') => {
      try {
        return applyPaste(await readClipboardText(), mode)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Paste failed'
        onError(message)
        onStatus(message)
        return message
      }
    },
    pasteText: (source, mode = 'automatic') => applyPaste(source, mode),
  }
}

function isTextEntry(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  )
}
