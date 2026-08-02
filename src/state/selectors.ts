import {
  buildParentLookup,
  documentStructureToken,
  formatPrimitive,
  type ContainerKind,
  type ContainerNode,
  type FormattingOptions,
  type JsonDocument,
  type NodeId,
  type ParentLocation,
  type PrimitiveNode,
} from '../domain/document/index.ts'

export type UiContainerNode = Omit<ContainerNode, 'kind' | 'kindOrigin'>
export type UiDocumentNode = PrimitiveNode | UiContainerNode

const parentLookups = new WeakMap<object, ReadonlyMap<NodeId, ParentLocation>>()
const pathLookups = new WeakMap<
  object,
  Map<NodeId, { ids: readonly NodeId[]; path: readonly UiDocumentNode[] }>
>()
const validRootLookups = new WeakMap<
  object,
  WeakMap<readonly NodeId[], readonly NodeId[]>
>()
const EMPTY_NODE_IDS: readonly NodeId[] = []
const EMPTY_PATH: readonly UiDocumentNode[] = []

function parentLookup(
  document: JsonDocument,
): ReadonlyMap<NodeId, ParentLocation> {
  const token = documentStructureToken(document)
  const cached = parentLookups.get(token)
  if (cached) return cached
  const parents = buildParentLookup(document)
  parentLookups.set(token, parents)
  return parents
}

export function selectNode(
  document: JsonDocument,
  id: NodeId,
): UiDocumentNode | undefined {
  return document.nodes[id]
}

export function selectParent(
  document: JsonDocument,
  id: NodeId,
): ParentLocation | undefined {
  return parentLookup(document).get(id)
}

export function selectChildren(
  document: JsonDocument,
  id: NodeId,
): readonly NodeId[] {
  const node = document.nodes[id]
  return node?.type === 'container' ? node.childIds : EMPTY_NODE_IDS
}

export function selectPath(
  document: JsonDocument,
  id: NodeId,
): readonly UiDocumentNode[] {
  if (!document.nodes[id]) return EMPTY_PATH
  const token = documentStructureToken(document)
  let paths = pathLookups.get(token)
  if (!paths) {
    paths = new Map()
    pathLookups.set(token, paths)
  }
  const cached = paths.get(id)
  if (
    cached?.ids.every(
      (nodeId, index) => document.nodes[nodeId] === cached.path[index],
    )
  )
    return cached.path

  const parents = parentLookup(document)
  const ids: NodeId[] = []
  let cursor: NodeId | undefined = id
  while (cursor !== undefined) {
    ids.push(cursor)
    cursor = parents.get(cursor)?.parentId
  }
  ids.reverse()
  const path = ids.map((nodeId) => document.nodes[nodeId] as UiDocumentNode)
  paths.set(id, { ids, path })
  return path
}

export function selectFormattedValue(
  document: JsonDocument,
  id: NodeId,
  options: FormattingOptions,
): string | undefined {
  const node = document.nodes[id]
  return node?.type === 'primitive' ? formatPrimitive(node, options) : undefined
}

export function selectValidRoots(
  document: JsonDocument,
  ids: readonly NodeId[],
): readonly NodeId[] {
  if (ids.length === 0) return EMPTY_NODE_IDS
  const token = documentStructureToken(document)
  let selections = validRootLookups.get(token)
  if (!selections) {
    selections = new WeakMap()
    validRootLookups.set(token, selections)
  }
  const cached = selections.get(ids)
  if (cached) return cached
  const selected = new Set(ids.filter((id) => document.nodes[id] !== undefined))
  const parents = parentLookup(document)
  const roots = [...selected].filter((id) => {
    let parent = parents.get(id)
    while (parent) {
      if (selected.has(parent.parentId)) return false
      parent = parents.get(parent.parentId)
    }
    return true
  })
  const order = new Map<NodeId, number>()
  let position = 0
  const visit = (id: NodeId): void => {
    order.set(id, position++)
    const node = document.nodes[id]
    if (node?.type === 'container') node.childIds.forEach(visit)
  }
  visit(document.rootId)
  roots.sort(
    (left, right) =>
      (order.get(left) ?? Number.MAX_SAFE_INTEGER) -
      (order.get(right) ?? Number.MAX_SAFE_INTEGER),
  )
  selections.set(ids, roots)
  return roots
}

