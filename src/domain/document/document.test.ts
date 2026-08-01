import fc from 'fast-check'
import { describe, expect, test } from 'vitest'

import {
  createBlankDocument,
  createPrimitive,
  buildParentLookup,
  formatPrimitive,
  getContainer,
  inferContainer,
  insertNodes,
  materialize,
  nodeId,
  parseJson,
  pasteBeside,
  pasteInto,
  restoreTransition,
  serialize,
  unwrapHeader,
  validateDocument,
  wrapNode,
  type ContainerNode,
  type DocumentNode,
  type JsonDocument,
  type NodeId,
  type PrimitiveNode,
} from './index.ts'

function ids(prefix = 'id'): () => NodeId {
  let next = 0
  return () => nodeId(`${prefix}-${next++}`)
}

function parse(source: string, prefix = 'parse'): JsonDocument {
  const result = parseJson(source, {}, ids(prefix))
  if (!result.ok) throw new Error(result.error.message)
  return result.document
}

function header(id: string, caption: string | null = null): ContainerNode {
  return {
    id: nodeId(id),
    type: 'container',
    caption,
    kind: 'neutral',
    kindOrigin: 'neutral',
    childIds: [],
    entries: [],
  }
}

function insert(
  document: JsonDocument,
  parentId: NodeId,
  ...nodes: readonly DocumentNode[]
): JsonDocument {
  const additions = Object.fromEntries(
    nodes.map((node) => [node.id, node]),
  ) as Record<NodeId, DocumentNode>
  const result = insertNodes(
    document,
    parentId,
    additions,
    nodes.map((node) => node.id),
  )
  if (!result.ok) throw new Error(result.error.message)
  return result.document
}

describe('strict JSON parsing and normalized materialization', () => {
  test('preserves object order, source lexemes, and stable normalized IDs', () => {
    const document = parse('{"b":1e2,"a":"2026-08-01"}')
    const root = getContainer(document, document.rootId)

    expect(root.entries.map((entry) => entry.key)).toEqual(['b', 'a'])
    const dateHeader = getContainer(document, root.childIds[1] as NodeId)
    expect(document.nodes[dateHeader.childIds[0] as NodeId]).toMatchObject({
      sourceInput: '2026-08-01',
      detectedKind: 'date',
    })
    expect(new Set(Object.keys(document.nodes)).size).toBe(
      Object.keys(document.nodes).length,
    )
    expect(serialize(document)).toBe('{"b":100,"a":"2026-08-01"}')
    expect(validateDocument(document)).toEqual([])

    const integerKeys = parse('{"2":"second","1":"first"}')
    expect(serialize(integerKeys)).toBe('{"2":"second","1":"first"}')
  })

  test.each([
    ['{"a":1,"a":2}', 'DuplicateKey'],
    ['{"a":1,}', 'TrailingComma'],
    ['[1,]', 'TrailingComma'],
    ['{/* no */"a":1}', 'CommentsNotAllowed'],
    ['// no\n1', 'CommentsNotAllowed'],
    ['{a:1}', 'Syntax'],
    ['01', 'Syntax'],
  ])('rejects %s as %s', (source, code) => {
    const result = parseJson(source, {}, ids())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe(code)
  })

  test('reports source locations and configurable resource guards', () => {
    const duplicate = parseJson('{\n  "x": 1,\n  "x": 2\n}', {}, ids())
    expect(duplicate.ok).toBe(false)
    if (!duplicate.ok)
      expect(duplicate.error).toMatchObject({
        code: 'DuplicateKey',
        line: 3,
        column: 3,
      })

    for (const result of [
      parseJson('[1]', { maxInputLength: 2 }, ids()),
      parseJson('[[0]]', { maxDepth: 1 }, ids()),
      parseJson('[1,2]', { maxNodes: 2 }, ids()),
      parseJson('"long"', { maxStringLength: 3 }, ids()),
    ]) {
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('ResourceLimit')
    }
  })

  test('reserves IDs before recursively building children', () => {
    for (const source of ['[0]', '{"a":0}', '0']) {
      const duplicateId = nodeId(`duplicate-${source}`)
      const result = parseJson(source, {}, () => duplicateId)
      expect(result).toMatchObject({
        ok: false,
        error: {
          code: 'ResourceLimit',
          message: 'ID factory produced a duplicate ID',
        },
      })
    }
  })

  test('stops recursive parsing at maxNodes before document IDs are allocated', () => {
    let allocations = 0
    const result = parseJson('[0,1,2,3,4]', { maxNodes: 3 }, () =>
      nodeId(`unused-${allocations++}`),
    )

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'ResourceLimit', message: 'Input exceeds maxNodes' },
    })
    expect(allocations).toBe(0)
  })

  test('round-trips every generated JSON value and satisfies invariants', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const source = JSON.stringify(value)
        const result = parseJson(source, {}, ids('property'))
        expect(result.ok).toBe(true)
        if (result.ok) {
          const canonical = JSON.stringify(value)
          expect(JSON.stringify(materialize(result.document))).toBe(canonical)
          expect(validateDocument(result.document)).toEqual([])
          expect(serialize(result.document)).toBe(canonical)
        }
      }),
      { numRuns: 200 },
    )
  })
})

