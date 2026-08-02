import {
  buildParentLookup,
  createImportedPrimitive,
  detectPrimitive,
  validateDocument,
  type ContainerKind,
  type ContainerNode,
  type DocumentNode,
  type FormattingOverride,
  type JsonDocument,
  type JsonPrimitive,
  type JsonValue,
  type NodeId,
  type PrimitiveNode,
} from '../document/index.ts'
import { nodePayload } from './clipboard.ts'
import {
  type JsonOperation,
  type JsonQuery,
  type FindMatchingOptions,
  type OperationDependencies,
  type OperationError,
  type OperationErrorCode,
  type OperationResult,
  type SortKey,
} from './types.ts'
import {
  MAX_OPERATION_DEPTH,
  asValidatedDependencies,
  asValidatedOperation,
  validateDependencies,
  validateOperationPayload,
  validateQueryPayload,
} from './validation.ts'

class OperationFailure extends Error {
  constructor(readonly error: OperationError) {
    super(error.message)
  }
}

export function applyJsonOperation(
  document: JsonDocument,
  selectedRootIds: readonly NodeId[],
  operation: JsonOperation,
  dependencies: OperationDependencies,
): OperationResult {
  try {
    const operationError = validateOperationPayload(operation)
    if (operationError) throw new OperationFailure(operationError)
    const dependencyError = validateDependencies(dependencies)
    if (dependencyError) throw new OperationFailure(dependencyError)
    const validOperation = asValidatedOperation(operation)
    const validDependencies = asValidatedDependencies(dependencies)
    const selectedIds = checkSelection(document, selectedRootIds)
    assertDocumentDepth(document, selectedIds)
    const generatedIds: NodeId[] = []
    const generatedIdSet = new Set<NodeId>()
    const createId = (): NodeId => {
      const id = dependencyString('node ID', validDependencies.createId)
      if (document.nodes[id as NodeId] || generatedIdSet.has(id as NodeId))
        fail('IdCollision', `Generated node ID already exists: ${id}`)
      generatedIdSet.add(id as NodeId)
      generatedIds.push(id as NodeId)
      return id as NodeId
    }
    const applied = execute(document, selectedIds, validOperation, {
      ...validDependencies,
      createId,
      createUuid: () => dependencyString('UUID', validDependencies.createUuid),
      createTimestamp: () =>
        dependencyString('timestamp', validDependencies.createTimestamp),
    })
    const violations = validateDocument(applied.document)
    if (violations.length > 0)
      fail(
        'InvariantViolation',
        violations.map((item) => item.message).join('; '),
      )
    return {
      ok: true,
      document: applied.document,
      selectedIds: applied.selectedIds,
      summary: {
        type: validOperation.type,
        affectedIds: applied.affectedIds,
        generatedIds,
      },
    }
  } catch (error) {
    if (error instanceof OperationFailure)
      return { ok: false, error: error.error }
    return {
      ok: false,
      error: {
        code: 'InvalidOperation',
        message:
          error instanceof Error ? error.message : 'Operation execution failed',
      },
    }
  }
}

export function findMatchingIds(
  document: JsonDocument,
  rootIds: readonly NodeId[],
  query: JsonQuery,
  options: FindMatchingOptions = {},
): readonly NodeId[] {
  const queryError = validateQueryPayload(query)
  if (queryError) throw new OperationFailure(queryError)
  const roots = checkSelection(document, rootIds)
  assertDocumentDepth(document, roots)
  const result: NodeId[] = []
  const visit = (id: NodeId, depth: number): void => {
    guardDepth(depth, 'Matching query')
    const matched = matchesQuery(nodePayload(document, id), query)
    if (matched) result.push(id)
    if (matched && !options.includeDescendantsOfMatches) return
    const node = document.nodes[id]
    if (node?.type === 'container')
      node.childIds.forEach((childId) => visit(childId, depth + 1))
  }
  roots.forEach((id) => visit(id, 0))
  return result
}

interface Applied {
  readonly document: JsonDocument
  readonly selectedIds: readonly NodeId[]
  readonly affectedIds: readonly NodeId[]
}

