import { useRef, useSyncExternalStore } from 'react'

import type { DocumentStore, DocumentStoreSnapshot } from './store.ts'

export function useDocumentStore(store: DocumentStore): DocumentStoreSnapshot {
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  )
}

export function useDocumentSelector<T>(
  store: DocumentStore,
  selector: (snapshot: DocumentStoreSnapshot) => T,
): T {
  const cache = useRef<{
    snapshot: DocumentStoreSnapshot
    selector: typeof selector
    value: T
  }>(undefined)
  const getSelectedSnapshot = (): T => {
    const snapshot = store.getSnapshot()
    if (
      cache.current?.snapshot === snapshot &&
      cache.current.selector === selector
    )
      return cache.current.value
    const selected = selector(snapshot)
    const value =
      cache.current !== undefined && Object.is(cache.current.value, selected)
        ? cache.current.value
        : selected
    cache.current = { snapshot, selector, value }
    return value
  }
  return useSyncExternalStore(
    store.subscribe,
    getSelectedSnapshot,
    getSelectedSnapshot,
  )
}
