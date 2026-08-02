import fc from 'fast-check'
import { describe, expect, test } from 'vitest'

import {
  getContainer,
  materialize,
  nodeId,
  parseJson,
  serialize,
  validateDocument,
  type JsonDocument,
  type JsonValue,
  type NodeId,
} from '../document/index.ts'
import {
  CLIPBOARD_CONTEXT_TABLE,
  JSON_OPERATION_CATALOG,
  JSON_OPERATION_VERSION,
  applyJsonOperation,
  findMatchingIds,
  serializeObjectParts,
  serializeSelection,
  type JsonOperation,
  type JsonOperationInput,
  type OperationDependencies,
} from './index.ts'

function ids(prefix: string): () => NodeId {
  let next = 0
  return () => nodeId(`${prefix}-${next++}`)
}

function parse(source: string, prefix = 'source'): JsonDocument {
  const result = parseJson(source, {}, ids(prefix))
  if (!result.ok) throw new Error(result.error.message)
  return result.document
}

function dependencies(prefix = 'generated'): OperationDependencies {
  let uuid = 0
  let timestamp = 0
  return {
    createId: ids(prefix),
    createUuid: () => `uuid-${uuid++}`,
    createTimestamp: () => `2026-08-01T00:00:0${timestamp++}Z`,
  }
}

function op<T extends JsonOperationInput>(
  operation: T,
): T & { readonly version: typeof JSON_OPERATION_VERSION } {
  return { version: JSON_OPERATION_VERSION, ...operation }
}

function apply(
  document: JsonDocument,
  selectedIds: readonly NodeId[],
  operation: JsonOperationInput,
): JsonDocument {
  const result = applyJsonOperation(
    document,
    selectedIds,
    op(operation),
    dependencies(),
  )
  if (!result.ok)
    throw new Error(`${result.error.code}: ${result.error.message}`)
  expect(validateDocument(result.document)).toEqual([])
  return result.document
}

function rootChildren(document: JsonDocument): readonly NodeId[] {
  return getContainer(document, document.rootId).childIds
}