function execute(
  document: JsonDocument,
  selectedIds: readonly NodeId[],
  operation: JsonOperation,
  dependencies: OperationDependencies,
): Applied {
  switch (operation.type) {
    case 'structure.move':
      return moveRelative(document, selectedIds, operation.direction)
    case 'structure.move-to':
      return moveTo(
        document,
        selectedIds,
        operation.containerId,
        operation.index,
      )
    case 'structure.reverse':
      return transformContainers(document, selectedIds, (node) =>
        reorder(node, [...node.childIds].reverse()),
      )
    case 'structure.flatten':
      return flatten(document, selectedIds)
    case 'structure.remove-empty':
      return removeEmpty(document, selectedIds)
    case 'structure.remove':
      return removeSelection(document, selectedIds)
    case 'caption.case':
      return transformCaptions(document, selectedIds, operation.mode)
    case 'text.case':
      return updateStrings(document, selectedIds, (value) =>
        operation.mode === 'upper'
          ? value.toUpperCase()
          : operation.mode === 'lower'
            ? value.toLowerCase()
            : titleCase(value),
      )
    case 'text.trim':
      return updateStrings(document, selectedIds, (value) => value.trim())
    case 'text.replace':
      return updateStrings(document, selectedIds, (value) =>
        replaceText(
          value,
          operation.find,
          operation.replacement,
          operation.all ?? true,
          operation.caseSensitive ?? true,
        ),
      )
    case 'text.affix':
      return updateStrings(document, selectedIds, (value) =>
        operation.position === 'prefix'
          ? operation.value + value
          : value + operation.value,
      )
    case 'text.parse-escaped':
      return updateStrings(document, selectedIds, parseEscaped)
    case 'text.escape':
      return updateStrings(document, selectedIds, (value) =>
        JSON.stringify(value).slice(1, -1),
      )
    case 'primitive.convert':
      return updatePrimitives(document, selectedIds, (node) =>
        convertPrimitive(node, operation.to),
      )
    case 'primitive.date-format':
      return setFormatting(
        document,
        selectedIds,
        operation.formatting,
        (node) =>
          typeof node.value === 'string' &&
          (node.detectedKind === 'date' || node.detectedKind === 'datetime'),
        'semantic date strings',
      )
    case 'primitive.number-format':
      return setFormatting(
        document,
        selectedIds,
        operation.formatting,
        (node) => typeof node.value === 'number',
        'semantic numbers',
      )
    case 'primitive.generate': {
      const values = selectedIds.map(() =>
        operation.value === 'uuid'
          ? dependencies.createUuid()
          : dependencies.createTimestamp(),
      )
      let index = 0
      return updatePrimitives(document, selectedIds, (node) =>
        primitive(
          node.id,
          values[index++] as string,
          values[index - 1] as string,
          node.formatting,
        ),
      )
    }
    case 'primitive.toggle':
      return updatePrimitives(document, selectedIds, (node) => {
        if (typeof node.value !== 'boolean')
          incompatible(node.id, 'Boolean toggle requires booleans')
        return primitive(
          node.id,
          String(!node.value),
          !node.value,
          node.formatting,
        )
      })
    case 'primitive.adjust': {
      if (!Number.isFinite(operation.amount))
        fail('InvalidOperation', 'Adjustment must be finite')
      return updatePrimitives(document, selectedIds, (node) => {
        if (typeof node.value !== 'number')
          incompatible(node.id, 'Number adjustment requires numbers')
        const value = node.value + operation.amount
        if (!Number.isFinite(value))
          fail(
            'InvalidConversion',
            'Adjusted number is outside the finite JSON range',
            node.id,
          )
        return primitive(node.id, String(value), value, node.formatting)
      })
    }
    case 'collection.sort':
      return sortCollections(
        document,
        selectedIds,
        operation.key,
        operation.direction,
      )
    case 'collection.filter':
      return filterCollections(document, selectedIds, operation.query)
    case 'collection.deduplicate':
      return deduplicate(document, selectedIds)
    case 'collection.group':
      return rebuildEach(
        document,
        selectedIds,
        dependencies.createId,
        (value, id) => groupValue(value, operation.path, id),
      )
    case 'collection.reorder': {
      if (selectedIds.length !== 1)
        fail(
          'IncompatibleSelection',
          'Persistent reorder requires one container',
        )
      return transformContainers(document, selectedIds, (node) => {
        if (
          operation.childIds.length !== node.childIds.length ||
          new Set(operation.childIds).size !== node.childIds.length ||
          operation.childIds.some((id) => !node.childIds.includes(id))
        )
          fail(
            'InvalidOperation',
            'Reorder IDs must be an exact child permutation',
            node.id,
          )
        return reorder(node, operation.childIds)
      })
    }
    case 'data.merge':
      return combineSelections(
        document,
        selectedIds,
        dependencies.createId,
        (values) => mergeValues(values, operation.depth),
      )
    case 'data.diff': {
      if (selectedIds.length !== 2)
        fail('IncompatibleSelection', 'Diff requires exactly two selections')
      return combineSelections(
        document,
        selectedIds,
        dependencies.createId,
        (values) => diffValues(values[0] as JsonValue, values[1] as JsonValue),
      )
    }
    case 'data.extract':
      return rebuildEach(
        document,
        selectedIds,
        dependencies.createId,
        (value, id) => extract(value, operation.part, id),
      )
    case 'data.rename-path':
      return renamePaths(
        document,
        selectedIds,
        operation.path,
        operation.replacement,
      )
  }
}

function checkSelection(
  document: JsonDocument,
  ids: unknown,
): readonly NodeId[] {
  if (!validSelectedIds(ids))
    fail(
      'InvalidOperation',
      'Selected IDs must be an array of non-empty strings',
    )
  if (ids.length === 0) fail('EmptySelection', 'Select at least one node')
  if (new Set(ids).size !== ids.length)
    fail('OverlappingSelection', 'Selection contains duplicate IDs')
  const parents = buildParentLookup(document)
  const selected = new Set(ids)
  for (const id of ids) {
    if (!document.nodes[id])
      fail('UnknownSelection', `Unknown selected node: ${id}`, id)
    let parent = parents.get(id)
    while (parent) {
      if (selected.has(parent.parentId))
        fail(
          'OverlappingSelection',
          'Selection contains an ancestor and descendant',
          id,
        )
      parent = parents.get(parent.parentId)
    }
  }
  const order = preorder(document)
  return [...ids].sort(
    (a, b) => (order.get(a) as number) - (order.get(b) as number),
  )
}

function validSelectedIds(value: unknown): value is readonly NodeId[] {
  return (
    Array.isArray(value) &&
    value.every((id: unknown) => typeof id === 'string' && id.length > 0)
  )
}

function moveRelative(
  document: JsonDocument,
  ids: readonly NodeId[],
  direction: 'up' | 'down',
): Applied {
  const parents = buildParentLookup(document)
  const parentId = parents.get(ids[0] as NodeId)?.parentId
  if (!parentId || ids.some((id) => parents.get(id)?.parentId !== parentId))
    fail('InvalidTarget', 'Move up/down requires sibling selections')
  const parent = document.nodes[parentId] as ContainerNode
  const selected = new Set(ids)
  const children = [...parent.childIds]
  if (direction === 'up') {
    for (let index = 1; index < children.length; index++)
      if (
        selected.has(children[index] as NodeId) &&
        !selected.has(children[index - 1] as NodeId)
      )
        [children[index - 1], children[index]] = [
          children[index] as NodeId,
          children[index - 1] as NodeId,
        ]
  } else {
    for (let index = children.length - 2; index >= 0; index--)
      if (
        selected.has(children[index] as NodeId) &&
        !selected.has(children[index + 1] as NodeId)
      )
        [children[index], children[index + 1]] = [
          children[index + 1] as NodeId,
          children[index] as NodeId,
        ]
  }
  return changed(document, { [parentId]: reorder(parent, children) }, ids, [
    parentId,
    ...ids,
  ])
}

