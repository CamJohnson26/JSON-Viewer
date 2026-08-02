import type {
  ContainerNode,
  JsonDocument,
  NodeId,
} from '../domain/document/index.ts'
import { selectParent, selectValidRoots } from '../state/selectors.ts'

export type DropPosition = 'before' | 'inside' | 'after'

export interface DropIntent {
  readonly targetId: NodeId
  readonly position: DropPosition
  readonly containerId: NodeId
  readonly index: number
}

export type DropResolution =
  | {
      readonly ok: true
      readonly sourceIds: readonly NodeId[]
      readonly intent: DropIntent
    }
  | { readonly ok: false; readonly reason: string }

export interface RowBounds {
  readonly top: number
  readonly bottom: number
}

export function dropPositionFromPoint(
  bounds: RowBounds,
  clientY: number,
  acceptsInside: boolean,
): DropPosition {
  const height = Math.max(1, bounds.bottom - bounds.top)
  const ratio = Math.max(0, Math.min(1, (clientY - bounds.top) / height))
  if (acceptsInside && ratio >= 0.25 && ratio <= 0.75) return 'inside'
  return ratio < 0.5 ? 'before' : 'after'
}

export function resolveDropIntent(
  document: JsonDocument,
  selectedIds: readonly NodeId[],
  targetId: NodeId,
  position: DropPosition,
): DropResolution {
  const sourceIds = selectValidRoots(document, selectedIds)
  if (sourceIds.length === 0) return invalid('Choose an item to move')
  if (sourceIds.includes(document.rootId))
    return invalid('The root cannot move')
  if (!document.nodes[targetId])
    return invalid('The drop target no longer exists')
  if (sourceIds.includes(targetId))
    return invalid('The selection cannot be dropped onto itself')

  let containerId: NodeId
  let index: number
  if (position === 'inside') {
    const target = document.nodes[targetId]
    if (target?.type !== 'container' || target.kind === 'scalar')
      return invalid('Only a collection header can contain moved items')
    containerId = targetId
    index = target.childIds.length
  } else {
    const location = selectParent(document, targetId)
    if (!location) return invalid('The root accepts drops only inside')
    containerId = location.parentId
    index = location.index + (position === 'after' ? 1 : 0)
  }

  if (insideSelection(document, containerId, new Set(sourceIds)))
    return invalid('A selection cannot move into its own descendant')
  const destination = document.nodes[containerId]
  if (destination?.type !== 'container' || destination.kind === 'scalar')
    return invalid('The drop destination cannot contain moved items')
  const captionError = validateObjectCaptions(document, destination, sourceIds)
  if (captionError) return invalid(captionError)
  return {
    ok: true,
    sourceIds,
    intent: { targetId, position, containerId, index },
  }
}

function validateObjectCaptions(
  document: JsonDocument,
  destination: ContainerNode,
  sourceIds: readonly NodeId[],
): string | null {
  if (destination.kind !== 'object' && destination.kind !== 'neutral')
    return null
  if (
    destination.kind === 'neutral' &&
    sourceIds.some((id) => {
      const node = document.nodes[id]
      return node?.type !== 'container' || node.caption === null
    })
  )
    return null
  const moved = new Set(sourceIds)
  const captions = new Set(
    destination.entries
      .filter((entry) => !moved.has(entry.nodeId))
      .map((entry) => entry.key),
  )
  for (const id of sourceIds) {
    const node = document.nodes[id]
    if (node?.type !== 'container' || node.caption === null)
      return 'Object headers accept only named headers'
    if (captions.has(node.caption))
      return `Duplicate caption at destination: ${node.caption}`
    captions.add(node.caption)
  }
  return null
}

function insideSelection(
  document: JsonDocument,
  targetId: NodeId,
  sourceIds: ReadonlySet<NodeId>,
): boolean {
  let cursor: NodeId | undefined = targetId
  while (cursor !== undefined) {
    if (sourceIds.has(cursor)) return true
    cursor = selectParent(document, cursor)?.parentId
  }
  return false
}

function invalid(reason: string): DropResolution {
  return { ok: false, reason }
}