describe('contextual clipboard serialization', () => {
  test('uses the isolated context table for single values and keyed sibling fragments', () => {
    const document = parse('{"b":2,"a":1}')
    const [b, a] = rootChildren(document) as [NodeId, NodeId]

    expect(serializeSelection(document, [a])).toMatchObject({
      ok: true,
      context: CLIPBOARD_CONTEXT_TABLE.single,
      value: 1,
      text: '1',
    })
    expect(serializeSelection(document, [a, b])).toMatchObject({
      ok: true,
      context: CLIPBOARD_CONTEXT_TABLE.uniqueCaptionedSiblings,
      value: { b: 2, a: 1 },
      text: '{"b":2,"a":1}',
    })
  })

  test('uses arrays for ordered and mixed selections in visible order', () => {
    const document = parse('[3,{"x":1},2]')
    const [three, object, two] = rootChildren(document) as [
      NodeId,
      NodeId,
      NodeId,
    ]
    expect(serializeSelection(document, [two, object, three])).toMatchObject({
      ok: true,
      context: CLIPBOARD_CONTEXT_TABLE.orderedOrMixed,
      value: [3, { x: 1 }, 2],
    })
  })

  test('preserves captioned nodes as singleton objects outside keyed parents', () => {
    const source = parse('{"a":1,"b":2,"target":[]}')
    const [a, b, target] = rootChildren(source) as [NodeId, NodeId, NodeId]
    const moved = apply(source, [a, b], {
      type: 'structure.move-to',
      containerId: target,
      index: 0,
    })
    expect(serializeSelection(moved, [a, b])).toMatchObject({
      ok: true,
      context: CLIPBOARD_CONTEXT_TABLE.orderedOrMixed,
      value: [{ a: 1 }, { b: 2 }],
      text: '[{"a":1},{"b":2}]',
    })
  })

  test('preserves visible order for integer-like keyed captions', () => {
    const document = parse('{"2":"second","1":"first"}')
    const result = serializeSelection(document, rootChildren(document))
    expect(result).toMatchObject({
      ok: true,
      context: CLIPBOARD_CONTEXT_TABLE.uniqueCaptionedSiblings,
      text: '{"2":"second","1":"first"}',
    })
  })

  test('serializes __proto__ as an own clipboard key without prototype mutation', () => {
    const document = parse('{"__proto__":1,"constructor":2}')
    const result = serializeSelection(document, rootChildren(document))
    expect(result.ok && result.text).toBe('{"__proto__":1,"constructor":2}')
    if (result.ok) {
      expect(Object.hasOwn(result.value as object, '__proto__')).toBe(true)
      expect(Object.getPrototypeOf(result.value)).toBeNull()
    }
    expect(Object.prototype).not.toHaveProperty('polluted')
  })

  test.each([
    [[], 'EmptySelection'],
    [[nodeId('missing')], 'UnknownSelection'],
  ])('rejects invalid selection %j as %s', (selection, code) => {
    const result = serializeSelection(parse('[1]'), selection)
    expect(result).toMatchObject({ ok: false, error: { code } })
  })

  test('rejects duplicate and ancestor-overlapping selections deterministically', () => {
    const document = parse('[[1]]')
    const child = rootChildren(document)[0] as NodeId
    const grandchild = getContainer(document, child).childIds[0] as NodeId
    expect(serializeSelection(document, [child, child])).toMatchObject({
      ok: false,
      error: { code: 'OverlappingSelection' },
    })
    expect(serializeSelection(document, [grandchild, child])).toMatchObject({
      ok: false,
      error: { code: 'OverlappingSelection', nodeId: grandchild },
    })
  })

  test('copies direct object captions and values as deterministic JSON arrays', () => {
    const document = parse('{"outer":{"firstName":1,"details":{"x":2}}}')
    const outer = rootChildren(document)[0] as NodeId
    const before = serialize(document)

    expect(
      serializeObjectParts(document, [outer], 'captions', 2),
    ).toMatchObject({
      ok: true,
      value: ['firstName', 'details'],
      text: '[\n  "firstName",\n  "details"\n]',
    })
    expect(serializeObjectParts(document, [outer], 'values')).toMatchObject({
      ok: true,
      value: [1, { x: 2 }],
      text: '[1,{"x":2}]',
    })
    expect(serialize(document)).toBe(before)
  })

  test('rejects bulk copying from non-object selections', () => {
    const document = parse('[[1]]')
    const array = rootChildren(document)[0] as NodeId
    expect(serializeObjectParts(document, [array], 'values')).toMatchObject({
      ok: false,
      error: { code: 'IncompatibleSelection', nodeId: array },
    })
  })
})

