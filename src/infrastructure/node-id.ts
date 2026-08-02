import { nodeId, type NodeIdFactory } from '../domain/document/index.ts'
import type { EventMetadata } from '../domain/events/index.ts'

export const createNodeId: NodeIdFactory = () => nodeId(crypto.randomUUID())

export const createUuid = (): string => crypto.randomUUID()

export const createTimestamp = (): string => new Date().toISOString()

export function createEventMetadata(): EventMetadata {
  return {
    eventId: createUuid(),
    occurredAt: createTimestamp(),
  }
}
