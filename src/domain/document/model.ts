import { createNodeTable } from './node-table.ts'

export type NodeId = string & { readonly __nodeId: unique symbol }

export type JsonPrimitive = string | number | boolean | null
export type PrimitiveKind =
  'string' | 'number' | 'boolean' | 'null' | 'date' | 'datetime'
export type FormattingOverride = 'inherit' | 'formatted' | 'source'
export type ContainerKind = 'neutral' | 'scalar' | 'array' | 'object'
export type KindOrigin =
  'neutral' | 'inferred' | 'inferred-ordered' | 'imported'

export interface PrimitiveNode {
  readonly id: NodeId
  readonly type: 'primitive'
  readonly sourceInput: string
  readonly value: JsonPrimitive
  readonly detectedKind: PrimitiveKind
  readonly formatting: FormattingOverride
}

export interface KeyedEntry {
  readonly key: string
  readonly nodeId: NodeId
}

export interface ContainerNode {
  readonly id: NodeId
  readonly type: 'container'
  readonly caption: string | null
  readonly kind: ContainerKind
  readonly kindOrigin: KindOrigin
  readonly childIds: readonly NodeId[]
  readonly entries: readonly KeyedEntry[]
}

export type DocumentNode = PrimitiveNode | ContainerNode

export interface JsonDocument {
  readonly rootId: NodeId
  readonly nodes: Readonly<Record<NodeId, DocumentNode>>
}

const structureTokens = new WeakMap<JsonDocument, object>()

export type NodeIdFactory = () => NodeId

export function nodeId(value: string): NodeId {
  if (value.length === 0) throw new Error('A node ID cannot be empty')
  return value as NodeId
}

export function createBlankDocument(id: NodeId): JsonDocument {
  const root: ContainerNode = {
    id,
    type: 'container',
    caption: null,
    kind: 'neutral',
    kindOrigin: 'neutral',
    childIds: [],
    entries: [],
  }
  return { rootId: id, nodes: createNodeTable({ [id]: root }) }
}

export function documentStructureToken(document: JsonDocument): object {
  return structureTokens.get(document) ?? document
}

export function inheritDocumentStructure(
  document: JsonDocument,
  previous: JsonDocument,
  changed: boolean,
): JsonDocument {
  structureTokens.set(document, changed ? {} : documentStructureToken(previous))
  return document
}

export function getNode(document: JsonDocument, id: NodeId): DocumentNode {
  const value = document.nodes[id]
  if (!value) throw new Error(`Unknown node: ${id}`)
  return value
}

export function getContainer(
  document: JsonDocument,
  id: NodeId,
): ContainerNode {
  const value = getNode(document, id)
  if (value.type !== 'container')
    throw new Error(`Node is not a container: ${id}`)
  return value
}