function moveTo(
  document: JsonDocument,
  ids: readonly NodeId[],
  targetId: NodeId,
  requestedIndex: number,
): Applied {
  const target = document.nodes[targetId]
  if (!target)
    fail('InvalidTarget', `Unknown target container: ${targetId}`, targetId)
  if (target.type !== 'container' || target.kind === 'scalar')
    fail('InvalidTarget', 'Move target must be a collection', targetId)
  if (
    !Number.isSafeInteger(requestedIndex) ||
    requestedIndex < 0 ||
    requestedIndex > target.childIds.length
  )
    fail('InvalidOperation', 'Move index is out of range')
  for (const id of ids)
    if (isDescendant(document, targetId, id) || id === targetId)
      fail('Cycle', 'Cannot move a node into itself or its descendant', id)
  assertCaptions(document, target, ids, new Set(ids))
  const parents = buildParentLookup(document)
  const updates = new Map<NodeId, ContainerNode>()
  for (const id of ids) {
    const location = parents.get(id)
    if (!location)
      fail('InvalidTarget', 'The document root cannot be moved', id)
    const parent =
      updates.get(location.parentId) ??
      (document.nodes[location.parentId] as ContainerNode)
    updates.set(
      parent.id,
      reorder(
        parent,
        parent.childIds.filter((childId) => childId !== id),
      ),
    )
  }
  let nextTarget = updates.get(targetId) ?? target
  const removedBefore = target.childIds
    .slice(0, requestedIndex)
    .filter((id) => ids.includes(id)).length
  const index = Math.min(
    nextTarget.childIds.length,
    requestedIndex - removedBefore,
  )
  const children = [...nextTarget.childIds]
  children.splice(index, 0, ...ids)
  const targetTemplate = ids.some(
    (id) => parents.get(id)?.parentId === targetId,
  )
    ? target
    : nextTarget
  nextTarget = rekey(document, targetTemplate, children)
  updates.set(targetId, nextTarget)
  return changed(document, Object.fromEntries(updates), ids, [
    ...updates.keys(),
    ...ids,
  ])
}

function flatten(document: JsonDocument, ids: readonly NodeId[]): Applied {
  const parents = buildParentLookup(document)
  const updates = new Map<NodeId, ContainerNode>()
  const removed = new Set<NodeId>()
  for (const id of ids) {
    const node = document.nodes[id]
    const location = parents.get(id)
    if (node?.type !== 'container' || node.kind === 'scalar' || !location)
      incompatible(id, 'Flatten requires nested collection selections')
    const parent =
      updates.get(location.parentId) ??
      (document.nodes[location.parentId] as ContainerNode)
    const index = parent.childIds.indexOf(id)
    const children = [...parent.childIds]
    children.splice(index, 1, ...node.childIds)
    const candidate = rekey(document, parent, children)
    assertContainerShape(document, candidate, new Set([id]))
    updates.set(parent.id, candidate)
    removed.add(id)
  }
  const nodes = { ...document.nodes }
  for (const id of removed) delete nodes[id]
  for (const [id, node] of updates) defineRecord(nodes, id, node)
  return {
    document: { ...document, nodes },
    selectedIds: ids.flatMap(
      (id) => (document.nodes[id] as ContainerNode).childIds,
    ),
    affectedIds: [...updates.keys(), ...ids],
  }
}

function removeSelection(
  document: JsonDocument,
  ids: readonly NodeId[],
): Applied {
  if (ids.includes(document.rootId))
    fail(
      'InvalidTarget',
      'The document root cannot be removed',
      document.rootId,
    )
  return removeIds(document, ids, [])
}

function removeEmpty(
  document: JsonDocument,
  roots: readonly NodeId[],
): Applied {
  const removals: NodeId[] = []
  const removalSet = new Set<NodeId>()
  const rootSet = new Set(roots)
  const visit = (id: NodeId, depth: number): boolean => {
    guardDepth(depth, 'Empty-value removal')
    const node = document.nodes[id]
    if (!node) return false
    if (node.type === 'primitive')
      return node.value === null || node.value === ''
    for (const childId of node.childIds)
      if (visit(childId, depth + 1)) {
        removals.push(childId)
        removalSet.add(childId)
      }
    const remaining = node.childIds.filter(
      (childId) => !removalSet.has(childId),
    )
    return remaining.length === 0 && !rootSet.has(id)
  }
  roots.forEach((id) => {
    if (visit(id, 0) && id !== document.rootId) {
      removals.push(id)
      removalSet.add(id)
    }
  })
  if (removals.length === 0)
    return { document, selectedIds: roots, affectedIds: [] }
  return removeIds(
    document,
    removals,
    roots.filter((id) => !removalSet.has(id)),
  )
}

function removeIds(
  document: JsonDocument,
  ids: readonly NodeId[],
  selection: readonly NodeId[],
): Applied {
  const parents = buildParentLookup(document)
  const roots = new Set(ids)
  const topRoots = ids.filter((id) => {
    let location = parents.get(id)
    while (location) {
      if (roots.has(location.parentId)) return false
      location = parents.get(location.parentId)
    }
    return true
  })
  const topRootSet = new Set(topRoots)
  const deleted = new Set<NodeId>()
  const collect = (id: NodeId, depth: number): void => {
    guardDepth(depth, 'Subtree removal')
    if (deleted.has(id)) return
    deleted.add(id)
    const node = document.nodes[id]
    if (node?.type === 'container')
      node.childIds.forEach((childId) => collect(childId, depth + 1))
  }
  topRoots.forEach((id) => collect(id, 0))
  const updates = new Map<NodeId, ContainerNode>()
  for (const id of topRoots) {
    const location = parents.get(id)
    if (!location) continue
    const parent =
      updates.get(location.parentId) ??
      (document.nodes[location.parentId] as ContainerNode)
    updates.set(
      parent.id,
      reorder(
        parent,
        parent.childIds.filter((childId) => !topRootSet.has(childId)),
      ),
    )
  }
  const nodes = { ...document.nodes }
  deleted.forEach((id) => delete nodes[id])
  updates.forEach((node, id) => {
    defineRecord(nodes, id, node)
  })
  return {
    document: { ...document, nodes },
    selectedIds: selection,
    affectedIds: [...deleted, ...updates.keys()],
  }
}

function updateStrings(
  document: JsonDocument,
  ids: readonly NodeId[],
  transform: (value: string) => string,
): Applied {
  return updatePrimitives(document, ids, (node) => {
    if (typeof node.value !== 'string')
      incompatible(
        node.id,
        'Text operations require string-semantic primitives',
      )
    const value = transform(node.value)
    return primitive(node.id, value, value, node.formatting)
  })
}