describe('structural operations', () => {
  test('moves sibling blocks up/down and preserves unaffected records', () => {
    const document = parse('[0,1,2,3]')
    const [zero, one, two, three] = rootChildren(document) as NodeId[]
    const originalZero = document.nodes[zero as NodeId]
    const down = apply(document, [one as NodeId, two as NodeId], {
      type: 'structure.move',
      direction: 'down',
    })
    expect(materialize(down)).toEqual([0, 3, 1, 2])
    expect(down.nodes[zero as NodeId]).toBe(originalZero)
    const up = apply(down, [one as NodeId, two as NodeId], {
      type: 'structure.move',
      direction: 'up',
    })
    expect(materialize(up)).toEqual([0, 1, 2, 3])
    expect(up.nodes[three as NodeId]).toBe(document.nodes[three as NodeId])
  })

  test('moves to a container/index and rejects cycles and illegal object captions', () => {
    const document = parse('[[1,2],[]]')
    const [source, target] = rootChildren(document) as [NodeId, NodeId]
    const one = getContainer(document, source).childIds[0] as NodeId
    expect(
      materialize(
        apply(document, [one], {
          type: 'structure.move-to',
          containerId: target,
          index: 0,
        }),
      ),
    ).toEqual([[2], [1]])

    expect(
      applyJsonOperation(
        document,
        [source],
        op({ type: 'structure.move-to', containerId: source, index: 0 }),
        dependencies(),
      ),
    ).toMatchObject({ ok: false, error: { code: 'Cycle' } })

    const object = parse('[1,{"a":2}]')
    const [primitive, targetObject] = rootChildren(object) as [NodeId, NodeId]
    expect(
      applyJsonOperation(
        object,
        [primitive],
        op({
          type: 'structure.move-to',
          containerId: targetObject,
          index: 0,
        }),
        dependencies(),
      ),
    ).toMatchObject({ ok: false, error: { code: 'InvalidTarget' } })
  })

  test('moves mixed-parent roots as one document-ordered block', () => {
    const document = parse('[[1],[2],[]]')
    const [left, right, target] = rootChildren(document) as [
      NodeId,
      NodeId,
      NodeId,
    ]
    const one = getContainer(document, left).childIds[0] as NodeId
    const two = getContainer(document, right).childIds[0] as NodeId
    const moved = apply(document, [two, one], {
      type: 'structure.move-to',
      containerId: target,
      index: 0,
    })
    expect(materialize(moved)).toEqual([[], [], [1, 2]])
  })

  test('reverses, flattens losslessly, removes empties, and removes selections', () => {
    const nested = parse('[[1,2],3]')
    const nestedId = rootChildren(nested)[0] as NodeId
    expect(
      materialize(apply(nested, [nestedId], { type: 'structure.flatten' })),
    ).toEqual([1, 2, 3])

    const values = parse('["",null,0,[],{},false]')
    expect(
      materialize(
        apply(values, [values.rootId], { type: 'structure.remove-empty' }),
      ),
    ).toEqual([0, false])

    const reversed = apply(values, [values.rootId], {
      type: 'structure.reverse',
    })
    expect(materialize(reversed)).toEqual([false, {}, [], 0, null, ''])
    const removeId = rootChildren(reversed)[0] as NodeId
    expect(
      materialize(apply(reversed, [removeId], { type: 'structure.remove' })),
    ).toEqual([{}, [], 0, null, ''])
  })

  test('normalizes emptied inferred headers after remove and move', () => {
    const removed = parse('{"a":1}')
    const a = rootChildren(removed)[0] as NodeId
    const primitive = getContainer(removed, a).childIds[0] as NodeId
    const result = apply(removed, [primitive], { type: 'structure.remove' })
    expect(materialize(result)).toEqual({ a: [] })
    expect(getContainer(result, a)).toMatchObject({
      kind: 'neutral',
      kindOrigin: 'neutral',
    })

    const moved = parse('{"a":1,"target":[]}')
    const [source, target] = rootChildren(moved) as [NodeId, NodeId]
    const value = getContainer(moved, source).childIds[0] as NodeId
    const moveResult = apply(moved, [value], {
      type: 'structure.move-to',
      containerId: target,
      index: 0,
    })
    expect(materialize(moveResult)).toEqual({ a: [], target: [1] })
    expect(getContainer(moveResult, source).kind).toBe('neutral')
  })

  test('infers an empty neutral move destination without losing the source value', () => {
    const document = parse('{"source":1,"target":[]}')
    const [source, target] = rootChildren(document) as [NodeId, NodeId]
    const value = getContainer(document, source).childIds[0] as NodeId
    const neutralDocument: JsonDocument = {
      ...document,
      nodes: {
        ...document.nodes,
        [target]: {
          ...getContainer(document, target),
          kind: 'neutral',
          kindOrigin: 'neutral',
        },
      },
    }
    const moved = apply(neutralDocument, [value], {
      type: 'structure.move-to',
      containerId: target,
      index: 0,
    })
    expect(materialize(moved)).toEqual({ source: [], target: 1 })
    expect(getContainer(moved, target)).toMatchObject({
      kind: 'array',
      kindOrigin: 'inferred',
    })
  })
})