describe('primitive detection and additive formatting', () => {
  test.each([
    ['1', 'number', 1],
    ['-0.25e2', 'number', -25],
    ['true', 'boolean', true],
    ['null', 'null', null],
    ['2024-02-29', 'date', '2024-02-29'],
    ['2026-08-01T14:30:45+02:00', 'datetime', '2026-08-01T14:30:45+02:00'],
    ['2023-02-29T14:30:45Z', 'string', '2023-02-29T14:30:45Z'],
    ['2023-02-29', 'string', '2023-02-29'],
    ['01', 'string', '01'],
    ['1 ', 'string', '1 '],
    ['08/01/2026', 'string', '08/01/2026'],
  ])('detects %s as %s', (source, kind, value) => {
    const primitive = createPrimitive(nodeId('primitive'), source)
    expect(primitive).toMatchObject({
      sourceInput: source,
      detectedKind: kind,
      value,
    })
  })

  test('formats without changing source or semantic values and honors overrides', () => {
    const number = createPrimitive(nodeId('number'), '12345.5')
    const date = createPrimitive(nodeId('date'), '2026-08-01')
    const datetime = createPrimitive(
      nodeId('datetime'),
      '2026-08-01T14:30:45+02:00',
    )

    expect(formatPrimitive(number, { enabled: true })).toBe('12,345.5')
    expect(formatPrimitive(date, { enabled: true })).toBe('Aug 1, 2026')
    expect(formatPrimitive(datetime, { enabled: true })).toBe(
      'Aug 1, 2026, 12:30:45 UTC',
    )
    expect(formatPrimitive(number, { enabled: false })).toBe('12345.5')
    expect(
      formatPrimitive({ ...number, formatting: 'source' }, { enabled: true }),
    ).toBe('12345.5')
    expect(
      formatPrimitive(
        { ...number, formatting: 'formatted' },
        { enabled: false },
      ),
    ).toBe('12,345.5')
    expect(number).toMatchObject({ sourceInput: '12345.5', value: 12345.5 })
  })

  test('formats imported string content without changing its JSON type', () => {
    const document = parse('["false","123","null"]')
    const children = getContainer(document, document.rootId).childIds

    expect(
      children.map((id) =>
        formatPrimitive(document.nodes[id] as PrimitiveNode, { enabled: true }),
      ),
    ).toEqual(['FALSE', '123', 'NULL'])
    expect(materialize(document)).toEqual(['false', '123', 'null'])
  })
})

