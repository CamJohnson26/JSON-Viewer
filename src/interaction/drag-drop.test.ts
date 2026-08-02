import { describe, expect, test } from 'vitest'

import {
  nodeId,
  parseJson,
  type JsonDocument,
  type NodeId,
} from '../domain/document/index.ts'
import { dropPositionFromPoint, resolveDropIntent } from './drag-drop.ts'

function parse(source: string): JsonDocument {
  let sequence = 0
  const result = parseJson(source, {}, () => nodeId(`drag-${sequence++}`))
  if (!result.ok) throw new Error(result.error.message)
  return result.document
}

function children(
  document: JsonDocument,
  id = document.rootId,
): readonly NodeId[] {
  const node = document.nodes[id]
  if (node?.type !== 'container') throw new Error('Expected container')
  return node.childIds
}

describe('drag-and-drop intent resolution', () => {
  test('maps row geometry to before, inside, and after zones', () => {
    const bounds = { top: 100, bottom: 140 }
    expect(dropPositionFromPoint(bounds, 104, true)).toBe('before')
    expect(dropPositionFromPoint(bounds, 120, true)).toBe('inside')
    expect(dropPositionFromPoint(bounds, 136, true)).toBe('after')
    expect(dropPositionFromPoint(bounds, 112, false)).toBe('before')
    expect(dropPositionFromPoint(bounds, 128, false)).toBe('after')
  })

  test('resolves pre-removal indexes for before, after, and inside drops', () => {
    const document = parse('[[1,2],[],3]')
    const [source, target, three] = children(document) as [
      NodeId,
      NodeId,
      NodeId,
    ]
    const one = children(document, source)[0] as NodeId
    expect(
      resolveDropIntent(document, [three], source, 'before'),
    ).toMatchObject({
      ok: true,
      intent: { containerId: document.rootId, index: 0 },
    })
    expect(resolveDropIntent(document, [source], three, 'after')).toMatchObject(
      {
        ok: true,
        intent: { containerId: document.rootId, index: 3 },
      },
    )
    expect(resolveDropIntent(document, [one], target, 'inside')).toMatchObject({
      ok: true,
      intent: { containerId: target, index: 0 },
    })
  })

  test('normalizes selected roots and permits mixed-parent blocks', () => {
    const document = parse('[[1],2,[]]')
    const [parent, two, target] = children(document) as [NodeId, NodeId, NodeId]
    const one = children(document, parent)[0] as NodeId
    expect(
      resolveDropIntent(document, [one, parent, two], target, 'inside'),
    ).toMatchObject({
      ok: true,
      sourceIds: [parent, two],
    })
  })

  test('rejects roots, self targets, descendant cycles, and scalar targets', () => {
    const nested = parse('[[1]]')
    const outer = children(nested)[0] as NodeId
    const one = children(nested, outer)[0] as NodeId
    expect(
      resolveDropIntent(nested, [nested.rootId], outer, 'before'),
    ).toMatchObject({ ok: false })
    expect(resolveDropIntent(nested, [outer], outer, 'after')).toMatchObject({
      ok: false,
    })
    expect(resolveDropIntent(nested, [outer], one, 'after')).toMatchObject({
      ok: false,
    })

    const scalar = parse('1')
    const value = children(scalar)[0] as NodeId
    expect(
      resolveDropIntent(scalar, [value], scalar.rootId, 'inside'),
    ).toMatchObject({ ok: false })
  })

  test('rejects unnamed and duplicate captions at object destinations', () => {
    const unnamed = parse('[1,{"target":{}}]')
    const [value, wrapper] = children(unnamed) as [NodeId, NodeId]
    const target = children(unnamed, wrapper)[0] as NodeId
    expect(resolveDropIntent(unnamed, [value], target, 'inside')).toMatchObject(
      { ok: false },
    )

    const duplicate = parse('[{"name":1},{"name":2}]')
    const [left, right] = children(duplicate) as [NodeId, NodeId]
    const leftName = children(duplicate, left)[0] as NodeId
    const rightName = children(duplicate, right)[0] as NodeId
    const collision = resolveDropIntent(duplicate, [leftName], right, 'inside')
    expect(collision.ok).toBe(false)
    if (!collision.ok) expect(collision.reason).toContain('Duplicate caption')
    expect(
      resolveDropIntent(duplicate, [leftName], rightName, 'before'),
    ).toMatchObject({ ok: false })
  })

  test('prevalidates duplicate captions when an empty destination would infer an object', () => {
    const parsed = parse('[[{"same":1}],[{"same":2}],[]]')
    const target = children(parsed)[2] as NodeId
    const sources = Object.values(parsed.nodes)
      .filter((node) => node.type === 'container' && node.caption === 'same')
      .map((node) => node.id)
    const document: JsonDocument = {
      ...parsed,
      nodes: {
        ...parsed.nodes,
        [target]: {
          ...parsed.nodes[target],
          kind: 'neutral',
          kindOrigin: 'neutral',
        } as (typeof parsed.nodes)[NodeId],
      },
    }
    const result = resolveDropIntent(document, sources, target, 'inside')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('Duplicate caption')
  })
})
