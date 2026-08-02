import { nodeId, type NodeIdFactory } from '../domain/document/index.ts'
import type { EventMetadata } from '../domain/events/index.ts'

export const createNodeId: NodeIdFactory = () => nodeId(crypto.randomUUID())

export function createEventMetadata(): EventMetadata {
  return {
    eventId: crypto.randomUUID(),
    occurredAt: new Date().toISOString(),
  }
}
