import { createBlankDocument, nodeId } from '../../domain/document/index.ts'
import { createDocumentStore, type DocumentStore } from '../../state/store.ts'

export const editorLabels = {
  main: 'JSON editor',
  status: 'Editor status',
} as const

export function createEditorTestStore(): DocumentStore {
  let sequence = 0
  return createDocumentStore(createBlankDocument(nodeId('root')), {
    createId: () => nodeId(`node-${++sequence}`),
    createEventMetadata: () => ({
      eventId: `event-${sequence}`,
      occurredAt: '2026-08-01T00:00:00.000Z',
    }),
  })
}