describe('text operations', () => {
  test.each([
    [{ type: 'text.case', mode: 'upper' }, ' HELLO WORLD '],
    [{ type: 'text.case', mode: 'lower' }, ' hello world '],
    [{ type: 'text.case', mode: 'title' }, ' Hello World '],
    [{ type: 'text.trim' }, 'hello WORLD'],
    [
      {
        type: 'text.replace',
        find: 'WORLD',
        replacement: 'there',
        caseSensitive: false,
      },
      ' hello there ',
    ],
    [{ type: 'text.affix', position: 'prefix', value: '>' }, '> hello WORLD '],
    [{ type: 'text.affix', position: 'suffix', value: '<' }, ' hello WORLD <'],
  ] as const)('applies %j predictably', (operation, expected) => {
    const document = parse('[" hello WORLD "]')
    const id = rootChildren(document)[0] as NodeId
    expect(materialize(apply(document, [id], operation))).toEqual([expected])
  })

  test('parses and emits JSON escape sequences', () => {
    const escaped = parse(JSON.stringify(['line\\nquote\\"']))
    const id = rootChildren(escaped)[0] as NodeId
    const parsed = apply(escaped, [id], { type: 'text.parse-escaped' })
    expect(materialize(parsed)).toEqual(['line\nquote"'])
    expect(materialize(apply(parsed, [id], { type: 'text.escape' }))).toEqual([
      'line\\nquote\\"',
    ])
  })

  test('treats replacement dollar tokens literally', () => {
    const document = parse('["before"]')
    const id = rootChildren(document)[0] as NodeId
    expect(
      materialize(
        apply(document, [id], {
          type: 'text.replace',
          find: 'before',
          replacement: '$& after',
          all: false,
          caseSensitive: true,
        }),
      ),
    ).toEqual(['$& after'])
  })

  test('returns typed errors for non-strings and invalid escapes', () => {
    const document = parse('[1,"\\\\x"]')
    const [number, invalid] = rootChildren(document) as [NodeId, NodeId]
    expect(
      applyJsonOperation(
        document,
        [number],
        op({ type: 'text.trim' }),
        dependencies(),
      ),
    ).toMatchObject({
      ok: false,
      error: { code: 'IncompatibleSelection', nodeId: number },
    })
    expect(
      applyJsonOperation(
        document,
        [invalid],
        op({ type: 'text.parse-escaped' }),
        dependencies(),
      ),
    ).toMatchObject({ ok: false, error: { code: 'InvalidEscape' } })
  })
})

describe('primitive conversion, formatting, and generation', () => {
  test.each([
    ['"12.5"', 'number', 12.5],
    ['"true"', 'boolean', true],
    ['42', 'string', '42'],
    ['false', 'null', null],
  ] as const)('converts %s to %s explicitly', (source, to, expected) => {
    const document = parse(`[${source}]`)
    const id = rootChildren(document)[0] as NodeId
    expect(
      materialize(apply(document, [id], { type: 'primitive.convert', to })),
    ).toEqual([expected])
  })

  test('applies date/number display overrides without changing JSON', () => {
    const document = parse('["2026-08-01",1000]')
    const [date, number] = rootChildren(document) as [NodeId, NodeId]
    const dateResult = apply(document, [date], {
      type: 'primitive.date-format',
      formatting: 'formatted',
    })
    const result = apply(dateResult, [number], {
      type: 'primitive.number-format',
      formatting: 'source',
    })
    expect(materialize(result)).toEqual(['2026-08-01', 1000])
    expect(result.nodes[date]).toMatchObject({ formatting: 'formatted' })
    expect(result.nodes[number]).toMatchObject({ formatting: 'source' })
  })

  test('uses injected UUID/timestamp values, toggles, and adjusts numbers', () => {
    const document = parse('["",false,2]')
    const [generated, boolean, number] = rootChildren(document) as NodeId[]
    const uuid = applyJsonOperation(
      document,
      [generated as NodeId],
      op({ type: 'primitive.generate', value: 'uuid' }),
      dependencies(),
    )
    expect(uuid.ok && materialize(uuid.document)).toEqual(['uuid-0', false, 2])
    const toggled = apply(document, [boolean as NodeId], {
      type: 'primitive.toggle',
    })
    expect(materialize(toggled)).toEqual(['', true, 2])
    const adjusted = apply(document, [number as NodeId], {
      type: 'primitive.adjust',
      amount: -1,
    })
    expect(materialize(adjusted)).toEqual(['', false, 1])

    const timestamp = applyJsonOperation(
      document,
      [generated as NodeId],
      op({ type: 'primitive.generate', value: 'timestamp' }),
      dependencies(),
    )
    expect(timestamp.ok && materialize(timestamp.document)).toEqual([
      '2026-08-01T00:00:00Z',
      false,
      2,
    ])
  })

  test('rejects incompatible and lossy conversions', () => {
    const document = parse('["no",1]')
    const [text, number] = rootChildren(document) as [NodeId, NodeId]
    expect(
      applyJsonOperation(
        document,
        [text],
        op({ type: 'primitive.convert', to: 'number' }),
        dependencies(),
      ),
    ).toMatchObject({ ok: false, error: { code: 'InvalidConversion' } })
    expect(
      applyJsonOperation(
        document,
        [number],
        op({ type: 'primitive.toggle' }),
        dependencies(),
      ),
    ).toMatchObject({ ok: false, error: { code: 'IncompatibleSelection' } })
  })

  test('distinguishes semantic numbers from recognized date strings', () => {
    const document = parse('["1","2026-08-01",1]')
    const [numericString, date, number] = rootChildren(document) as NodeId[]
    expect(
      applyJsonOperation(
        document,
        [numericString as NodeId],
        op({ type: 'primitive.number-format', formatting: 'formatted' }),
        dependencies(),
      ),
    ).toMatchObject({ ok: false, error: { code: 'IncompatibleSelection' } })
    expect(
      applyJsonOperation(
        document,
        [number as NodeId],
        op({ type: 'primitive.date-format', formatting: 'formatted' }),
        dependencies(),
      ),
    ).toMatchObject({ ok: false, error: { code: 'IncompatibleSelection' } })
    expect(
      apply(document, [date as NodeId], {
        type: 'primitive.date-format',
        formatting: 'formatted',
      }).nodes[date as NodeId],
    ).toMatchObject({ detectedKind: 'date', formatting: 'formatted' })
  })
})

