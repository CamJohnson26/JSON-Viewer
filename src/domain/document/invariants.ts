import type {
  ContainerNode,
  JsonDocument,
  NodeId,
  PrimitiveNode,
} from './model.ts'
import { detectPrimitive } from './primitive.ts'

export interface ParentLocation {
  readonly parentId: NodeId
  readonly index: number
  readonly key?: string
}

export type InvariantCode =
  | 'MissingRoot'
  | 'IdMismatch'
  | 'MissingChild'
  | 'MultipleParents'
  | 'UnreachableNode'
  | 'Cycle'
  | 'InvalidContainer'
  | 'InvalidPrimitive'
  | 'DuplicateKey'

export interface InvariantViolation {
  readonly code: InvariantCode
  readonly nodeId?: NodeId
  readonly message: string
}

export function buildParentLookup(
  document: JsonDocument,
): ReadonlyMap<NodeId, ParentLocation> {
  const parents = new Map<NodeId, ParentLocation>()
  for (const node of Object.values(document.nodes)) {
    if (node.type !== 'container') continue
    node.childIds.forEach((childId, index) => {
      if (parents.has(childId))
        throw new Error(`Node has multiple parents: ${childId}`)
      const entry = node.kind === 'object' ? node.entries[index] : undefined
      const key = entry?.nodeId === childId ? entry.key : undefined
      parents.set(
        childId,
        key === undefined
          ? { parentId: node.id, index }
          : { parentId: node.id, index, key },
      )
    })
  }
  return parents
}

export function validateDocument(
  document: JsonDocument,
): readonly InvariantViolation[] {
  const violations: InvariantViolation[] = []
  const root = document.nodes[document.rootId]
  if (!root || root.type !== 'container') {
    return [
      {
        code: 'MissingRoot',
        message: 'The root must reference one container node',
      },
    ]
  }
  if (root.caption !== null) {
    add(
      violations,
      'InvalidContainer',
      root.id,
      'The root container cannot have a caption',
    )
  }

  const parentCounts = new Map<NodeId, number>()
  for (const [recordId, node] of Object.entries(document.nodes)) {
    if (node.id !== recordId)
      add(
        violations,
        'IdMismatch',
        node.id,
        'Record key does not match node ID',
      )
    if (node.type === 'primitive') {
      if (!isPrimitiveNodeValid(node)) {
        add(
          violations,
          'InvalidPrimitive',
          node.id,
          'Primitive metadata must match its semantic JSON value',
        )
      }
      continue
    }
    validateContainer(document, node, parentCounts, violations)
  }

  if (parentCounts.has(document.rootId)) {
    add(
      violations,
      'MultipleParents',
      document.rootId,
      'The root cannot have a parent',
    )
  }
  for (const [id, count] of parentCounts) {
    if (count > 1)
      add(
        violations,
        'MultipleParents',
        id,
        'A node must have exactly one parent',
      )
  }

  const visiting = new Set<NodeId>()
  const visited = new Set<NodeId>()
  visit(document, document.rootId, visiting, visited, violations)
  for (const node of Object.values(document.nodes)) {
    if (!visited.has(node.id))
      add(
        violations,
        'UnreachableNode',
        node.id,
        'Node is not reachable from the root',
      )
  }
  return violations
}

export function assertDocument(document: JsonDocument): void {
  const violations = validateDocument(document)
  if (violations.length > 0)
    throw new Error(violations.map((item) => item.message).join('; '))
}

