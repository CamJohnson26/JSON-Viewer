import { describe, expect, test } from 'vitest'

import {
  nodeId,
  parseJson,
  type JsonDocument,
  type NodeId,
} from '../domain/document/index.ts'
import {
  ancestorIds,
  descendantContainerIds,
  resolveSourcePath,
  sourcePath,
} from './navigation.ts'

function parse(source: string): JsonDocument {
  let sequence = 0
  const result = parseJson(source, {}, () => nodeId(`path-${sequence++}`))
  if (!result.ok) throw new Error(result.error.message)
  return result.document
}

function captionId(document: JsonDocument, caption: string): NodeId {
  const found = Object.values(document.nodes).find(
    (node) => node.type === 'container' && node.caption === caption,
  )
  if (!found) throw new Error(`Missing caption ${caption}`)
  return found.id
}

describe('source path navigation', () => {
  test('round trips escaped RFC 6901-style paths', () => {
    const document = parse('{"a/b":{"~name":3}}')
    const target = captionId(document, '~name')
    expect(sourcePath(document, target)).toBe('/a~1b/~0name')
    expect(resolveSourcePath(document, '/a~1b/~0name')).toBe(target)
    expect(resolveSourcePath(document, '/a~2b')).toBeNull()
  })

  test('resolves ordered positions and returns ancestors for reveal', () => {
    const document = parse('[{"nested":[1]}]')
    const nested = captionId(document, 'nested')
    expect(sourcePath(document, nested)).toBe('/0/nested')
    expect(resolveSourcePath(document, '/0/nested')).toBe(nested)
    const root = document.nodes[document.rootId]
    if (root?.type !== 'container') throw new Error('Missing root')
    expect(ancestorIds(document, nested)).toEqual([
      document.rootId,
      root.childIds[0],
    ])
  })

  test('does not expose inferred scalar wrappers in source paths', () => {
    const document = parse('{"value":1}')
    const header = captionId(document, 'value')
    const primitive = document.nodes[header]
    if (primitive?.type !== 'container') throw new Error('Missing header')
    const value = primitive.childIds[0] as NodeId

    expect(sourcePath(document, value)).toBe('/value')
    expect(resolveSourcePath(document, '/value')).toBe(header)

    const scalar = parse('1')
    const root = scalar.nodes[scalar.rootId]
    if (root?.type !== 'container') throw new Error('Missing scalar root')
    expect(sourcePath(scalar, root.childIds[0] as NodeId)).toBe('')
  })

  test('collects descendant headers without duplicates', () => {
    const document = parse('{"a":{"b":[]},"c":[] }')
    const a = captionId(document, 'a')
    expect(descendantContainerIds(document, [a], true)).toEqual([
      a,
      captionId(document, 'b'),
    ])
    expect(descendantContainerIds(document, [a, a], false)).toEqual([
      captionId(document, 'b'),
    ])
  })
})