describe('collection operations', () => {
  test('sorts stably by nested path in either direction', () => {
    const document = parse(
      '[{"rank":2,"id":"a"},{"rank":1,"id":"b"},{"rank":2,"id":"c"}]',
    )
    const sorted = apply(document, [document.rootId], {
      type: 'collection.sort',
      key: { by: 'path', path: ['rank'] },
      direction: 'asc',
    })
    expect(materialize(sorted)).toEqual([
      { rank: 1, id: 'b' },
      { rank: 2, id: 'a' },
      { rank: 2, id: 'c' },
    ])
    expect(
      materialize(
        apply(sorted, [sorted.rootId], {
          type: 'collection.sort',
          key: { by: 'value' },
          direction: 'desc',
        }),
      ),
    ).toHaveLength(3)
  })

  test('filters with serializable queries and deduplicates canonical JSON', () => {
    const document = parse('[{"x":2},{"x":1},{"x":2}]')
    const filtered = apply(document, [document.rootId], {
      type: 'collection.filter',
      query: {
        type: 'compare',
        path: ['x'],
        operator: 'gte',
        value: 2,
      },
    })
    expect(materialize(filtered)).toEqual([{ x: 2 }, { x: 2 }])
    expect(
      materialize(
        apply(filtered, [filtered.rootId], {
          type: 'collection.deduplicate',
        }),
      ),
    ).toEqual([{ x: 2 }])
  })

  test('groups by nested path and supports explicit persistent reorder', () => {
    const document = parse(
      '[{"team":"b","n":1},{"team":"a","n":2},{"team":"b","n":3}]',
    )
    const grouped = apply(document, [document.rootId], {
      type: 'collection.group',
      path: ['team'],
    })
    expect(materialize(grouped)).toEqual({
      b: [
        { team: 'b', n: 1 },
        { team: 'b', n: 3 },
      ],
      a: [{ team: 'a', n: 2 }],
    })

    const ordered = parse('[1,2,3]')
    const [one, two, three] = rootChildren(ordered) as NodeId[]
    expect(
      materialize(
        apply(ordered, [ordered.rootId], {
          type: 'collection.reorder',
          childIds: [three as NodeId, one as NodeId, two as NodeId],
        }),
      ),
    ).toEqual([3, 1, 2])
  })

  test('rejects grouping captions produced by distinct JSON types', () => {
    const document = parse('[{"group":"1"},{"group":1}]')
    expect(
      applyJsonOperation(
        document,
        [document.rootId],
        op({ type: 'collection.group', path: ['group'] }),
        dependencies(),
      ),
    ).toMatchObject({ ok: false, error: { code: 'DuplicateCaption' } })
  })
})

