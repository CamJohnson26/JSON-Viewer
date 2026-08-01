import { buildParentLookup } from './invariants.ts'
import {
  getContainer,
  type ContainerNode,
  type DocumentNode,
  type JsonDocument,
  type NodeId,
} from './model.ts'

export type InferenceErrorCode =
  | 'UnknownNode'
  | 'InvalidTarget'
  | 'DuplicateCaption'
  | 'NothingToInsert'
  | 'IdCollision'
  | 'InvalidPasteRoot'

export interface InferenceError {
  readonly code: InferenceErrorCode
  readonly message: string
}

export interface TransitionSnapshot {
  readonly document: JsonDocument
  readonly focusId: NodeId
}

export type TransitionResult =
  | {
      readonly ok: true
      readonly document: JsonDocument
      readonly focusId: NodeId
      readonly inverse: TransitionSnapshot
    }
  | { readonly ok: false; readonly error: InferenceError }

export function inferContainer(
  document: JsonDocument,
  container: ContainerNode,
): ContainerNode | InferenceError {
  if (container.childIds.length === 0) {
    if (container.kindOrigin === 'imported') return container
    return { ...container, kind: 'neutral', kindOrigin: 'neutral', entries: [] }
  }
  if (container.kindOrigin === 'inferred-ordered') {
    return { ...container, kind: 'array', entries: [] }
  }
  const entries: { key: string; nodeId: NodeId }[] = []
  const keys = new Set<string>()
  for (const childId of container.childIds) {
    const child = document.nodes[childId]
    if (!child) return error('UnknownNode', `Unknown child: ${childId}`)
    if (child.type !== 'container' || child.caption === null) {
      return {
        ...container,
        kind: 'array',
        kindOrigin: 'inferred',
        entries: [],
      }
    }
    if (keys.has(child.caption))
      return error('DuplicateCaption', `Duplicate caption: ${child.caption}`)
    keys.add(child.caption)
    entries.push({ key: child.caption, nodeId: child.id })
  }
  return { ...container, kind: 'object', kindOrigin: 'inferred', entries }
}

export function insertNodes(
  document: JsonDocument,
  parentId: NodeId,
  additions: Readonly<Record<NodeId, DocumentNode>>,
  childIds: readonly NodeId[],
  focusId: NodeId = childIds[0] as NodeId,
): TransitionResult {
  const parent = document.nodes[parentId]
  if (!parent) return failed('UnknownNode', `Unknown parent: ${parentId}`)
  if (parent.type !== 'container')
    return failed('InvalidTarget', 'Children require a container target')
  for (const id of Object.keys(additions) as NodeId[]) {
    if (document.nodes[id])
      return failed('IdCollision', `Node ID already exists: ${id}`)
  }
  for (const id of childIds) {
    if (!additions[id])
      return failed('UnknownNode', `Missing inserted root: ${id}`)
  }
  const nodes = { ...document.nodes, ...additions }
  const draft: JsonDocument = {
    rootId: document.rootId,
    nodes: {
      ...nodes,
      [parentId]: { ...parent, childIds: [...parent.childIds, ...childIds] },
    },
  }
  const inferred = inferContainer(draft, getContainer(draft, parentId))
  if ('code' in inferred) return { ok: false, error: inferred }
  return success(
    document,
    parentId,
    { ...draft, nodes: { ...draft.nodes, [parentId]: inferred } },
    focusId,
  )
}

export function wrapNode(
  document: JsonDocument,
  targetId: NodeId,
  header: ContainerNode,
): TransitionResult {
  const parentResult = parentOf(document, targetId)
  if ('code' in parentResult) return { ok: false, error: parentResult }
  if (document.nodes[header.id])
    return failed('IdCollision', `Node ID already exists: ${header.id}`)
  if (header.caption === null || header.childIds.length !== 0) {
    return failed(
      'InvalidTarget',
      'A wrapper must be an empty captioned header',
    )
  }
  const parent = getContainer(document, parentResult.parentId)
  const wrapped = {
    ...header,
    childIds: [targetId],
    kind: 'array' as const,
    kindOrigin: 'inferred' as const,
  }
  const childIds = parent.childIds.map((id) =>
    id === targetId ? header.id : id,
  )
  const draft: JsonDocument = {
    rootId: document.rootId,
    nodes: {
      ...document.nodes,
      [header.id]: wrapped,
      [parent.id]: { ...parent, childIds },
    },
  }
  const inferred = inferContainer(draft, getContainer(draft, parent.id))
  if ('code' in inferred) return { ok: false, error: inferred }
  return success(
    document,
    targetId,
    { ...draft, nodes: { ...draft.nodes, [parent.id]: inferred } },
    header.id,
  )
}

export function unwrapHeader(
  document: JsonDocument,
  headerId: NodeId,
): TransitionResult {
  const header = document.nodes[headerId]
  if (!header) return failed('UnknownNode', `Unknown header: ${headerId}`)
  if (header.type !== 'container' || header.caption === null) {
    return failed('InvalidTarget', 'Only a captioned header can be unwrapped')
  }
  const parentResult = parentOf(document, headerId)
  if ('code' in parentResult) return { ok: false, error: parentResult }
  const parent = getContainer(document, parentResult.parentId)
  const childIds = [...parent.childIds]
  childIds.splice(parentResult.index, 1, ...header.childIds)
  const nodes = { ...document.nodes }
  delete nodes[headerId]
  const draft: JsonDocument = {
    rootId: document.rootId,
    nodes: { ...nodes, [parent.id]: { ...parent, childIds } },
  }
  const inferred = inferContainer(draft, getContainer(draft, parent.id))
  if ('code' in inferred) return { ok: false, error: inferred }
  const focusId = header.childIds[0]
  if (!focusId)
    return failed('NothingToInsert', 'An empty header cannot be unwrapped')
  return success(
    document,
    headerId,
    { ...draft, nodes: { ...draft.nodes, [parent.id]: inferred } },
    focusId,
  )
}