describe('container inference contract', () => {
  test('materializes one and several direct primitives as ordered arrays', () => {
    const blank = createBlankDocument(nodeId('root'))
    const one = insert(blank, blank.rootId, createPrimitive(nodeId('one'), '1'))
    const several = insert(one, one.rootId, createPrimitive(nodeId('two'), '2'))

    expect(materialize(one)).toEqual([1])
    expect(materialize(several)).toEqual([1, 2])
    expect(getContainer(several, several.rootId).kind).toBe('array')
  })

  test('infers captioned headers as keyed and mixed insertions as ordered', () => {
    const blank = createBlankDocument(nodeId('root'))
    const a = header('a-header', 'a')
    const aValue = createPrimitive(nodeId('a-value'), '1')
    const withA = insert(blank, blank.rootId, a)
    const keyed = insert(withA, a.id, aValue)
    const b = header('b-header', 'b')
    const bValue = createPrimitive(nodeId('b-value'), '2')
    const withB = insert(insert(keyed, keyed.rootId, b), b.id, bValue)

    expect(materialize(keyed)).toEqual({ a: 1 })
    expect(materialize(withB)).toEqual({ a: 1, b: 2 })

    const trailingPrimitive = insert(
      withB,
      withB.rootId,
      createPrimitive(nodeId('tail'), '3'),
    )
    expect(materialize(trailingPrimitive)).toEqual([{ a: 1 }, { b: 2 }, 3])

    const primitiveFirst = insert(
      blank,
      blank.rootId,
      createPrimitive(nodeId('first'), '1'),
    )
    const mixed = insert(
      insert(primitiveFirst, primitiveFirst.rootId, b),
      b.id,
      bValue,
    )
    expect(materialize(mixed)).toEqual([1, { b: 2 }])
  })

  test('wraps and unwraps ordered/keyed shapes with stable IDs and exact inverse snapshots', () => {
    const start = parse('[1,2]', 'start')
    const root = getContainer(start, start.rootId)
    const first = root.childIds[0] as NodeId
    const second = root.childIds[1] as NodeId
    const wrappedA = wrapNode(start, first, header('wrap-a', 'a'))
    expect(wrappedA.ok).toBe(true)
    if (!wrappedA.ok) return
    expect(materialize(wrappedA.document)).toEqual([{ a: 1 }, 2])
    expect(wrappedA.focusId).toBe(nodeId('wrap-a'))

    const wrappedB = wrapNode(wrappedA.document, second, header('wrap-b', 'b'))
    expect(wrappedB.ok).toBe(true)
    if (!wrappedB.ok) return
    expect(materialize(wrappedB.document)).toEqual({ a: 1, b: 2 })

    const unwrappedA = unwrapHeader(wrappedB.document, nodeId('wrap-a'))
    expect(unwrappedA.ok).toBe(true)
    if (!unwrappedA.ok) return
    expect(materialize(unwrappedA.document)).toEqual([1, { b: 2 }])
    expect(unwrappedA.focusId).toBe(first)

    const restored = restoreTransition(unwrappedA.inverse, unwrappedA.document)
    expect(restored.ok).toBe(true)
    if (restored.ok) expect(restored.document).toBe(wrappedB.document)
  })

  test('handles paste into, empty known kinds, collisions, and paste beside', () => {
    const ordered = parse('[0]', 'ordered')
    const intoOrdered = pasteInto(
      ordered,
      ordered.rootId,
      parse('[1,2]', 'array-paste'),
    )
    expect(intoOrdered.ok).toBe(true)
    if (intoOrdered.ok)
      expect(materialize(intoOrdered.document)).toEqual([0, 1, 2])

    const keyed = parse('{"a":0}', 'keyed')
    const intoKeyed = pasteInto(
      keyed,
      keyed.rootId,
      parse('{"b":1}', 'object-paste'),
    )
    expect(intoKeyed.ok).toBe(true)
    if (intoKeyed.ok)
      expect(materialize(intoKeyed.document)).toEqual({ a: 0, b: 1 })

    const mixed = pasteInto(keyed, keyed.rootId, parse('[1,2]', 'mixed-paste'))
    expect(mixed.ok).toBe(true)
    if (mixed.ok) expect(materialize(mixed.document)).toEqual([{ a: 0 }, 1, 2])

    const collision = pasteInto(
      keyed,
      keyed.rootId,
      parse('{"a":2}', 'collision'),
    )
    expect(collision).toMatchObject({
      ok: false,
      error: { code: 'DuplicateCaption' },
    })
    expect(materialize(keyed)).toEqual({ a: 0 })

    const nothing = pasteInto(ordered, ordered.rootId, parse('[]', 'empty'))
    expect(nothing).toMatchObject({
      ok: false,
      error: { code: 'NothingToInsert' },
    })

    for (const source of ['[]', '{}']) {
      const blank = createBlankDocument(nodeId(`blank-${source}`))
      const adoption = pasteInto(
        blank,
        blank.rootId,
        parse(source, `adopt-${source}`),
      )
      expect(adoption.ok).toBe(true)
      if (adoption.ok) expect(serialize(adoption.document)).toBe(source)
    }

    const target = getContainer(ordered, ordered.rootId).childIds[0] as NodeId
    const beside = pasteBeside(ordered, target, parse('[1,2]', 'beside'))
    expect(beside.ok).toBe(true)
    if (beside.ok) {
      expect(materialize(beside.document)).toEqual([0, [1, 2]])
      expect(validateDocument(beside.document)).toEqual([])
      expect(restoreTransition(beside.inverse, beside.document)).toMatchObject({
        ok: true,
        document: ordered,
      })
    }

    const keyedTarget = getContainer(keyed, keyed.rootId).childIds[0] as NodeId
    const objectBeside = pasteBeside(
      keyed,
      keyedTarget,
      parse('{"b":1}', 'object-beside'),
    )
    expect(objectBeside.ok).toBe(true)
    if (objectBeside.ok) {
      const pastedHeader = objectBeside.focusId
      const root = getContainer(
        objectBeside.document,
        objectBeside.document.rootId,
      )
      expect(root.childIds).toEqual([keyedTarget, pastedHeader])
      expect(getContainer(objectBeside.document, pastedHeader).caption).toBe(
        'b',
      )
      expect(
        objectBeside.document.nodes[nodeId('object-beside-0')],
      ).toBeUndefined()
      expect(materialize(objectBeside.document)).toEqual([{ a: 0 }, { b: 1 }])
      expect(validateDocument(objectBeside.document)).toEqual([])
      const renamedHeader = {
        ...getContainer(objectBeside.document, pastedHeader),
        caption: 'c',
      }
      const renamedDraft: JsonDocument = {
        ...objectBeside.document,
        nodes: {
          ...objectBeside.document.nodes,
          [pastedHeader]: renamedHeader,
        },
      }
      expect(
        inferContainer(
          renamedDraft,
          getContainer(renamedDraft, renamedDraft.rootId),
        ),
      ).toMatchObject({ kind: 'array', kindOrigin: 'inferred-ordered' })

      const restored = restoreTransition(
        objectBeside.inverse,
        objectBeside.document,
      )
      expect(restored.ok).toBe(true)
      if (restored.ok) {
        expect(restored.document).toBe(keyed)
        expect(restored.focusId).toBe(keyedTarget)
      }
    }

    const arrayBeside = pasteBeside(
      keyed,
      keyedTarget,
      parse('[1,2]', 'array-beside'),
    )
    expect(arrayBeside.ok).toBe(true)
    if (arrayBeside.ok) {
      expect(materialize(arrayBeside.document)).toEqual([{ a: 0 }, [1, 2]])
    }

    const neutral = createBlankDocument(nodeId('neutral-root'))
    const adoptedBeside = pasteBeside(
      neutral,
      neutral.rootId,
      parse('{"a":1}', 'beside-adoption'),
    )
    expect(adoptedBeside.ok).toBe(true)
    if (adoptedBeside.ok) {
      expect(adoptedBeside.document.rootId).toBe(neutral.rootId)
      expect(materialize(adoptedBeside.document)).toEqual({ a: 1 })
    }
  })

  test('retains imported empty kinds and rejects duplicate inferred captions', () => {
    const array = parse('[]')
    expect(getContainer(array, array.rootId).kind).toBe('array')
    const object = parse('{}')
    expect(getContainer(object, object.rootId).kind).toBe('object')

    const blank = createBlankDocument(nodeId('root'))
    const first = header('first', 'same')
    const second = header('second', 'same')
    const draft: JsonDocument = {
      rootId: blank.rootId,
      nodes: {
        ...blank.nodes,
        [first.id]: first,
        [second.id]: second,
        [blank.rootId]: {
          ...getContainer(blank, blank.rootId),
          childIds: [first.id, second.id],
        },
      },
    }
    expect(
      inferContainer(draft, getContainer(draft, draft.rootId)),
    ).toMatchObject({ code: 'DuplicateCaption' })
  })
})

