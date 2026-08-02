import {
  buildParentLookup,
  getNode,
  type ContainerNode,
  type JsonDocument,
  type JsonValue,
  type NodeId,
} from '../document/index.ts'
import type { OperationError } from './types.ts'
import { MAX_OPERATION_DEPTH } from './validation.ts'

export type ClipboardContext =
  'single-value' | 'keyed-fragment' | 'ordered-array'

export const CLIPBOARD_CONTEXT_TABLE = {
  single: 'single-value',
  uniqueCaptionedSiblings: 'keyed-fragment',
  orderedOrMixed: 'ordered-array',
} as const satisfies Record<string, ClipboardContext>

export type ClipboardResult =
  | {
      readonly ok: true
      readonly context: ClipboardContext
      readonly value: JsonValue
      readonly text: string
    }
  | { readonly ok: false; readonly error: OperationError }

export type BulkClipboardPart = 'captions' | 'values'

export type BulkClipboardResult =
  | { readonly ok: true; readonly value: JsonValue; readonly text: string }
  | { readonly ok: false; readonly error: OperationError }

export function serializeSelection(
  document: JsonDocument,
  selectedIds: readonly NodeId[],
  space?: number,
): ClipboardResult {
  const checked = validateSelection(document, selectedIds)
  if (!checked.ok) return checked
  const ordered = checked.ids
  let context: ClipboardContext
  let value: JsonValue
  let keyedText: string | undefined
  if (ordered.length === 1) {
    context = CLIPBOARD_CONTEXT_TABLE.single
    value = nodePayload(document, ordered[0] as NodeId)
  } else if (areUniqueCaptionedSiblings(document, ordered)) {
    context = CLIPBOARD_CONTEXT_TABLE.uniqueCaptionedSiblings
    const fragment = jsonObject()
    for (const id of ordered) {
      const node = getNode(document, id) as ContainerNode
      Object.defineProperty(fragment, node.caption as string, {
        value: nodePayload(document, id),
        enumerable: true,
        configurable: true,
        writable: true,
      })
    }
    value = fragment
    keyedText = serializeKeyedFragment(document, ordered, space)
  } else {
    context = CLIPBOARD_CONTEXT_TABLE.orderedOrMixed
    value = ordered.map((id) => nodeValueWithCaption(document, id))
  }
  return {
    ok: true,
    context,
    value,
    text: keyedText ?? JSON.stringify(value, null, space),
  }
}

export function serializeObjectParts(
  document: JsonDocument,
  selectedIds: readonly NodeId[],
  part: BulkClipboardPart,
  space?: number,
): BulkClipboardResult {
  const checked = validateSelection(document, selectedIds)
  if (!checked.ok) return checked
  const values: JsonValue[] = []
  for (const id of checked.ids) {
    const node = document.nodes[id]
    if (node?.type !== 'container' || node.kind !== 'object')
      return failed(
        'IncompatibleSelection',
        'Bulk copy requires object headers',
        id,
      )
    for (const entry of node.entries)
      values.push(
        part === 'captions' ? entry.key : nodePayload(document, entry.nodeId),
      )
  }
  const width = Math.min(10, Math.max(0, Math.trunc(space ?? 0)))
  return { ok: true, value: values, text: JSON.stringify(values, null, width) }
}

function serializeKeyedFragment(
  document: JsonDocument,
  ids: readonly NodeId[],
  space?: number,
): string {
  const width = Math.min(10, Math.max(0, Math.trunc(space ?? 0)))
  if (width === 0) {
    return `{${ids
      .map((id) => {
        const node = getNode(document, id) as ContainerNode
        return `${JSON.stringify(node.caption)}:${JSON.stringify(nodePayload(document, id))}`
      })
      .join(',')}}`
  }
  const indent = ' '.repeat(width)
  const entries = ids.map((id) => {
    const node = getNode(document, id) as ContainerNode
    const payload = JSON.stringify(
      nodePayload(document, id),
      null,
      width,
    ).replace(/\n/g, `\n${indent}`)
    return `${indent}${JSON.stringify(node.caption)}: ${payload}`
  })
  return `{\n${entries.join(',\n')}\n}`
}