function updatePrimitives(
  document: JsonDocument,
  ids: readonly NodeId[],
  transform: (node: PrimitiveNode) => PrimitiveNode,
): Applied {
  const updates = Object.create(null) as Record<string, DocumentNode>
  for (const id of ids) {
    const node = document.nodes[id]
    if (node?.type !== 'primitive')
      incompatible(id, 'Operation requires primitive selections')
    const transformed = transform(node)
    defineRecord(
      updates,
      id,
      samePrimitive(node, transformed) ? node : transformed,
    )
  }
  return changed(document, updates, ids, ids)
}

function setFormatting(
  document: JsonDocument,
  ids: readonly NodeId[],
  formatting: FormattingOverride,
  accepts: (node: PrimitiveNode) => boolean,
  description: string,
): Applied {
  if (!['inherit', 'formatted', 'source'].includes(formatting))
    fail('InvalidOperation', 'Unknown formatting override')
  return updatePrimitives(document, ids, (node) => {
    if (!accepts(node))
      incompatible(node.id, `Formatting requires ${description}`)
    return { ...node, formatting }
  })
}

function transformContainers(
  document: JsonDocument,
  ids: readonly NodeId[],
  transform: (node: ContainerNode) => ContainerNode,
): Applied {
  const updates = Object.create(null) as Record<string, DocumentNode>
  for (const id of ids) {
    const node = document.nodes[id]
    if (node?.type !== 'container' || node.kind === 'scalar')
      incompatible(id, 'Operation requires collection selections')
    defineRecord(updates, id, transform(node))
  }
  return changed(document, updates, ids, ids)
}

function sortCollections(
  document: JsonDocument,
  ids: readonly NodeId[],
  key: SortKey,
  direction: 'asc' | 'desc',
): Applied {
  return transformContainers(document, ids, (node) => {
    const decorated = node.childIds.map((id, index) => ({
      id,
      index,
      value: sortValue(document, id, key),
    }))
    decorated.sort((a, b) => {
      const compared = compare(a.value, b.value)
      return compared === 0
        ? a.index - b.index
        : direction === 'asc'
          ? compared
          : -compared
    })
    return reorder(
      node,
      decorated.map((item) => item.id),
    )
  })
}

function filterCollections(
  document: JsonDocument,
  ids: readonly NodeId[],
  query: JsonQuery,
): Applied {
  const removed: NodeId[] = []
  for (const id of ids) {
    const node = document.nodes[id]
    if (node?.type !== 'container' || node.kind === 'scalar')
      incompatible(id, 'Filter requires collections')
    removed.push(
      ...node.childIds.filter(
        (childId) => !matchesQuery(nodePayload(document, childId), query),
      ),
    )
  }
  if (removed.length === 0)
    return { document, selectedIds: ids, affectedIds: [] }
  return removeIds(document, removed, ids)
}

function deduplicate(document: JsonDocument, ids: readonly NodeId[]): Applied {
  const removed: NodeId[] = []
  for (const id of ids) {
    const node = document.nodes[id]
    if (node?.type !== 'container' || node.kind === 'scalar')
      incompatible(id, 'Deduplicate requires collections')
    const seen = new Set<string>()
    for (const childId of node.childIds) {
      const canonical = canonicalJson(nodePayload(document, childId))
      if (seen.has(canonical)) removed.push(childId)
      else seen.add(canonical)
    }
  }
  return removed.length === 0
    ? { document, selectedIds: ids, affectedIds: [] }
    : removeIds(document, removed, ids)
}

function rebuildEach(
  document: JsonDocument,
  ids: readonly NodeId[],
  createId: () => NodeId,
  transform: (value: JsonValue, id: NodeId) => JsonValue,
): Applied {
  let current = document
  const affected: NodeId[] = []
  for (const id of ids) {
    const result = replaceSubtree(
      current,
      id,
      transform(nodePayload(current, id), id),
      createId,
    )
    current = result.document
    affected.push(...result.affectedIds)
  }
  return { document: current, selectedIds: ids, affectedIds: affected }
}

function combineSelections(
  document: JsonDocument,
  ids: readonly NodeId[],
  createId: () => NodeId,
  combine: (values: readonly JsonValue[]) => JsonValue,
): Applied {
  if (ids.length < 2)
    fail('IncompatibleSelection', 'Operation requires at least two selections')
  const first = ids[0] as NodeId
  let replaced = replaceSubtree(
    document,
    first,
    combine(ids.map((id) => nodePayload(document, id))),
    createId,
  )
  const others = ids.slice(1)
  if (others.length > 0)
    replaced = removeIds(replaced.document, others, [first])
  return {
    document: replaced.document,
    selectedIds: [first],
    affectedIds: [...replaced.affectedIds, ...others],
  }
}

function renamePaths(
  document: JsonDocument,
  ids: readonly NodeId[],
  path: readonly string[],
  replacement: string,
): Applied {
  if (path.length === 0) fail('InvalidPath', 'Rename path must be non-empty')
  const updates = Object.create(null) as Record<string, DocumentNode>
  const affected: NodeId[] = []
  for (const rootId of ids) {
    const parentId = resolvePathNode(document, rootId, path.slice(0, -1))
    const parent = document.nodes[parentId]
    const old = path[path.length - 1] as string
    if (parent?.type !== 'container' || parent.kind !== 'object')
      fail('InvalidPath', `Path does not resolve to an object: ${old}`, rootId)
    const entryIndex = parent.entries.findIndex((entry) => entry.key === old)
    if (entryIndex < 0)
      fail('InvalidPath', `Path segment was not found: ${old}`, rootId)
    if (
      old !== replacement &&
      parent.entries.some((entry) => entry.key === replacement)
    )
      fail(
        'DuplicateCaption',
        `Path segment already exists: ${replacement}`,
        parent.id,
      )
    if (old === replacement) continue
    const entry = parent.entries[entryIndex]
    const child = entry ? document.nodes[entry.nodeId] : undefined
    if (!entry || child?.type !== 'container')
      fail(
        'InvariantViolation',
        'Object entry does not reference a container',
        parent.id,
      )
    const entries = parent.entries.map((item, index) =>
      index === entryIndex ? { key: replacement, nodeId: item.nodeId } : item,
    )
    defineRecord(updates, parent.id, { ...parent, entries })
    defineRecord(updates, child.id, { ...child, caption: replacement })
    affected.push(parent.id, child.id)
  }
  return changed(document, updates, ids, affected)
}