describe('document invariants', () => {
  test('builds correct keyed parent locations for wide aligned containers', () => {
    const width = 5_000
    const childIds = Array.from({ length: width }, (_, index) =>
      nodeId(`wide-child-${index}`),
    )
    const root = header('wide-root')
    const children = Object.fromEntries(
      childIds.map((id, index) => [id, header(id, `key-${index}`)]),
    ) as Record<NodeId, ContainerNode>
    const document: JsonDocument = {
      rootId: root.id,
      nodes: {
        ...children,
        [root.id]: {
          ...root,
          kind: 'object',
          kindOrigin: 'inferred',
          childIds,
          entries: childIds.map((id, index) => ({
            key: `key-${index}`,
            nodeId: id,
          })),
        },
      },
    }

    const parents = buildParentLookup(document)
    expect(parents.size).toBe(width)
    for (const index of [0, 2_499, width - 1]) {
      expect(parents.get(childIds[index] as NodeId)).toEqual({
        parentId: root.id,
        index,
        key: `key-${index}`,
      })
    }
    expect(validateDocument(document)).toEqual([])
  })

  test('reports missing children, cycles, multiple parents, and record ID mismatches', () => {
    const root = header('root')
    const child = header('child')
    const malformed: JsonDocument = {
      rootId: root.id,
      nodes: {
        [root.id]: { ...root, childIds: [child.id, nodeId('missing')] },
        [child.id]: { ...child, childIds: [root.id] },
        [nodeId('wrong-record-key')]: createPrimitive(nodeId('actual-id'), '1'),
      },
    }

    expect(
      validateDocument(malformed).map((violation) => violation.code),
    ).toEqual(
      expect.arrayContaining([
        'MissingChild',
        'Cycle',
        'MultipleParents',
        'IdMismatch',
        'UnreachableNode',
      ]),
    )
  })

  test('rejects invalid root and primitive metadata states', () => {
    const root = header('root', 'caption')
    const primitive = {
      ...createPrimitive(nodeId('primitive'), '1'),
      value: Number.NaN,
    }
    const document: JsonDocument = {
      rootId: root.id,
      nodes: {
        [root.id]: { ...root, childIds: [primitive.id] },
        [primitive.id]: primitive,
      },
    }

    expect(validateDocument(document).map(({ code }) => code)).toEqual(
      expect.arrayContaining(['InvalidContainer', 'InvalidPrimitive']),
    )
  })
})