function validateSelection(
  document: JsonDocument,
  selectedIds: unknown,
):
  | { readonly ok: true; readonly ids: readonly NodeId[] }
  | { readonly ok: false; readonly error: OperationError } {
  if (!validSelectedIds(selectedIds))
    return failed(
      'InvalidOperation',
      'Selected IDs must be an array of non-empty strings',
    )
  if (selectedIds.length === 0)
    return failed('EmptySelection', 'Select at least one node')
  if (new Set(selectedIds).size !== selectedIds.length)
    return failed('OverlappingSelection', 'Selection contains duplicate IDs')
  for (const id of selectedIds)
    if (!document.nodes[id])
      return failed('UnknownSelection', `Unknown selected node: ${id}`, id)
  const parents = buildParentLookup(document)
  const selected = new Set(selectedIds)
  for (const id of selectedIds) {
    let parent = parents.get(id)
    while (parent) {
      if (selected.has(parent.parentId))
        return failed(
          'OverlappingSelection',
          'Selection contains an ancestor and descendant',
          id,
        )
      parent = parents.get(parent.parentId)
    }
  }
  const order = preorder(document)
  const stack = selectedIds.map((id) => ({ id, depth: 0 }))
  while (stack.length > 0) {
    const current = stack.pop() as { id: NodeId; depth: number }
    if (current.depth > MAX_OPERATION_DEPTH)
      return failed(
        'ResourceLimit',
        'Clipboard selection exceeds maximum depth',
      )
    const node = document.nodes[current.id]
    if (node?.type === 'container')
      for (const childId of node.childIds)
        stack.push({ id: childId, depth: current.depth + 1 })
  }
  return {
    ok: true,
    ids: [...selectedIds].sort(
      (a, b) => (order.get(a) as number) - (order.get(b) as number),
    ),
  }
}

function validSelectedIds(value: unknown): value is readonly NodeId[] {
  return (
    Array.isArray(value) &&
    value.every((id: unknown) => typeof id === 'string' && id.length > 0)
  )
}

function areUniqueCaptionedSiblings(
  document: JsonDocument,
  ids: readonly NodeId[],
): boolean {
  const parents = buildParentLookup(document)
  const parentId = parents.get(ids[0] as NodeId)?.parentId
  if (!parentId || !ids.every((id) => parents.get(id)?.parentId === parentId))
    return false
  const parent = document.nodes[parentId]
  if (parent?.type !== 'container' || parent.kind !== 'object') return false
  const captions = ids.map((id) => {
    const node = document.nodes[id]
    return node?.type === 'container' ? node.caption : null
  })
  return (
    captions.every((caption): caption is string => caption !== null) &&
    new Set(captions).size === captions.length &&
    ids.every((id) =>
      parent.entries.some(
        (entry) =>
          entry.nodeId === id &&
          entry.key === (document.nodes[id] as ContainerNode).caption,
      ),
    )
  )
}

export function nodePayload(document: JsonDocument, id: NodeId): JsonValue {
  const node = getNode(document, id)
  if (node.type === 'primitive') return node.value
  if (node.kind === 'scalar')
    return nodePayload(document, node.childIds[0] as NodeId)
  if (
    node.caption !== null &&
    node.kindOrigin === 'inferred' &&
    node.childIds.length === 1
  ) {
    const only = getNode(document, node.childIds[0] as NodeId)
    if (only.type === 'primitive') return only.value
  }
  if (node.kind === 'object') {
    const result = jsonObject()
    for (const entry of node.entries)
      Object.defineProperty(result, entry.key, {
        value: nodePayload(document, entry.nodeId),
        enumerable: true,
        configurable: true,
        writable: true,
      })
    return result
  }
  return node.childIds.map((childId) => {
    return nodeValueWithCaption(document, childId)
  })
}

function nodeValueWithCaption(document: JsonDocument, id: NodeId): JsonValue {
  const node = getNode(document, id)
  if (node.type !== 'container' || node.caption === null)
    return nodePayload(document, id)
  const singleton = jsonObject()
  Object.defineProperty(singleton, node.caption, {
    value: nodePayload(document, id),
    enumerable: true,
    configurable: true,
    writable: true,
  })
  return singleton
}

function jsonObject(): { [key: string]: JsonValue } {
  return Object.create(null) as { [key: string]: JsonValue }
}

function preorder(document: JsonDocument): Map<NodeId, number> {
  const result = new Map<NodeId, number>()
  const stack = [document.rootId]
  while (stack.length > 0) {
    const id = stack.pop() as NodeId
    result.set(id, result.size)
    const node = document.nodes[id]
    if (node?.type === 'container')
      for (let index = node.childIds.length - 1; index >= 0; index--) {
        const childId = node.childIds[index]
        if (childId) stack.push(childId)
      }
  }
  return result
}

function failed(
  code: OperationError['code'],
  message: string,
  nodeId?: NodeId,
): { ok: false; error: OperationError } {
  return {
    ok: false,
    error: nodeId === undefined ? { code, message } : { code, message, nodeId },
  }
}
