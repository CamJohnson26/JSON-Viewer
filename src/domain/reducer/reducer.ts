import {
  assertDocument,
  inheritDocumentStructure,
  isPrimitiveNodeValid,
  patchNodeTable,
  type JsonDocument,
} from '../document/index.ts'
import {
  DOMAIN_EVENT_VERSION,
  sameNodeRecord,
  type DomainEvent,
  type EventTransaction,
} from '../events/index.ts'

export function reduceDocument(
  document: JsonDocument,
  event: DomainEvent,
): JsonDocument {
  if (
    event.version !== DOMAIN_EVENT_VERSION ||
    event.type !== 'document.patch'
  ) {
    throw new Error('Unsupported domain event')
  }
  if (
    typeof event.metadata.eventId !== 'string' ||
    event.metadata.eventId.length === 0 ||
    typeof event.metadata.occurredAt !== 'string' ||
    event.metadata.occurredAt.length === 0
  ) {
    throw new Error('Domain event metadata is incomplete')
  }
  if (document.rootId !== event.rootId.before) {
    throw new Error('Event root does not match the current document')
  }
  const ids = new Set<string>()
  for (const patch of event.records) {
    if (ids.has(patch.id)) {
      throw new Error(`Domain event patches a node more than once: ${patch.id}`)
    }
    ids.add(patch.id)
    if (patch.before !== null && patch.before.id !== patch.id) {
      throw new Error(`Event before record has the wrong ID: ${patch.id}`)
    }
    if (patch.after !== null && patch.after.id !== patch.id) {
      throw new Error(`Event after record has the wrong ID: ${patch.id}`)
    }
    if (
      patch.after?.type === 'primitive' &&
      !isPrimitiveNodeValid(patch.after)
    ) {
      throw new Error(`Event contains invalid primitive metadata: ${patch.id}`)
    }
    if (!sameNodeRecord(document.nodes[patch.id] ?? null, patch.before)) {
      throw new Error(`Event record does not match current node: ${patch.id}`)
    }
  }
  const structural =
    event.rootId.before !== event.rootId.after ||
    event.records.some(
      ({ before, after }) =>
        before === null ||
        after === null ||
        before.type === 'container' ||
        after.type === 'container',
    )
  const next = inheritDocumentStructure(
    {
      rootId: event.rootId.after,
      nodes: patchNodeTable(
        document.nodes,
        event.records.map(({ id, after }) => ({ id, after })),
      ),
    },
    document,
    structural,
  )
  if (structural) assertDocument(next)
  return next
}

export function applyTransaction(
  document: JsonDocument,
  transaction: EventTransaction,
): JsonDocument {
  if (transaction.version !== DOMAIN_EVENT_VERSION) {
    throw new Error('Unsupported event transaction')
  }
  return transaction.events.reduce(reduceDocument, document)
}

export function replayEvents(
  initial: JsonDocument,
  events: readonly DomainEvent[],
): JsonDocument {
  return events.reduce(reduceDocument, initial)
}