describe('merge, diff, extraction, rename, and query', () => {
  test.each([
    ['shallow', [{ x: 2 }, { z: 3 }]],
    ['deep', [{ x: 1, y: 2 }, { z: 3 }]],
  ] as const)(
    'merges with documented later-wins %s behavior',
    (depth, expectedNested) => {
      const document = parse('[{"a":{"x":1,"y":1}},{"a":{"y":2},"b":{"z":3}}]')
      const selections = rootChildren(document)
      const merged = apply(document, selections, { type: 'data.merge', depth })
      const expected =
        depth === 'shallow'
          ? [{ a: { y: 2 }, b: expectedNested[1] }]
          : [{ a: expectedNested[0], b: expectedNested[1] }]
      expect(materialize(merged)).toEqual(expected)
    },
  )

  test('produces deterministic JSON-compatible diffs', () => {
    const document = parse('[{"b":1,"a":1},{"b":2,"c":3}]')
    const result = apply(document, rootChildren(document), {
      type: 'data.diff',
    })
    expect(materialize(result)).toEqual([
      {
        equal: false,
        changes: [
          { path: ['a'], before: 1 },
          { path: ['b'], before: 1, after: 2 },
          { path: ['c'], after: 3 },
        ],
      },
    ])
  })

  test('extracts keys/values and renames a path segment in place order', () => {
    const keys = parse('{"b":2,"a":1}')
    expect(
      materialize(
        apply(keys, [keys.rootId], { type: 'data.extract', part: 'keys' }),
      ),
    ).toEqual(['b', 'a'])
    const values = parse('{"b":2,"a":1}')
    expect(
      materialize(
        apply(values, [values.rootId], {
          type: 'data.extract',
          part: 'values',
        }),
      ),
    ).toEqual([2, 1])
    const renamed = parse('{"outer":{"before":1,"after":2}}')
    expect(
      materialize(
        apply(renamed, [renamed.rootId], {
          type: 'data.rename-path',
          path: ['outer', 'before'],
          replacement: 'renamed',
        }),
      ),
    ).toEqual({ outer: { renamed: 1, after: 2 } })
  })

  test('reports rename collisions and returns deterministic matching IDs without mutation', () => {
    const document = parse('{"a":1,"b":2}')
    const before = serialize(document)
    expect(
      applyJsonOperation(
        document,
        [document.rootId],
        op({
          type: 'data.rename-path',
          path: ['a'],
          replacement: 'b',
        }),
        dependencies(),
      ),
    ).toMatchObject({ ok: false, error: { code: 'DuplicateCaption' } })
    const matches = findMatchingIds(document, [document.rootId], {
      type: 'compare',
      operator: 'gte',
      value: 2,
    })
    const matchingHeader = rootChildren(document)[1] as NodeId
    expect(matches).toEqual([matchingHeader])
    expect(
      findMatchingIds(
        document,
        [document.rootId],
        { type: 'compare', operator: 'gte', value: 2 },
        { includeDescendantsOfMatches: true },
      ),
    ).toEqual([
      matchingHeader,
      getContainer(document, matchingHeader).childIds[0],
    ])
    expect(serialize(document)).toBe(before)
  })

  test('converts selected captions together while preserving values and order', () => {
    const document = parse(
      '{"First Name":{"x":1},"account-status":{"y":2},"untouched":3}',
    )
    const [first, status] = rootChildren(document) as [NodeId, NodeId]
    const converted = apply(document, [first, status], {
      type: 'caption.case',
      mode: 'camel',
    })
    expect(materialize(converted)).toEqual({
      firstName: { x: 1 },
      accountStatus: { y: 2 },
      untouched: 3,
    })
    expect(converted.nodes[rootChildren(document)[2] as NodeId]).toBe(
      document.nodes[rootChildren(document)[2] as NodeId],
    )
  })

  test('rejects caption conversion collisions without mutating the document', () => {
    const document = parse('{"first-name":{},"first_name":{}}')
    const before = serialize(document)
    const result = applyJsonOperation(
      document,
      rootChildren(document),
      op({ type: 'caption.case', mode: 'camel' }),
      dependencies(),
    )
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'DuplicateCaption' },
    })
    expect(serialize(document)).toBe(before)
  })

  test('preserves dangerous dynamic keys and targeted rename record identity', () => {
    const document = parse('{"__proto__":{"constructor":1,"keep":2},"safe":3}')
    const proto = rootChildren(document)[0] as NodeId
    const safe = rootChildren(document)[1] as NodeId
    const constructor = getContainer(document, proto).childIds[0] as NodeId
    const constructorValue = getContainer(document, constructor)
      .childIds[0] as NodeId
    const keep = getContainer(document, proto).childIds[1] as NodeId
    const result = apply(document, [document.rootId], {
      type: 'data.rename-path',
      path: ['__proto__', 'constructor'],
      replacement: 'prototype',
    })
    expect(serialize(result)).toBe(
      '{"__proto__":{"prototype":1,"keep":2},"safe":3}',
    )
    expect(result.nodes[safe]).toBe(document.nodes[safe])
    expect(result.nodes[keep]).toBe(document.nodes[keep])
    expect(result.nodes[constructorValue]).toBe(
      document.nodes[constructorValue],
    )
    expect(result.nodes[constructor]).not.toBe(document.nodes[constructor])
    expect(Object.prototype).not.toHaveProperty('polluted')
  })

  test('preserves __proto__ through merge, group, and diff results', () => {
    const merge = parse(
      '[{"__proto__":{"first":1}},{"__proto__":{"later":2},"constructor":3}]',
    )
    expect(
      serialize(
        apply(merge, rootChildren(merge), {
          type: 'data.merge',
          depth: 'deep',
        }),
      ),
    ).toBe('[{"__proto__":{"first":1,"later":2},"constructor":3}]')

    const grouped = parse('[{"key":"__proto__","n":1}]')
    expect(
      serialize(
        apply(grouped, [grouped.rootId], {
          type: 'collection.group',
          path: ['key'],
        }),
      ),
    ).toBe('{"__proto__":[{"key":"__proto__","n":1}]}')

    const diff = parse('[{"__proto__":1},{"__proto__":2}]')
    expect(
      materialize(apply(diff, rootChildren(diff), { type: 'data.diff' })),
    ).toEqual([
      {
        equal: false,
        changes: [{ path: ['__proto__'], before: 1, after: 2 }],
      },
    ])
    expect(Object.prototype).not.toHaveProperty('first')
  })
})

