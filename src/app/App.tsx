import { useState } from 'react'

import { EditorStatus } from '../components/layout/EditorStatus.tsx'
import { EditorTree } from '../components/tree/EditorTree.tsx'
import { createBlankDocument } from '../domain/document/index.ts'
import { createEventMetadata, createNodeId } from '../infrastructure/index.ts'
import { createDocumentStore, type DocumentStore } from '../state/store.ts'

export interface AppProps {
  readonly store?: DocumentStore
}

function createProductionStore(): DocumentStore {
  const rootId = createNodeId()
  return createDocumentStore(createBlankDocument(rootId), {
    createId: createNodeId,
    createEventMetadata,
  })
}

export function App({ store: injectedStore }: AppProps) {
  const [store] = useState(() => injectedStore ?? createProductionStore())
  const [status, setStatus] = useState('Ready')

  return (
    <div className="app-shell">
      <main aria-label="JSON editor" className="editor-canvas">
        <EditorTree onStatus={setStatus} store={store} />
      </main>
      <EditorStatus message={status} />
    </div>
  )
}