function transformCaptions(
  document: JsonDocument,
  ids: readonly NodeId[],
  mode: 'snake' | 'camel' | 'words',
): Applied {
  const parents = buildParentLookup(document)
  const proposals = new Map<NodeId, string>()
  const parentIds = new Set<NodeId>()
  for (const id of ids) {
    const node = document.nodes[id]
    if (
      node?.type !== 'container' ||
      node.caption === null ||
      id === document.rootId
    )
      incompatible(id, 'Caption styling requires named header selections')
    proposals.set(id, captionCase(node.caption, mode))
    const parentId = parents.get(id)?.parentId
    if (!parentId) incompatible(id, 'Captioned header has no parent')
    if (document.nodes[parentId]?.type === 'container') parentIds.add(parentId)
  }

  for (const parentId of parentIds) {
    const parent = document.nodes[parentId]
    if (parent?.type !== 'container' || parent.kind !== 'object') continue
    const captions = new Set<string>()
    for (const childId of parent.childIds) {
      const child = document.nodes[childId]
      if (child?.type !== 'container' || child.caption === null)
        fail(
          'InvariantViolation',
          'Object entry does not reference a named header',
          parentId,
        )
      const caption = proposals.get(childId) ?? child.caption
      if (captions.has(caption))
        fail(
          'DuplicateCaption',
          `Duplicate caption after conversion: ${caption}`,
          parentId,
        )
      captions.add(caption)
    }
  }

  const updates = Object.create(null) as Record<string, DocumentNode>
  proposals.forEach((caption, id) => {
    const node = document.nodes[id] as ContainerNode
    defineRecord(updates, id, { ...node, caption })
  })
  for (const parentId of parentIds) {
    const parent = document.nodes[parentId]
    if (parent?.type !== 'container' || parent.kind !== 'object') continue
    defineRecord(updates, parentId, {
      ...parent,
      entries: parent.entries.map((entry) => ({
        ...entry,
        key: proposals.get(entry.nodeId) ?? entry.key,
      })),
    })
  }
  return changed(document, updates, ids, [...ids, ...parentIds])
}

function captionCase(value: string, mode: 'snake' | 'camel' | 'words'): string {
  const tokens = value
    .replace(/(\p{Lu}+)(\p{Lu}\p{Ll})/gu, '$1 $2')
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2')
    .replace(/(\p{L})(\p{N})|(\p{N})(\p{L})/gu, '$1$3 $2$4')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((token) => token.toLowerCase())
  if (mode === 'snake') return tokens.join('_')
  if (mode === 'words') return tokens.join(' ')
  return tokens
    .map((token, index) =>
      index === 0 ? token : token.charAt(0).toUpperCase() + token.slice(1),
    )
    .join('')
}

function resolvePathNode(
  document: JsonDocument,
  rootId: NodeId,
  path: readonly string[],
): NodeId {
  let currentId = rootId
  for (let depth = 0; depth < path.length; depth++) {
    guardDepth(depth, 'Rename path')
    const segment = path[depth] as string
    const current = document.nodes[currentId]
    if (current?.type !== 'container')
      fail('InvalidPath', `Path segment was not found: ${segment}`, currentId)
    if (current.kind === 'object') {
      const entry = current.entries.find((item) => item.key === segment)
      if (!entry)
        fail('InvalidPath', `Path segment was not found: ${segment}`, currentId)
      currentId = entry.nodeId
      continue
    }
    if (current.kind === 'array' && /^\d+$/.test(segment)) {
      const childId = current.childIds[Number(segment)]
      if (!childId)
        fail('InvalidPath', `Path segment was not found: ${segment}`, currentId)
      currentId = childId
      continue
    }
    fail('InvalidPath', `Path segment was not found: ${segment}`, currentId)
  }
  return currentId
}

function replaceSubtree(
  document: JsonDocument,
  id: NodeId,
  value: JsonValue,
  createId: () => NodeId,
): Applied {
  const old = document.nodes[id]
  if (!old) fail('UnknownSelection', `Unknown selected node: ${id}`, id)
  const descendants = new Set<NodeId>()
  const collect = (childId: NodeId, depth: number): void => {
    guardDepth(depth, 'Subtree replacement')
    const node = document.nodes[childId]
    if (node?.type === 'container')
      node.childIds.forEach((nested) => {
        descendants.add(nested)
        collect(nested, depth + 1)
      })
  }
  collect(id, 0)
  const additions = Object.create(null) as Record<string, DocumentNode>
  const caption = old.type === 'container' ? old.caption : null
  if (id === document.rootId && (value === null || typeof value !== 'object')) {
    const primitiveId = createId()
    defineRecord(additions, primitiveId, importedPrimitive(primitiveId, value))
    defineRecord(
      additions,
      id,
      container(id, null, 'scalar', [primitiveId], [], 'imported'),
    )
  } else {
    buildValue(value, id, caption, additions, createId, 0)
  }
  const nodes = { ...document.nodes }
  descendants.forEach((childId) => delete nodes[childId])
  for (const additionId of Object.keys(additions))
    defineRecord(nodes, additionId, additions[additionId] as DocumentNode)
  return {
    document: { ...document, nodes },
    selectedIds: [id],
    affectedIds: [id, ...descendants],
  }
}

function buildValue(
  value: JsonValue,
  id: NodeId,
  caption: string | null,
  nodes: Record<string, DocumentNode>,
  createId: () => NodeId,
  depth: number,
): void {
  guardDepth(depth, 'Generated operation result')
  if (value === null || typeof value !== 'object') {
    if (caption === null) {
      defineRecord(nodes, id, importedPrimitive(id, value))
    } else {
      const primitiveId = createId()
      defineRecord(nodes, primitiveId, importedPrimitive(primitiveId, value))
      defineRecord(
        nodes,
        id,
        container(id, caption, 'array', [primitiveId], [], 'inferred'),
      )
    }
    return
  }
  if (Array.isArray(value)) {
    const childIds = value.map((child) => {
      const childId = createId()
      buildValue(child, childId, null, nodes, createId, depth + 1)
      return childId
    })
    defineRecord(
      nodes,
      id,
      container(id, caption, 'array', childIds, [], 'imported'),
    )
    return
  }
  const entries: { key: string; nodeId: NodeId }[] = []
  for (const key of Object.keys(value)) {
    const childId = createId()
    buildValue(
      value[key] as JsonValue,
      childId,
      key,
      nodes,
      createId,
      depth + 1,
    )
    entries.push({ key, nodeId: childId })
  }
  defineRecord(
    nodes,
    id,
    container(
      id,
      caption,
      'object',
      entries.map((entry) => entry.nodeId),
      entries,
      'imported',
    ),
  )
}

