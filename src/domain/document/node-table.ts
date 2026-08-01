import type { DocumentNode, NodeId } from './model.ts'

const BUCKET_COUNT = 256
const TABLE_STATE = Symbol('node-table-state')

interface NodeTableState {
  readonly buckets: readonly Readonly<Record<string, DocumentNode>>[]
}

export interface NodeTablePatch {
  readonly id: NodeId
  readonly after: DocumentNode | null
}

export function createNodeTable(
  records: Readonly<Record<NodeId, DocumentNode>>,
): Readonly<Record<NodeId, DocumentNode>> {
  const existing = tableState(records)
  if (existing) return records

  const buckets = Array.from({ length: BUCKET_COUNT }, emptyBucket)
  for (const [id, node] of Object.entries(records)) {
    const bucket = buckets[bucketIndex(id)]
    if (!bucket) throw new Error('Node table bucket is unavailable')
    bucket[id] = node
  }
  return createTable({ buckets })
}

export function patchNodeTable(
  records: Readonly<Record<NodeId, DocumentNode>>,
  patches: readonly NodeTablePatch[],
): Readonly<Record<NodeId, DocumentNode>> {
  if (patches.length === 0) return records
  const current = tableState(records) ?? tableState(createNodeTable(records))
  if (!current) throw new Error('Unable to initialize node table')

  const buckets = [...current.buckets]
  const changed = new Map<number, Record<string, DocumentNode>>()
  for (const patch of patches) {
    const index = bucketIndex(patch.id)
    let bucket = changed.get(index)
    if (!bucket) {
      bucket = Object.assign(emptyBucket(), current.buckets[index])
      changed.set(index, bucket)
      buckets[index] = bucket
    }
    if (patch.after === null) delete bucket[patch.id]
    else bucket[patch.id] = patch.after
  }
  return createTable({ buckets })
}

function createTable(
  state: NodeTableState,
): Readonly<Record<NodeId, DocumentNode>> {
  const target = emptyBucket() as Record<NodeId, DocumentNode>
  return new Proxy(target, {
    get: (_target, property) => {
      if (property === TABLE_STATE) return state
      if (typeof property !== 'string') return undefined
      return state.buckets[bucketIndex(property)]?.[property]
    },
    has: (_target, property) =>
      typeof property === 'string' &&
      state.buckets[bucketIndex(property)]?.[property] !== undefined,
    ownKeys: () => state.buckets.flatMap((bucket) => Object.keys(bucket)),
    getOwnPropertyDescriptor: (_target, property) => {
      if (typeof property !== 'string') return undefined
      const value = state.buckets[bucketIndex(property)]?.[property]
      return value === undefined
        ? undefined
        : { configurable: true, enumerable: true, value, writable: false }
    },
    set: () => false,
    deleteProperty: () => false,
  })
}

function tableState(
  records: Readonly<Record<NodeId, DocumentNode>>,
): NodeTableState | undefined {
  return Reflect.get(records, TABLE_STATE) as NodeTableState | undefined
}

function bucketIndex(id: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < id.length; index++) {
    hash ^= id.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0) % BUCKET_COUNT
}

function emptyBucket(): Record<string, DocumentNode> {
  return Object.create(null) as Record<string, DocumentNode>
}