describe('protocol, invariants, and inversion readiness', () => {
  test('is serializable/versioned and exposes command integration descriptors', () => {
    const operation = op({ type: 'text.trim' })
    expect(JSON.parse(JSON.stringify(operation))).toEqual(operation)
    expect(JSON_OPERATION_CATALOG).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'value.add', implementation: 'command' }),
        expect.objectContaining({
          id: 'collection.sort',
          implementation: 'operation',
        }),
      ]),
    )
    const document = parse('[1]')
    expect(
      applyJsonOperation(
        document,
        rootChildren(document),
        { ...operation, version: 99 } as unknown as JsonOperation,
        dependencies(),
      ),
    ).toMatchObject({ ok: false, error: { code: 'UnsupportedVersion' } })
  })

  test('never mutates input and returns the original document for true no-ops', () => {
    const document = parse('["clean"]')
    const before = serialize(document)
    const id = rootChildren(document)[0] as NodeId
    const result = applyJsonOperation(
      document,
      [id],
      op({ type: 'text.trim' }),
      dependencies(),
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.document).toBe(document)
      expect(result.summary.affectedIds).toEqual([])
    }
    expect(serialize(document)).toBe(before)
  })

  test.each([
    [null, 'InvalidOperation'],
    [{ version: 1, type: 'unknown' }, 'InvalidOperation'],
    [
      { version: 1, type: 'structure.move', direction: 'left' },
      'InvalidOperation',
    ],
    [
      { version: 1, type: 'primitive.adjust', amount: Number.NaN },
      'InvalidOperation',
    ],
    [
      { version: 1, type: 'collection.group', path: ['ok', 1] },
      'InvalidOperation',
    ],
    [
      {
        version: 1,
        type: 'collection.filter',
        query: { type: 'compare', operator: 'wat', value: 1 },
      },
      'InvalidOperation',
    ],
    [
      { version: 1, type: 'data.merge', depth: 'recursive' },
      'InvalidOperation',
    ],
  ])(
    'returns typed errors for malformed runtime payload %j',
    (operation, code) => {
      const document = parse('[1]')
      const result = applyJsonOperation(
        document,
        rootChildren(document),
        operation as unknown as JsonOperation,
        dependencies(),
      )
      expect(result).toMatchObject({ ok: false, error: { code } })
      expect(materialize(document)).toEqual([1])
    },
  )

  test('validates selected IDs, dependency shapes, calls, and outputs', () => {
    const document = parse('[""]')
    const selection = rootChildren(document)
    expect(
      applyJsonOperation(
        document,
        null as unknown as readonly NodeId[],
        op({ type: 'text.trim' }),
        dependencies(),
      ),
    ).toMatchObject({ ok: false, error: { code: 'InvalidOperation' } })
    expect(
      applyJsonOperation(
        document,
        selection,
        op({ type: 'text.trim' }),
        {} as OperationDependencies,
      ),
    ).toMatchObject({ ok: false, error: { code: 'InvalidOperation' } })
    expect(
      applyJsonOperation(
        document,
        selection,
        op({ type: 'primitive.generate', value: 'uuid' }),
        {
          ...dependencies(),
          createUuid: () => 1 as unknown as string,
        },
      ),
    ).toMatchObject({ ok: false, error: { code: 'InvalidOperation' } })
    const timestamp = applyJsonOperation(
      document,
      selection,
      op({ type: 'primitive.generate', value: 'timestamp' }),
      {
        ...dependencies(),
        createTimestamp: () => {
          throw new Error('clock unavailable')
        },
      },
    )
    expect(timestamp).toMatchObject({
      ok: false,
      error: { code: 'InvalidOperation' },
    })
    if (!timestamp.ok) expect(timestamp.error.message).toContain('clock')

    const grouped = parse('[[{"x":1}]]')
    const collection = rootChildren(grouped)[0] as NodeId
    expect(
      applyJsonOperation(
        grouped,
        [collection],
        op({ type: 'collection.group', path: ['x'] }),
        {
          ...dependencies(),
          createId: () => '' as NodeId,
        },
      ),
    ).toMatchObject({ ok: false, error: { code: 'InvalidOperation' } })
  })

  test('guards recursively nested queries and oversized paths', () => {
    const document = parse('[1]')
    let query: unknown = { type: 'all' }
    for (let index = 0; index < 70; index++) query = { type: 'not', query }
    expect(
      applyJsonOperation(
        document,
        [document.rootId],
        {
          version: 1,
          type: 'collection.filter',
          query,
        } as JsonOperation,
        dependencies(),
      ),
    ).toMatchObject({ ok: false, error: { code: 'ResourceLimit' } })
    expect(
      applyJsonOperation(
        document,
        [document.rootId],
        {
          version: 1,
          type: 'collection.group',
          path: Array.from({ length: 257 }, () => 'x'),
        },
        dependencies(),
      ),
    ).toMatchObject({ ok: false, error: { code: 'ResourceLimit' } })
  })

  test('returns the original document for structural ordering no-ops', () => {
    const document = parse('[1,2]')
    const [one] = rootChildren(document) as NodeId[]
    const operations: readonly [readonly NodeId[], JsonOperation][] = [
      [[one as NodeId], op({ type: 'structure.move', direction: 'up' })],
      [
        [one as NodeId],
        op({
          type: 'structure.move-to',
          containerId: document.rootId,
          index: 0,
        }),
      ],
      [
        [document.rootId],
        op({ type: 'collection.sort', key: { by: 'value' }, direction: 'asc' }),
      ],
      [
        [document.rootId],
        op({ type: 'collection.reorder', childIds: rootChildren(document) }),
      ],
    ]
    for (const [selection, operation] of operations) {
      const result = applyJsonOperation(
        document,
        selection,
        operation,
        dependencies(),
      )
      expect(result.ok && result.document).toBe(document)
      if (result.ok) expect(result.summary.affectedIds).toEqual([])
    }
    const singleton = parse('[1]')
    const reverse = applyJsonOperation(
      singleton,
      [singleton.rootId],
      op({ type: 'structure.reverse' }),
      dependencies(),
    )
    expect(reverse.ok && reverse.document).toBe(singleton)
  })

  test('reverse is inversion-ready for arbitrary JSON arrays', () => {
    fc.assert(
      fc.property(fc.array(fc.jsonValue(), { maxLength: 20 }), (value) => {
        const source = JSON.stringify(value)
        const canonicalValue = JSON.parse(source) as JsonValue
        const document = parse(source, 'property')
        const reverse: JsonOperation = op({ type: 'structure.reverse' })
        const first = applyJsonOperation(
          document,
          [document.rootId],
          reverse,
          dependencies('first'),
        )
        expect(first.ok).toBe(true)
        if (!first.ok) return
        const second = applyJsonOperation(
          first.document,
          [first.document.rootId],
          reverse,
          dependencies('second'),
        )
        expect(second.ok).toBe(true)
        if (second.ok) {
          expect(materialize(second.document)).toEqual(canonicalValue)
          expect(Object.keys(second.document.nodes).sort()).toEqual(
            Object.keys(document.nodes).sort(),
          )
          expect(validateDocument(second.document)).toEqual([])
        }
      }),
      { numRuns: 100 },
    )
  })
})