function validateContainer(
  document: JsonDocument,
  node: ContainerNode,
  parentCounts: Map<NodeId, number>,
  violations: InvariantViolation[],
): void {
  const childSet = new Set<NodeId>()
  for (const childId of node.childIds) {
    if (childSet.has(childId))
      add(violations, 'MultipleParents', childId, 'Child ID is repeated')
    childSet.add(childId)
    parentCounts.set(childId, (parentCounts.get(childId) ?? 0) + 1)
    if (!document.nodes[childId])
      add(violations, 'MissingChild', node.id, `Missing child: ${childId}`)
  }
  if (
    node.kind === 'neutral' &&
    (node.childIds.length > 0 || node.kindOrigin !== 'neutral')
  ) {
    add(
      violations,
      'InvalidContainer',
      node.id,
      'Only an empty neutral-origin container can be neutral',
    )
  }
  if (node.kindOrigin === 'neutral' && node.kind !== 'neutral') {
    add(
      violations,
      'InvalidContainer',
      node.id,
      'A shaped container cannot have neutral origin',
    )
  }
  if (
    (node.kindOrigin === 'inferred' ||
      node.kindOrigin === 'inferred-ordered') &&
    node.kind !== 'array' &&
    node.kind !== 'object'
  ) {
    add(
      violations,
      'InvalidContainer',
      node.id,
      'Inferred containers must be arrays or objects',
    )
  }
  if (node.kindOrigin === 'inferred-ordered' && node.kind !== 'array') {
    add(
      violations,
      'InvalidContainer',
      node.id,
      'Forced ordered containers must be arrays',
    )
  }
  if (
    node.kindOrigin === 'imported' &&
    node.kind !== 'array' &&
    node.kind !== 'object' &&
    node.kind !== 'scalar'
  ) {
    add(
      violations,
      'InvalidContainer',
      node.id,
      'Imported containers must have a known JSON shape',
    )
  }
  if (node.kind !== 'object' && node.entries.length !== 0) {
    add(
      violations,
      'InvalidContainer',
      node.id,
      'Only object containers can have keyed entries',
    )
  }
  if (
    node.kind === 'scalar' &&
    (node.kindOrigin !== 'imported' ||
      node.caption !== null ||
      node.childIds.length !== 1 ||
      document.nodes[node.childIds[0] as NodeId]?.type !== 'primitive')
  ) {
    add(
      violations,
      'InvalidContainer',
      node.id,
      'Scalar roots require one imported primitive child',
    )
  }
  if (node.kind === 'object') {
    const keys = new Set<string>()
    if (node.entries.length !== node.childIds.length) {
      add(
        violations,
        'InvalidContainer',
        node.id,
        'Object entries must match ordered children',
      )
    }
    node.entries.forEach((entry, index) => {
      if (keys.has(entry.key))
        add(violations, 'DuplicateKey', node.id, `Duplicate key: ${entry.key}`)
      keys.add(entry.key)
      if (entry.nodeId !== node.childIds[index]) {
        add(
          violations,
          'InvalidContainer',
          node.id,
          'Object entry order must match child order',
        )
      }
      const child = document.nodes[entry.nodeId]
      if (!child || child.type !== 'container' || child.caption !== entry.key) {
        add(
          violations,
          'InvalidContainer',
          node.id,
          'Object entries require matching captioned headers',
        )
      }
    })
  }
}

export function isPrimitiveNodeValid(node: PrimitiveNode): boolean {
  if (
    typeof node.id !== 'string' ||
    node.id.length === 0 ||
    typeof node.sourceInput !== 'string' ||
    !['inherit', 'formatted', 'source'].includes(node.formatting) ||
    !['string', 'number', 'boolean', 'null', 'date', 'datetime'].includes(
      node.detectedKind,
    ) ||
    detectPrimitive(node.sourceInput).kind !== node.detectedKind
  ) {
    return false
  }
  if (typeof node.value === 'number') {
    return (
      node.detectedKind === 'number' &&
      Number.isFinite(node.value) &&
      Object.is(detectPrimitive(node.sourceInput).value, node.value)
    )
  }
  if (typeof node.value === 'boolean') {
    return (
      node.detectedKind === 'boolean' &&
      detectPrimitive(node.sourceInput).value === node.value
    )
  }
  if (node.value === null) return node.detectedKind === 'null'
  return typeof node.value === 'string' && node.value === node.sourceInput
}

function visit(
  document: JsonDocument,
  id: NodeId,
  visiting: Set<NodeId>,
  visited: Set<NodeId>,
  violations: InvariantViolation[],
): void {
  if (visiting.has(id)) {
    add(violations, 'Cycle', id, 'Container graph contains a cycle')
    return
  }
  if (visited.has(id)) return
  const node = document.nodes[id]
  if (!node) return
  visiting.add(id)
  if (node.type === 'container') {
    for (const childId of node.childIds)
      visit(document, childId, visiting, visited, violations)
  }
  visiting.delete(id)
  visited.add(id)
}

function add(
  violations: InvariantViolation[],
  code: InvariantCode,
  nodeId: NodeId,
  message: string,
): void {
  violations.push({ code, nodeId, message })
}