export function pasteInto(
  document: JsonDocument,
  targetId: NodeId,
  pasted: JsonDocument,
): TransitionResult {
  const target = document.nodes[targetId]
  if (!target) return failed('UnknownNode', `Unknown target: ${targetId}`)
  if (target.type !== 'container')
    return failed('InvalidTarget', 'Paste into requires a container')
  const pastedRoot = getContainer(pasted, pasted.rootId)
  if (pastedRoot.childIds.length === 0) {
    if (target.childIds.length > 0)
      return failed('NothingToInsert', 'The pasted collection is empty')
    const adopted = {
      ...target,
      kind: pastedRoot.kind,
      kindOrigin: 'imported' as const,
      entries: [],
    }
    const next = {
      ...document,
      nodes: { ...document.nodes, [targetId]: adopted },
    }
    return success(document, targetId, next, targetId)
  }
  const additions = withoutRoot(pasted)
  return insertNodes(
    document,
    targetId,
    additions,
    pastedRoot.childIds,
    pastedRoot.childIds[0],
  )
}

export function pasteBeside(
  document: JsonDocument,
  targetId: NodeId,
  pasted: JsonDocument,
): TransitionResult {
  if (
    targetId === document.rootId &&
    getContainer(document, targetId).childIds.length === 0
  ) {
    return adoptAtRoot(document, pasted)
  }
  const parentResult = parentOf(document, targetId)
  if ('code' in parentResult) return { ok: false, error: parentResult }
  const pastedRoot = pasted.nodes[pasted.rootId]
  if (!pastedRoot || pastedRoot.type !== 'container')
    return failed('InvalidPasteRoot', 'Pasted root must be a container')
  const onlyObjectChild =
    pastedRoot.kind === 'object' && pastedRoot.childIds.length === 1
      ? pasted.nodes[pastedRoot.childIds[0] as NodeId]
      : undefined
  const flattenObjectRoot =
    onlyObjectChild?.type === 'container' && onlyObjectChild.caption !== null
  const insertedId = flattenObjectRoot ? onlyObjectChild.id : pastedRoot.id
  const additions = flattenObjectRoot ? withoutRoot(pasted) : pasted.nodes
  for (const id of Object.keys(additions) as NodeId[]) {
    if (document.nodes[id])
      return failed('IdCollision', `Node ID already exists: ${id}`)
  }
  const parent = getContainer(document, parentResult.parentId)
  const childIds = [...parent.childIds]
  childIds.splice(parentResult.index + 1, 0, insertedId)
  const draft: JsonDocument = {
    rootId: document.rootId,
    nodes: {
      ...document.nodes,
      ...additions,
      [parent.id]: { ...parent, childIds },
    },
  }
  const inferred = flattenObjectRoot
    ? {
        ...getContainer(draft, parent.id),
        kind: 'array' as const,
        kindOrigin: 'inferred-ordered' as const,
        entries: [],
      }
    : inferContainer(draft, getContainer(draft, parent.id))
  if ('code' in inferred) return { ok: false, error: inferred }
  const focusId = flattenObjectRoot ? onlyObjectChild.id : pastedRoot.id
  return success(
    document,
    targetId,
    { ...draft, nodes: { ...draft.nodes, [parent.id]: inferred } },
    focusId,
  )
}

export function restoreTransition(
  snapshot: TransitionSnapshot,
  current: JsonDocument,
): TransitionResult {
  return success(current, snapshot.focusId, snapshot.document, snapshot.focusId)
}

function adoptAtRoot(
  document: JsonDocument,
  pasted: JsonDocument,
): TransitionResult {
  const source = getContainer(pasted, pasted.rootId)
  const additions = withoutRoot(pasted)
  for (const id of Object.keys(additions) as NodeId[]) {
    if (document.nodes[id])
      return failed('IdCollision', `Node ID already exists: ${id}`)
  }
  const root = getContainer(document, document.rootId)
  const adopted: ContainerNode = {
    ...root,
    kind: source.kind,
    kindOrigin: source.kindOrigin,
    childIds: source.childIds,
    entries: source.entries,
  }
  const next = {
    ...document,
    nodes: { ...document.nodes, ...additions, [root.id]: adopted },
  }
  return success(document, root.id, next, root.id)
}

function withoutRoot(
  document: JsonDocument,
): Readonly<Record<NodeId, DocumentNode>> {
  const nodes = { ...document.nodes }
  delete nodes[document.rootId]
  return nodes
}

function parentOf(
  document: JsonDocument,
  id: NodeId,
): { parentId: NodeId; index: number } | InferenceError {
  if (!document.nodes[id]) return error('UnknownNode', `Unknown node: ${id}`)
  try {
    const parent = buildParentLookup(document).get(id)
    return (
      parent ??
      error(
        'InvalidTarget',
        'The root cannot be wrapped, unwrapped, or pasted beside',
      )
    )
  } catch (cause) {
    return error(
      'InvalidTarget',
      cause instanceof Error ? cause.message : 'Invalid parent relationship',
    )
  }
}

function success(
  previous: JsonDocument,
  previousFocus: NodeId,
  document: JsonDocument,
  focusId: NodeId,
): TransitionResult {
  return {
    ok: true,
    document,
    focusId,
    inverse: { document: previous, focusId: previousFocus },
  }
}

function failed(code: InferenceErrorCode, message: string): TransitionResult {
  return { ok: false, error: error(code, message) }
}

function error(code: InferenceErrorCode, message: string): InferenceError {
  return { code, message }
}
