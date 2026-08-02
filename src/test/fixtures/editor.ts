import {
  createBlankDocument,
  nodeId,
  type JsonDocument,
} from '../../domain/document/index.ts'
import { createDocumentStore, type DocumentStore } from '../../state/store.ts'

export const editorLabels = {
  main: 'JSON editor',
  status: 'Editor status',
} as const

export function createEditorTestStore(
  document: JsonDocument = createBlankDocument(nodeId('root')),
): DocumentStore {
  let sequence = 0
  return createDocumentStore(document, {
    createId: () => nodeId(`node-${++sequence}`),
    createEventMetadata: () => ({
      eventId: `event-${sequence}`,
      occurredAt: '2026-08-01T00:00:00.000Z',
    }),
    createUuid: () =>
      `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
    createTimestamp: () => '2026-08-01T00:00:00.000Z',
  })
}
