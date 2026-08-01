import type { DocumentNode, JsonDocument, NodeId } from '../document/index.ts'

export const DOMAIN_EVENT_VERSION = 1 as const

export interface EventMetadata {
  readonly eventId: string
  readonly occurredAt: string
}

export interface NodeRecordPatch {
  readonly id: NodeId
  readonly before: DocumentNode | null
  readonly after: DocumentNode | null
}

export interface DocumentPatchEvent {
  readonly version: typeof DOMAIN_EVENT_VERSION
  readonly type: 'document.patch'
  readonly metadata: EventMetadata
  readonly rootId: {
    readonly before: NodeId
    readonly after: NodeId
  }
  readonly records: readonly NodeRecordPatch[]
}

export type DomainEvent = DocumentPatchEvent

export interface EventTransaction {
  readonly version: typeof DOMAIN_EVENT_VERSION
  readonly events: readonly DomainEvent[]
}

export function createPatchEvent(
  before: JsonDocument,
  after: JsonDocument,
  metadata: EventMetadata,
): DocumentPatchEvent {
  const records: NodeRecordPatch[] = []
  const ids = new Set([
    ...(Object.keys(before.nodes) as NodeId[]),
    ...(Object.keys(after.nodes) as NodeId[]),
  ])
  for (const id of ids) {
    const previous = before.nodes[id] ?? null
    const next = after.nodes[id] ?? null
    if (!sameNodeRecord(previous, next))
      records.push({ id, before: previous, after: next })
  }
  return {
    version: DOMAIN_EVENT_VERSION,
    type: 'document.patch',
    metadata,
    rootId: { before: before.rootId, after: after.rootId },
    records,
  }
}

export function sameNodeRecord(
  before: DocumentNode | null,
  after: DocumentNode | null,
): boolean {
  if (before === after) return true
  if (before === null || after === null || before.type !== after.type)
    return false
  if (before.type === 'primitive' && after.type === 'primitive') {
    return (
      before.id === after.id &&
      before.sourceInput === after.sourceInput &&
      Object.is(before.value, after.value) &&
      before.detectedKind === after.detectedKind &&
      before.formatting === after.formatting
    )
  }
  if (before.type !== 'container' || after.type !== 'container') return false
  return (
    before.id === after.id &&
    before.caption === after.caption &&
    before.kind === after.kind &&
    before.kindOrigin === after.kindOrigin &&
    sameIds(before.childIds, after.childIds) &&
    before.entries.length === after.entries.length &&
    before.entries.every((entry, index) => {
      const next = after.entries[index]
      return next?.key === entry.key && next.nodeId === entry.nodeId
    })
  )
}

function sameIds(before: readonly NodeId[], after: readonly NodeId[]): boolean {
  return (
    before.length === after.length &&
    before.every((id, index) => after[index] === id)
  )
}

export function invertEvent(event: DomainEvent): DomainEvent {
  return {
    ...event,
    rootId: { before: event.rootId.after, after: event.rootId.before },
    records: event.records.map(({ id, before, after }) => ({
      id,
      before: after,
      after: before,
    })),
  }
}

export function invertTransaction(
  transaction: EventTransaction,
): EventTransaction {
  return {
    version: DOMAIN_EVENT_VERSION,
    events: [...transaction.events].reverse().map(invertEvent),
  }
}
