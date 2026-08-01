import { nodeId, type NodeIdFactory } from '../domain/document/index.ts'

export const createNodeId: NodeIdFactory = () => nodeId(crypto.randomUUID())
