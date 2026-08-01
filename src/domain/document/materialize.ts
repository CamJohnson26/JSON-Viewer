import { assertDocument } from './invariants.ts'
import {
  getContainer,
  getNode,
  type ContainerNode,
  type JsonDocument,
  type NodeId,
} from './model.ts'

export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

export function materialize(document: JsonDocument): JsonValue {
  assertDocument(document)
  return materializeContainer(
    document,
    getContainer(document, document.rootId),
    false,
  )
}

export function serialize(document: JsonDocument, space?: number): string {
  assertDocument(document)
  const width = Math.min(10, Math.max(0, Math.trunc(space ?? 0)))
  return serializeContainer(
    document,
    getContainer(document, document.rootId),
    false,
    width,
    0,
  )
}

function materializeNode(document: JsonDocument, id: NodeId): JsonValue {
  const node = getNode(document, id)
  return node.type === 'primitive'
    ? node.value
    : materializeContainer(document, node, true)
}

function materializeContainer(
  document: JsonDocument,
  node: ContainerNode,
  honorCaption: boolean,
): JsonValue {
  const payload = materializePayload(document, node)
  return honorCaption && node.caption !== null
    ? { [node.caption]: payload }
    : payload
}

function materializePayload(
  document: JsonDocument,
  node: ContainerNode,
): JsonValue {
  if (node.kind === 'scalar') {
    const only = getNode(document, node.childIds[0] as NodeId)
    if (only.type !== 'primitive')
      throw new Error('Scalar root child must be primitive')
    return only.value
  }
  if (
    node.caption !== null &&
    node.kindOrigin === 'inferred' &&
    node.childIds.length === 1
  ) {
    const only = getNode(document, node.childIds[0] as NodeId)
    if (only.type === 'primitive') return only.value
  }
  if (node.kind === 'object') {
    const result: { [key: string]: JsonValue } = {}
    for (const entry of node.entries) {
      const child = getContainer(document, entry.nodeId)
      Object.defineProperty(result, entry.key, {
        value: materializePayload(document, child),
        enumerable: true,
        configurable: true,
        writable: true,
      })
    }
    return result
  }
  return node.childIds.map((id) => materializeNode(document, id))
}

function serializeNode(
  document: JsonDocument,
  id: NodeId,
  width: number,
  depth: number,
): string {
  const node = getNode(document, id)
  return node.type === 'primitive'
    ? JSON.stringify(node.value)
    : serializeContainer(document, node, true, width, depth)
}

function serializeContainer(
  document: JsonDocument,
  node: ContainerNode,
  honorCaption: boolean,
  width: number,
  depth: number,
): string {
  const payload = serializePayload(document, node, width, depth)
  if (!honorCaption || node.caption === null) return payload
  const separator = width === 0 ? ':' : ': '
  return joinCollection(
    '{',
    '}',
    [`${JSON.stringify(node.caption)}${separator}${payload}`],
    width,
    depth,
  )
}

function serializePayload(
  document: JsonDocument,
  node: ContainerNode,
  width: number,
  depth: number,
): string {
  if (node.kind === 'scalar') {
    return serializeNode(document, node.childIds[0] as NodeId, width, depth)
  }
  if (
    node.caption !== null &&
    node.kindOrigin === 'inferred' &&
    node.childIds.length === 1
  ) {
    const only = getNode(document, node.childIds[0] as NodeId)
    if (only.type === 'primitive') return JSON.stringify(only.value)
  }
  if (node.kind === 'object') {
    const separator = width === 0 ? ':' : ': '
    const values = node.entries.map((entry) => {
      const child = getContainer(document, entry.nodeId)
      return `${JSON.stringify(entry.key)}${separator}${serializePayload(document, child, width, depth + 1)}`
    })
    return joinCollection('{', '}', values, width, depth)
  }
  return joinCollection(
    '[',
    ']',
    node.childIds.map((id) => serializeNode(document, id, width, depth + 1)),
    width,
    depth,
  )
}

function joinCollection(
  open: string,
  close: string,
  values: readonly string[],
  width: number,
  depth: number,
): string {
  if (values.length === 0) return `${open}${close}`
  if (width === 0) return `${open}${values.join(',')}${close}`
  const childIndent = ' '.repeat((depth + 1) * width)
  const indent = ' '.repeat(depth * width)
  return `${open}\n${childIndent}${values.join(`,\n${childIndent}`)}\n${indent}${close}`
}