function importedPrimitive(id: NodeId, value: JsonPrimitive): PrimitiveNode {
  return createImportedPrimitive(
    id,
    typeof value === 'string' ? value : JSON.stringify(value),
    value,
  )
}

function primitive(
  id: NodeId,
  sourceInput: string,
  value: JsonPrimitive,
  formatting: FormattingOverride,
): PrimitiveNode {
  const detectedKind =
    typeof value === 'string'
      ? detectPrimitive(sourceInput).kind
      : value === null
        ? 'null'
        : typeof value === 'number'
          ? 'number'
          : 'boolean'
  return { id, type: 'primitive', sourceInput, value, detectedKind, formatting }
}

function convertPrimitive(
  node: PrimitiveNode,
  to: 'string' | 'number' | 'boolean' | 'null',
): PrimitiveNode {
  if (to === 'null') return primitive(node.id, 'null', null, node.formatting)
  if (to === 'string') {
    const value =
      typeof node.value === 'string' ? node.value : JSON.stringify(node.value)
    return primitive(node.id, value, value, node.formatting)
  }
  if (to === 'number') {
    const value =
      typeof node.value === 'number'
        ? node.value
        : typeof node.value === 'string' && node.value.trim() !== ''
          ? Number(node.value)
          : Number.NaN
    if (!Number.isFinite(value))
      fail('InvalidConversion', `Cannot convert value to number`, node.id)
    return primitive(node.id, String(value), value, node.formatting)
  }
  if (node.value === true || node.value === false) return node
  if (node.value === 'true' || node.value === 'false')
    return primitive(
      node.id,
      node.value,
      node.value === 'true',
      node.formatting,
    )
  fail(
    'InvalidConversion',
    'Boolean conversion accepts only true or false',
    node.id,
  )
}

function reorder(
  node: ContainerNode,
  childIds: readonly NodeId[],
): ContainerNode {
  if (sameIds(node.childIds, childIds)) return node
  if (childIds.length === 0 && node.kindOrigin !== 'imported')
    return {
      ...node,
      kind: 'neutral',
      kindOrigin: 'neutral',
      childIds,
      entries: [],
    }
  if (node.kind === 'object') {
    const entriesById = new Map(
      node.entries.map((entry) => [entry.nodeId, entry]),
    )
    return {
      ...node,
      childIds,
      entries: childIds.map(
        (id) => entriesById.get(id) ?? { key: '', nodeId: id },
      ),
    }
  }
  return { ...node, childIds, entries: [] }
}

function rekey(
  document: JsonDocument,
  node: ContainerNode,
  childIds: readonly NodeId[],
): ContainerNode {
  if (childIds.length === 0) return reorder(node, childIds)
  if (node.kind !== 'object') return reorder(node, childIds)
  return {
    ...node,
    childIds,
    entries: childIds.map((id) => {
      const child = document.nodes[id]
      return {
        key: child?.type === 'container' ? (child.caption ?? '') : '',
        nodeId: id,
      }
    }),
  }
}

function assertCaptions(
  document: JsonDocument,
  target: ContainerNode,
  moving: readonly NodeId[],
  ignored: ReadonlySet<NodeId>,
): void {
  if (target.kind !== 'object') return
  const existing = new Set(
    target.childIds
      .filter((id) => !ignored.has(id))
      .map((id) => (document.nodes[id] as ContainerNode).caption),
  )
  for (const id of moving) {
    const node = document.nodes[id]
    if (node?.type !== 'container' || node.caption === null)
      fail('InvalidTarget', 'Object containers require captioned children', id)
    if (existing.has(node.caption))
      fail('DuplicateCaption', `Duplicate caption: ${node.caption}`, id)
    existing.add(node.caption)
  }
}

function assertContainerShape(
  document: JsonDocument,
  node: ContainerNode,
  ignored: ReadonlySet<NodeId>,
): void {
  if (node.kind !== 'object') return
  const captions = new Set<string>()
  for (const id of node.childIds) {
    if (ignored.has(id)) continue
    const child = document.nodes[id]
    if (child?.type !== 'container' || child.caption === null)
      fail('InvalidTarget', 'Object containers require captioned children', id)
    if (captions.has(child.caption))
      fail('DuplicateCaption', `Duplicate caption: ${child.caption}`, id)
    captions.add(child.caption)
  }
}

function changed(
  document: JsonDocument,
  updates: Readonly<Record<string, DocumentNode>>,
  selectedIds: readonly NodeId[],
  affectedIds: readonly NodeId[],
): Applied {
  const actual = Object.create(null) as Record<string, DocumentNode>
  for (const id of Object.keys(updates)) {
    const update = updates[id] as DocumentNode
    const current = document.nodes[id as NodeId]
    if (!current || !sameNode(current, update))
      Object.defineProperty(actual, id, {
        value: update,
        enumerable: true,
        configurable: true,
        writable: true,
      })
  }
  if (Object.keys(actual).length === 0)
    return { document, selectedIds, affectedIds: [] }
  return {
    document: { ...document, nodes: { ...document.nodes, ...actual } },
    selectedIds,
    affectedIds,
  }
}

function sameNode(left: DocumentNode, right: DocumentNode): boolean {
  if (left.type !== right.type) return false
  if (left.type === 'primitive' && right.type === 'primitive')
    return samePrimitive(left, right)
  if (left.type !== 'container' || right.type !== 'container') return false
  return (
    left.caption === right.caption &&
    left.kind === right.kind &&
    left.kindOrigin === right.kindOrigin &&
    sameIds(left.childIds, right.childIds) &&
    left.entries.length === right.entries.length &&
    left.entries.every(
      (entry, index) =>
        entry.key === right.entries[index]?.key &&
        entry.nodeId === right.entries[index]?.nodeId,
    )
  )
}