export function selectCommonParent(
  document: JsonDocument,
  ids: readonly NodeId[],
): NodeId | null {
  if (ids.length === 0) return null
  const parents = parentLookup(document)
  const first = parents.get(ids[0] as NodeId)?.parentId
  if (!first) return null
  return ids.every((id) => parents.get(id)?.parentId === first) ? first : null
}

export function selectContiguous(
  document: JsonDocument,
  ids: readonly NodeId[],
): boolean {
  if (ids.length === 0) return false
  const parentId = selectCommonParent(document, ids)
  if (!parentId) return false
  const parent = document.nodes[parentId]
  if (parent?.type !== 'container') return false
  const indices = [
    ...new Set(ids.map((id) => parent.childIds.indexOf(id))),
  ].sort((a, b) => a - b)
  if (indices.length !== ids.length || indices[0] === -1) return false
  return indices.every(
    (index, offset) => index === (indices[0] as number) + offset,
  )
}

export interface VisibleItem {
  readonly id: NodeId
  readonly parentId: NodeId | null
  readonly depth: number
  readonly index: number
  readonly path: readonly NodeId[]
  readonly reference: string
  readonly containerPresentation?: 'object' | 'array' | 'single' | 'neutral'
}

type ContainerPresentation = NonNullable<VisibleItem['containerPresentation']>

export function spreadsheetColumn(index: number): string {
  let ordinal = index + 1
  let result = ''
  while (ordinal > 0) {
    ordinal--
    result = String.fromCharCode(65 + (ordinal % 26)) + result
    ordinal = Math.floor(ordinal / 26)
  }
  return result
}

export function childReference(
  parentReference: string,
  parentKind: ContainerKind,
  childIndex: number,
): string {
  const segment =
    parentKind === 'object'
      ? spreadsheetColumn(childIndex)
      : String(childIndex + 1)
  return parentReference === 'Root' ? segment : `${parentReference}.${segment}`
}

function containerPresentation(kind: ContainerKind): ContainerPresentation {
  return kind === 'object'
    ? 'object'
    : kind === 'array'
      ? 'array'
      : kind === 'scalar'
        ? 'single'
        : 'neutral'
}

export function selectVisibleItems(
  document: JsonDocument,
  expanded: ReadonlySet<NodeId>,
): readonly VisibleItem[] {
  const result: VisibleItem[] = []
  const visit = (
    id: NodeId,
    parentId: NodeId | null,
    depth: number,
    index: number,
    path: readonly NodeId[],
    reference: string,
  ): void => {
    const node = document.nodes[id]
    if (!node) return
    const nextPath = [...path, id]
    result.push({
      id,
      parentId,
      depth,
      index,
      path: nextPath,
      reference,
      ...(node.type === 'container'
        ? { containerPresentation: containerPresentation(node.kind) }
        : {}),
    })
    if (node.type === 'container' && expanded.has(id)) {
      node.childIds.forEach((childId, childIndex) =>
        visit(
          childId,
          id,
          depth + 1,
          childIndex,
          nextPath,
          childReference(reference, node.kind, childIndex),
        ),
      )
    }
  }
  visit(document.rootId, null, 0, 0, [], 'Root')
  return result
}

export function createVisibleSelector(): (
  document: JsonDocument,
  expanded: ReadonlySet<NodeId>,
) => readonly VisibleItem[] {
  let previousStructure: object | undefined
  let previousExpanded: ReadonlySet<NodeId> | undefined
  let previousResult: readonly VisibleItem[] = []
  return (document, expanded) => {
    const structure = documentStructureToken(document)
    if (structure === previousStructure && expanded === previousExpanded)
      return previousResult
    previousStructure = structure
    previousExpanded = expanded
    previousResult = selectVisibleItems(document, expanded)
    return previousResult
  }
}
