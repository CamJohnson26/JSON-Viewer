import type { JsonDocument, NodeId } from '../domain/document/index.ts'
import { selectParent } from '../state/selectors.ts'

export function escapePathSegment(segment: string): string {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1')
}

export function unescapePathSegment(segment: string): string | null {
  if (/~(?:[^01]|$)/.test(segment)) return null
  return segment.replace(/~1/g, '/').replace(/~0/g, '~')
}

export function sourcePath(document: JsonDocument, id: NodeId): string | null {
  if (!document.nodes[id]) return null
  const parts: string[] = []
  let cursor = id
  while (cursor !== document.rootId) {
    const location = selectParent(document, cursor)
    if (!location) return null
    const node = document.nodes[cursor]
    const parent = document.nodes[location.parentId]
    if (!node || parent?.type !== 'container') return null
    const collapsesPrimitive =
      node.type === 'primitive' &&
      parent.caption !== null &&
      parent.kindOrigin === 'inferred' &&
      parent.childIds.length === 1
    if (parent.kind !== 'scalar' && !collapsesPrimitive) {
      const keyed = parent.entries.find((entry) => entry.nodeId === cursor)
      parts.push(escapePathSegment(keyed?.key ?? String(location.index)))
    }
    cursor = location.parentId
  }
  return parts.length === 0 ? '' : `/${parts.reverse().join('/')}`
}

export function resolveSourcePath(
  document: JsonDocument,
  path: string,
): NodeId | null {
  if (path === '') return document.rootId
  if (!path.startsWith('/')) return null
  let cursor = document.rootId
  for (const encoded of path.slice(1).split('/')) {
    const segment = unescapePathSegment(encoded)
    const node = document.nodes[cursor]
    if (segment === null || node?.type !== 'container') return null
    const keyed = node.entries.find((entry) => entry.key === segment)?.nodeId
    const index = /^(0|[1-9]\d*)$/.test(segment) ? Number(segment) : -1
    const next = keyed ?? node.childIds[index]
    if (!next) return null
    cursor = next
  }
  return cursor
}

export function ancestorIds(
  document: JsonDocument,
  id: NodeId,
): readonly NodeId[] {
  const result: NodeId[] = []
  let parent = selectParent(document, id)
  while (parent) {
    result.push(parent.parentId)
    parent = selectParent(document, parent.parentId)
  }
  return result.reverse()
}

export function descendantContainerIds(
  document: JsonDocument,
  roots: readonly NodeId[],
  includeRoots = false,
): readonly NodeId[] {
  const result: NodeId[] = []
  const seen = new Set<NodeId>()
  const visit = (id: NodeId, root: boolean): void => {
    if (seen.has(id)) return
    seen.add(id)
    const node = document.nodes[id]
    if (node?.type !== 'container') return
    if (includeRoots || !root) result.push(id)
    node.childIds.forEach((childId) => visit(childId, false))
  }
  roots.forEach((id) => visit(id, true))
  return result
}