function sameIds(left: readonly NodeId[], right: readonly NodeId[]): boolean {
  return (
    left.length === right.length &&
    left.every((id, index) => id === right[index])
  )
}

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .replace(
      /(^|[^\p{L}\p{N}])(\p{L})/gu,
      (_match, boundary: string, letter: string) =>
        boundary + letter.toUpperCase(),
    )
}

function replaceText(
  value: string,
  find: string,
  replacement: string,
  all: boolean,
  caseSensitive: boolean,
): string {
  if (find === '') fail('InvalidOperation', 'Find text cannot be empty')
  if (caseSensitive) {
    if (all) return value.split(find).join(replacement)
    const index = value.indexOf(find)
    return index < 0
      ? value
      : value.slice(0, index) + replacement + value.slice(index + find.length)
  }
  return value.replace(
    new RegExp(escapeRegExp(find), all ? 'giu' : 'iu'),
    replacement.replace(/\$/g, '$$$$'),
  )
}

function parseEscaped(value: string): string {
  try {
    return JSON.parse(`"${value}"`) as string
  } catch {
    fail('InvalidEscape', 'String contains an invalid escape sequence')
  }
}

function samePrimitive(left: PrimitiveNode, right: PrimitiveNode): boolean {
  return (
    left.id === right.id &&
    left.sourceInput === right.sourceInput &&
    Object.is(left.value, right.value) &&
    left.detectedKind === right.detectedKind &&
    left.formatting === right.formatting
  )
}

function sortValue(
  document: JsonDocument,
  id: NodeId,
  key: SortKey,
): JsonValue | undefined {
  const node = document.nodes[id]
  if (key.by === 'caption')
    return node?.type === 'container' ? (node.caption ?? '') : ''
  const value = nodePayload(document, id)
  return key.by === 'path' ? getPath(value, key.path) : value
}

function compare(
  left: JsonValue | undefined,
  right: JsonValue | undefined,
): number {
  if (left === right) return 0
  if (left === undefined) return 1
  if (right === undefined) return -1
  const rank = (value: JsonValue): number =>
    value === null
      ? 0
      : typeof value === 'boolean'
        ? 1
        : typeof value === 'number'
          ? 2
          : typeof value === 'string'
            ? 3
            : Array.isArray(value)
              ? 4
              : 5
  const rankDifference = rank(left) - rank(right)
  if (rankDifference !== 0) return rankDifference
  if (typeof left === 'number' && typeof right === 'number') return left - right
  if (typeof left === 'string' && typeof right === 'string')
    return left < right ? -1 : 1
  if (typeof left === 'boolean' && typeof right === 'boolean')
    return left ? 1 : -1
  const a = canonicalJson(left)
  const b = canonicalJson(right)
  return a < b ? -1 : a > b ? 1 : 0
}

function matchesQuery(value: JsonValue, query: JsonQuery, depth = 0): boolean {
  guardDepth(depth, 'Query evaluation')
  switch (query.type) {
    case 'all':
      return true
    case 'kind':
      return (
        query.kind ===
        (value === null
          ? 'null'
          : Array.isArray(value)
            ? 'array'
            : typeof value === 'object'
              ? 'object'
              : typeof value)
      )
    case 'exists':
      return getPath(value, query.path) !== undefined
    case 'not':
      return !matchesQuery(value, query.query, depth + 1)
    case 'and':
      return query.queries.every((item) => matchesQuery(value, item, depth + 1))
    case 'or':
      return query.queries.some((item) => matchesQuery(value, item, depth + 1))
    case 'compare': {
      const actual = query.path ? getPath(value, query.path) : value
      if (
        actual === undefined ||
        (typeof actual === 'object' && actual !== null)
      )
        return false
      switch (query.operator) {
        case 'eq':
          return Object.is(actual, query.value)
        case 'ne':
          return !Object.is(actual, query.value)
        case 'gt':
          return compare(actual, query.value) > 0
        case 'gte':
          return compare(actual, query.value) >= 0
        case 'lt':
          return compare(actual, query.value) < 0
        case 'lte':
          return compare(actual, query.value) <= 0
        case 'contains':
          return (
            typeof actual === 'string' &&
            typeof query.value === 'string' &&
            actual.includes(query.value)
          )
        case 'startsWith':
          return (
            typeof actual === 'string' &&
            typeof query.value === 'string' &&
            actual.startsWith(query.value)
          )
        case 'endsWith':
          return (
            typeof actual === 'string' &&
            typeof query.value === 'string' &&
            actual.endsWith(query.value)
          )
      }
    }
  }
}

function getPath(
  value: JsonValue,
  path: readonly string[],
): JsonValue | undefined {
  let current: JsonValue | undefined = value
  for (const segment of path) {
    if (Array.isArray(current)) {
      if (!/^\d+$/.test(segment)) return undefined
      current = current[Number(segment)]
    } else if (
      current !== null &&
      typeof current === 'object' &&
      Object.hasOwn(current, segment)
    )
      current = current[segment]
    else return undefined
  }
  return current
}

function groupValue(
  value: JsonValue,
  path: readonly string[],
  id: NodeId,
): JsonValue {
  if (!Array.isArray(value))
    incompatible(id, 'Group requires an array collection')
  const groups = Object.create(null) as { [key: string]: JsonValue[] }
  const identities = new Map<string, string>()
  for (const item of value) {
    const group = getPath(item, path)
    if (group === undefined) fail('InvalidPath', `Group path was not found`, id)
    const key = typeof group === 'string' ? group : canonicalJson(group)
    const identity = `${typeof group}:${canonicalJson(group)}`
    const existingIdentity = identities.get(key)
    if (existingIdentity !== undefined && existingIdentity !== identity)
      fail('DuplicateCaption', `Grouping values share the caption ${key}`, id)
    identities.set(key, identity)
    if (!Object.hasOwn(groups, key))
      Object.defineProperty(groups, key, {
        value: [],
        enumerable: true,
        configurable: true,
        writable: true,
      })
    groups[key]?.push(item)
  }
  return groups
}

function mergeValues(
  values: readonly JsonValue[],
  depth: 'shallow' | 'deep',
  recursionDepth = 0,
): JsonValue {
  guardDepth(recursionDepth, 'Deep merge')
  if (
    values.some(
      (value) =>
        value === null || Array.isArray(value) || typeof value !== 'object',
    )
  )
    fail('IncompatibleSelection', 'Merge requires object values')
  const result = Object.create(null) as { [key: string]: JsonValue }
  for (const value of values as readonly { [key: string]: JsonValue }[])
    for (const key of Object.keys(value)) {
      const previous = result[key]
      const next = value[key] as JsonValue
      const merged =
        depth === 'deep' && isObject(previous) && isObject(next)
          ? mergeValues([previous, next], 'deep', recursionDepth + 1)
          : cloneJson(next, recursionDepth + 1)
      Object.defineProperty(result, key, {
        value: merged,
        enumerable: true,
        configurable: true,
        writable: true,
      })
    }
  return result
}

function diffValues(before: JsonValue, after: JsonValue): JsonValue {
  const changes: JsonValue[] = []
  const walk = (
    left: JsonValue | undefined,
    right: JsonValue | undefined,
    path: string[],
    depth: number,
  ): void => {
    guardDepth(depth, 'JSON diff')
    if (
      left !== undefined &&
      right !== undefined &&
      canonicalJson(left) === canonicalJson(right)
    )
      return
    if (isObject(left) && isObject(right)) {
      const keys = [
        ...new Set([...Object.keys(left), ...Object.keys(right)]),
      ].sort()
      keys.forEach((key) =>
        walk(left[key], right[key], [...path, key], depth + 1),
      )
      return
    }
    const change = Object.create(null) as { [key: string]: JsonValue }
    Object.defineProperty(change, 'path', {
      value: path,
      enumerable: true,
      configurable: true,
      writable: true,
    })
    if (left !== undefined)
      Object.defineProperty(change, 'before', {
        value: cloneJson(left, depth + 1),
        enumerable: true,
        configurable: true,
        writable: true,
      })
    if (right !== undefined)
      Object.defineProperty(change, 'after', {
        value: cloneJson(right, depth + 1),
        enumerable: true,
        configurable: true,
        writable: true,
      })
    changes.push(change)
  }
  walk(before, after, [], 0)
  const result = Object.create(null) as { [key: string]: JsonValue }
  Object.defineProperties(result, {
    equal: { value: changes.length === 0, enumerable: true },
    changes: { value: changes, enumerable: true },
  })
  return result
}

function extract(
  value: JsonValue,
  part: 'keys' | 'values',
  id: NodeId,
): JsonValue {
  if (!isObject(value)) incompatible(id, 'Extraction requires object values')
  return part === 'keys'
    ? Object.keys(value)
    : Object.keys(value).map((key) => cloneJson(value[key] as JsonValue))
}

function canonicalJson(value: JsonValue, depth = 0): string {
  guardDepth(depth, 'Canonical JSON')
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalJson(item, depth + 1)).join(',')}]`
  return `{${Object.keys(value)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${canonicalJson(value[key] as JsonValue, depth + 1)}`,
    )
    .join(',')}}`
}

function cloneJson<T extends JsonValue>(value: T, depth = 0): T {
  guardDepth(depth, 'JSON clone')
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value))
    return value.map((item) => cloneJson(item, depth + 1)) as T
  const result = Object.create(null) as { [key: string]: JsonValue }
  for (const key of Object.keys(value))
    Object.defineProperty(result, key, {
      value: cloneJson(value[key] as JsonValue, depth + 1),
      enumerable: true,
      configurable: true,
      writable: true,
    })
  return result as T
}

function isObject(
  value: JsonValue | undefined,
): value is { [key: string]: JsonValue } {
  return (
    value !== undefined &&
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value)
  )
}

function isDescendant(
  document: JsonDocument,
  candidate: NodeId,
  ancestor: NodeId,
  depth = 0,
): boolean {
  guardDepth(depth, 'Cycle detection')
  const node = document.nodes[ancestor]
  return (
    node?.type === 'container' &&
    node.childIds.some(
      (id) =>
        id === candidate || isDescendant(document, candidate, id, depth + 1),
    )
  )
}

function preorder(document: JsonDocument): Map<NodeId, number> {
  const result = new Map<NodeId, number>()
  const visit = (id: NodeId, depth: number): void => {
    guardDepth(depth, 'Document traversal')
    result.set(id, result.size)
    const node = document.nodes[id]
    if (node?.type === 'container')
      node.childIds.forEach((childId) => visit(childId, depth + 1))
  }
  visit(document.rootId, 0)
  return result
}

function assertDocumentDepth(
  document: JsonDocument,
  rootIds: readonly NodeId[],
): void {
  const stack = rootIds.map((id) => ({ id, depth: 0 }))
  while (stack.length > 0) {
    const current = stack.pop() as { id: NodeId; depth: number }
    guardDepth(current.depth, 'Selected subtree')
    const node = document.nodes[current.id]
    if (node?.type === 'container')
      for (const childId of node.childIds)
        stack.push({ id: childId, depth: current.depth + 1 })
  }
}

function container(
  id: NodeId,
  caption: string | null,
  kind: ContainerKind,
  childIds: readonly NodeId[],
  entries: ContainerNode['entries'],
  kindOrigin: ContainerNode['kindOrigin'],
): ContainerNode {
  return { id, type: 'container', caption, kind, kindOrigin, childIds, entries }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function dependencyString(name: string, factory: () => unknown): string {
  let value: unknown
  try {
    value = factory()
  } catch (error) {
    fail(
      'InvalidOperation',
      `${name} factory failed: ${error instanceof Error ? error.message : 'unknown error'}`,
    )
  }
  if (typeof value !== 'string' || value.length === 0)
    fail('InvalidOperation', `${name} factory must return a non-empty string`)
  return value
}

function defineRecord<T>(
  record: Record<string, T>,
  key: string,
  value: T,
): void {
  Object.defineProperty(record, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  })
}

function guardDepth(depth: number, operation: string): void {
  if (depth > MAX_OPERATION_DEPTH)
    fail('ResourceLimit', `${operation} exceeds maximum depth`)
}

function incompatible(nodeId: NodeId, message: string): never {
  fail('IncompatibleSelection', message, nodeId)
}

function fail(
  code: OperationErrorCode,
  message: string,
  nodeId?: NodeId,
): never {
  throw new OperationFailure(
    nodeId === undefined ? { code, message } : { code, message, nodeId },
  )
}
