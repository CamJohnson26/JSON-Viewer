import fc from 'fast-check'
import { describe, expect, test } from 'vitest'

import {
  assertDocument,
  getContainer,
  materialize,
  nodeId,
  parseJson,
  serialize,
  type JsonDocument,
  type NodeId,
} from '../document/index.ts'
import { invertTransaction } from '../events/index.ts'
import { JSON_OPERATION_VERSION } from '../operations/index.ts'
import { applyTransaction } from '../reducer/index.ts'
import {
  COMMAND_VERSION,
  compileCommand,
  type CommandContext,
  type DocumentCommand,
} from './index.ts'

function fixture(source = '[1,2]'): JsonDocument {
  let sequence = 0
  const parsed = parseJson(source, {}, () => nodeId(`fixture-${sequence++}`))
  if (!parsed.ok) throw new Error(parsed.error.message)
  return parsed.document
}

function context(prefix = 'new'): CommandContext {
  let id = 0
  let event = 0
  return {
    createId: () => nodeId(`${prefix}-${id++}`),
    createEventMetadata: () => ({
      eventId: `event-${event++}`,
      occurredAt: '2026-08-01T00:00:00.000Z',
    }),
  }
}

type CommandInput = DocumentCommand extends infer Candidate
  ? Candidate extends DocumentCommand
    ? Omit<Candidate, 'version' | 'expectedRevision'>
    : never
  : never

function command<T extends CommandInput>(
  value: T,
  expectedRevision = 0,
): DocumentCommand {
  return { ...value, version: COMMAND_VERSION, expectedRevision }
}

function apply(
  document: JsonDocument,
  value: DocumentCommand,
  commandContext = context(),
): JsonDocument {
  const result = compileCommand(
    document,
    value.expectedRevision,
    value,
    commandContext,
  )
  if (!result.ok || result.status !== 'applied')
    throw new Error(result.ok ? 'No-op' : result.error.message)
  return applyTransaction(document, result.transaction)
}

describe('semantic command compilation', () => {
  test('inserts new rows at a validated position', () => {
    const document = fixture('[1,3]')
    const result = compileCommand(
      document,
      0,
      command({
        type: 'primitive.add',
        parentId: document.rootId,
        index: 1,
        sourceInput: '2',
      }),
      context(),
    )
    if (!result.ok || result.status !== 'applied')
      throw new Error('Expected indexed insertion')
    const updated = applyTransaction(document, result.transaction)
    expect(materialize(updated)).toEqual([1, 2, 3])
    expect(
      applyTransaction(updated, invertTransaction(result.transaction)),
    ).toEqual(document)
    expect(
      compileCommand(
        document,
        0,
        command({
          type: 'header.add',
          parentId: document.rootId,
          index: 3,
          caption: 'late',
        }),
        context(),
      ),
    ).toMatchObject({ ok: false, error: { code: 'InvalidPayload' } })
  })

  test('adds and edits primitives and headers, then renames and removes a subtree', () => {
    const start = fixture('[]')
    const sharedContext = context()
    const withPrimitive = apply(
      start,
      command({
        type: 'primitive.add',
        parentId: start.rootId,
        sourceInput: '1',
      }),
      sharedContext,
    )
    const withHeader = apply(
      withPrimitive,
      command({ type: 'header.add', parentId: start.rootId, caption: 'a' }),
      sharedContext,
    )
    const headerId = getContainer(withHeader, withHeader.rootId)
      .childIds[1] as NodeId
    const populated = apply(
      withHeader,
      command({
        type: 'primitive.add',
        parentId: headerId,
        sourceInput: 'true',
      }),
      sharedContext,
    )
    const primitiveId = getContainer(populated, headerId).childIds[0] as NodeId
    const updated = apply(
      populated,
      command({
        type: 'primitive.update',
        targetId: primitiveId,
        sourceInput: 'false',
      }),
      sharedContext,
    )
    const renamed = apply(
      updated,
      command({ type: 'header.rename', targetId: headerId, caption: 'b' }),
      sharedContext,
    )
    const removed = apply(
      renamed,
      command({ type: 'subtree.remove', targetId: headerId }),
      sharedContext,
    )

    expect(materialize(renamed)).toEqual([1, { b: false }])
    expect(materialize(removed)).toEqual([1])
    expect(removed.nodes[headerId]).toBeUndefined()
    expect(removed.nodes[primitiveId]).toBeUndefined()
  })

  test('wraps and unwraps while preserving exact inverse data', () => {
    const start = fixture()
    const targetId = getContainer(start, start.rootId).childIds[0] as NodeId
    const result = compileCommand(
      start,
      0,
      command({ type: 'node.wrap', targetId, caption: 'a' }),
      context(),
    )
    expect(result.ok && result.status).toBe('applied')
    if (!result.ok || result.status !== 'applied') return
    const wrapped = applyTransaction(start, result.transaction)
    const wrapperId = getContainer(wrapped, wrapped.rootId)
      .childIds[0] as NodeId
    const unwrapped = apply(
      wrapped,
      command({ type: 'header.unwrap', targetId: wrapperId }),
    )

    expect(materialize(wrapped)).toEqual([{ a: 1 }, 2])
    expect(materialize(unwrapped)).toEqual([1, 2])
    expect(
      applyTransaction(wrapped, invertTransaction(result.transaction)),
    ).toEqual(start)
  })

  test('replaces strict JSON and supports paste into and beside', () => {
    const start = fixture('[0]')
    const replaced = apply(
      start,
      command({ type: 'json.replace', source: '{"a":1}' }),
      context('replace'),
    )
    const into = apply(
      replaced,
      command({
        type: 'json.pasteInto',
        targetId: replaced.rootId,
        source: '{"b":2}',
      }),
      context('into'),
    )
    const target = getContainer(into, into.rootId).childIds[0] as NodeId
    const beside = apply(
      into,
      command({ type: 'json.pasteBeside', targetId: target, source: '[3]' }),
      context('beside'),
    )

    expect(serialize(into)).toBe('{"a":1,"b":2}')
    expect(materialize(beside)).toEqual([{ a: 1 }, [3], { b: 2 }])
  })

  test.each([
    ['[1,9]', 0, '2', [2, 9]],
    ['[1,9]', 0, '{"nested":[2]}', [{ nested: [2] }, 9]],
    ['{"key":1,"keep":9}', 0, '2', { key: 2, keep: 9 }],
    ['{"key":1,"keep":9}', 0, '[2,3]', { key: [2, 3], keep: 9 }],
  ] as const)(
    'replaces target JSON in %s while retaining target identity',
    (documentSource, targetIndex, replacementSource, expected) => {
      const document = fixture(documentSource)
      const root = getContainer(document, document.rootId)
      const targetId = root.childIds[targetIndex] as NodeId
      const unaffectedId = root.childIds[1] as NodeId
      const unaffected = document.nodes[unaffectedId]
      const result = compileCommand(
        document,
        0,
        command({
          type: 'json.pasteReplace',
          targetId,
          source: replacementSource,
        }),
        context('replace'),
      )
      if (!result.ok || result.status !== 'applied')
        throw new Error('Expected replacement event')
      const replaced = applyTransaction(document, result.transaction)

      expect(result.focusId).toBe(targetId)
      expect(result.transaction.events).toHaveLength(1)
      expect(materialize(replaced)).toEqual(expected)
      expect(replaced.nodes[targetId]).toBeDefined()
      expect(replaced.nodes[unaffectedId]).toBe(unaffected)
      expect(
        applyTransaction(replaced, invertTransaction(result.transaction)),
      ).toEqual(document)
      expect(applyTransaction(document, result.transaction)).toEqual(replaced)
      assertDocument(replaced)
    },
  )

  test.each([
    ['{"replacement":true}', { replacement: true }],
    ['3', 3],
  ] as const)(
    'replaces the document root with %s while retaining the editor root ID',
    (source, expected) => {
      const document = fixture('{"old":[1,2]}')
      const result = compileCommand(
        document,
        0,
        command({
          type: 'json.pasteReplace',
          targetId: document.rootId,
          source,
        }),
        context('root-replace'),
      )
      if (!result.ok || result.status !== 'applied')
        throw new Error('Expected root replacement event')
      const replaced = applyTransaction(document, result.transaction)

      expect(replaced.rootId).toBe(document.rootId)
      expect(result.focusId).toBe(document.rootId)
      expect(materialize(replaced)).toEqual(expected)
      expect(
        applyTransaction(replaced, invertTransaction(result.transaction)),
      ).toEqual(document)
      assertDocument(replaced)
    },
  )

  test('rejects invalid replacement input, targets, duplicate keys, and ID collisions atomically', () => {
    const document = fixture('[1,2]')
    const targetId = getContainer(document, document.rootId)
      .childIds[0] as NodeId
    const invalidCases: readonly [DocumentCommand, CommandContext, string][] = [
      [
        command({
          type: 'json.pasteReplace',
          targetId,
          source: '{bad}',
        }),
        context(),
        'InvalidJson',
      ],
      [
        command({
          type: 'json.pasteReplace',
          targetId,
          source: '{"a":1,"a":2}',
        }),
        context(),
        'InvalidJson',
      ],
      [
        command({
          type: 'json.pasteReplace',
          targetId: nodeId('missing'),
          source: '1',
        }),
        context(),
        'UnknownTarget',
      ],
      [
        command({ type: 'json.pasteReplace', targetId, source: '[3]' }),
        {
          ...context(),
          createId: () => document.rootId,
        },
        'IdCollision',
      ],
    ]

    for (const [value, commandContext, code] of invalidCases) {
      const result = compileCommand(document, 0, value, commandContext)
      expect(result).toMatchObject({ ok: false, error: { code } })
      expect(materialize(document)).toEqual([1, 2])
    }
  })

  test('preserves paste-beside ordering when a pasted header is renamed', () => {
    const start = fixture('{"a":0}')
    const target = getContainer(start, start.rootId).childIds[0] as NodeId
    const pasted = apply(
      start,
      command({
        type: 'json.pasteBeside',
        targetId: target,
        source: '{"b":1}',
      }),
      context('paste'),
    )
    const pastedHeader = getContainer(pasted, pasted.rootId)
      .childIds[1] as NodeId
    const renamed = apply(
      pasted,
      command({
        type: 'header.rename',
        targetId: pastedHeader,
        caption: 'c',
      }),
      context('rename'),
    )

    expect(materialize(renamed)).toEqual([{ a: 0 }, { c: 1 }])
  })

  test('returns typed revision, target, duplicate, parse, and no-op results', () => {
    const document = fixture('{"a":1}')
    const headerId = getContainer(document, document.rootId)
      .childIds[0] as NodeId
    const primitiveId = getContainer(document, headerId).childIds[0] as NodeId
    const cases: readonly [DocumentCommand, string][] = [
      [
        {
          ...command({
            type: 'primitive.update',
            targetId: primitiveId,
            sourceInput: '2',
          }),
          version: 99 as 1,
        },
        'UnsupportedVersion',
      ],
      [
        command(
          { type: 'primitive.update', targetId: primitiveId, sourceInput: '2' },
          1,
        ),
        'RevisionMismatch',
      ],
      [
        command({ type: 'subtree.remove', targetId: nodeId('missing') }),
        'UnknownTarget',
      ],
      [
        command({ type: 'header.unwrap', targetId: primitiveId }),
        'InvalidTarget',
      ],
      [command({ type: 'json.replace', source: '{bad}' }), 'InvalidJson'],
      [
        command({ type: 'subtree.remove', targetId: document.rootId }),
        'InvalidTarget',
      ],
    ]
    for (const [value, code] of cases) {
      const result = compileCommand(document, 0, value, context())
      expect(result).toMatchObject({ ok: false, error: { code } })
    }

    const duplicate = compileCommand(
      document,
      0,
      command({ type: 'header.add', parentId: document.rootId, caption: 'a' }),
      context(),
    )
    expect(duplicate).toMatchObject({
      ok: false,
      error: { code: 'DuplicateCaption' },
    })

    const noop = compileCommand(
      document,
      0,
      command({
        type: 'primitive.update',
        targetId: primitiveId,
        sourceInput: '1',
      }),
      context(),
    )
    expect(noop).toEqual({ ok: true, status: 'noop', transaction: null })
  })

  test('primitive updates emit one targeted record and preserve unrelated records', () => {
    const document = fixture('[1,2,3]')
    const root = getContainer(document, document.rootId)
    const targetId = root.childIds[1] as NodeId
    const untouchedId = root.childIds[0] as NodeId
    const result = compileCommand(
      document,
      0,
      command({ type: 'primitive.update', targetId, sourceInput: '20' }),
      context(),
    )
    if (!result.ok || result.status !== 'applied')
      throw new Error('Expected event')
    const event = result.transaction.events[0]
    const updated = applyTransaction(document, result.transaction)

    expect(event?.records).toHaveLength(1)
    expect(event?.records[0]?.id).toBe(targetId)
    expect(updated.nodes[untouchedId]).toBe(document.nodes[untouchedId])
    expect(updated.nodes[document.rootId]).toBe(document.nodes[document.rootId])
    expect(JSON.parse(JSON.stringify(result.transaction))).toEqual(
      result.transaction,
    )
  })

  test('primitive insertion emits only the parent and added records', () => {
    const document = fixture('[1,2,3]')
    const result = compileCommand(
      document,
      0,
      command({
        type: 'primitive.add',
        parentId: document.rootId,
        sourceInput: '4',
      }),
      context(),
    )
    if (!result.ok || result.status !== 'applied')
      throw new Error('Expected event')

    expect(result.transaction.events[0]?.records).toHaveLength(2)
    expect(result.transaction.events[0]?.records.map(({ id }) => id)).toContain(
      document.rootId,
    )
  })

  test('rejects malformed runtime command payloads', () => {
    const document = fixture('[1]')
    const targetId = getContainer(document, document.rootId)
      .childIds[0] as NodeId
    const malformed = {
      ...command({
        type: 'primitive.update',
        targetId,
        sourceInput: '2',
      }),
      sourceInput: 2,
    } as unknown as DocumentCommand

    expect(compileCommand(document, 0, malformed, context())).toMatchObject({
      ok: false,
      error: { code: 'InvalidPayload' },
    })
  })

  test('generic diffs omit recreated but semantically unchanged records', () => {
    const imported = fixture('[1,{"a":2}]')
    const document = apply(
      imported,
      command({
        type: 'primitive.add',
        parentId: imported.rootId,
        sourceInput: '3',
      }),
      context('setup'),
    )
    const headerId = getContainer(document, document.rootId)
      .childIds[1] as NodeId
    const result = compileCommand(
      document,
      0,
      command({ type: 'header.rename', targetId: headerId, caption: 'b' }),
      context(),
    )
    if (!result.ok || result.status !== 'applied')
      throw new Error('Expected event')

    expect(
      result.transaction.events[0]?.records.map((patch) => patch.id),
    ).toEqual([headerId])
  })

  test('mechanical inversion restores arbitrary primitive source edits', () => {
    fc.assert(
      fc.property(fc.string(), (sourceInput) => {
        const document = fixture('[0]')
        const targetId = getContainer(document, document.rootId)
          .childIds[0] as NodeId
        const result = compileCommand(
          document,
          0,
          command({ type: 'primitive.update', targetId, sourceInput }),
          context(),
        )
        if (!result.ok || result.status === 'noop') return
        const updated = applyTransaction(document, result.transaction)
        expect(
          applyTransaction(updated, invertTransaction(result.transaction)),
        ).toEqual(document)
      }),
      { numRuns: 100 },
    )
  })

  test('duplicates a subtree beside its source with fresh IDs and exact undo/redo', () => {
    const document = fixture('{"x":{"a":[1,true]},"x copy":0}')
    const root = getContainer(document, document.rootId)
    const sourceId = root.childIds[0] as NodeId
    const sourceIds = subtreeIds(document, sourceId)
    const result = compileCommand(
      document,
      0,
      command({ type: 'subtree.duplicate', targetId: sourceId }),
      context('duplicate'),
    )
    if (!result.ok || result.status !== 'applied')
      throw new Error('Expected duplicate event')

    const duplicated = applyTransaction(document, result.transaction)
    const duplicatedRoot = getContainer(duplicated, duplicated.rootId)
    const copyId = duplicatedRoot.childIds[1] as NodeId
    const copyIds = subtreeIds(duplicated, copyId)
    const restored = applyTransaction(
      duplicated,
      invertTransaction(result.transaction),
    )
    const redone = applyTransaction(restored, result.transaction)

    expect(result.focusId).toBe(copyId)
    expect(serialize(duplicated)).toBe(
      '{"x":{"a":[1,true]},"x copy 2":{"a":[1,true]},"x copy":0}',
    )
    expect([...copyIds].every((id) => !sourceIds.has(id))).toBe(true)
    expect(copyIds.size).toBe(sourceIds.size)
    expect(restored).toEqual(document)
    expect(redone).toEqual(duplicated)
    assertDocument(duplicated)
  })

  test('derives the first available deterministic duplicate caption', () => {
    const document = fixture('{"x":1,"x copy 2":2}')
    const sourceId = getContainer(document, document.rootId)
      .childIds[0] as NodeId
    const duplicated = apply(
      document,
      command({ type: 'subtree.duplicate', targetId: sourceId }),
      context('duplicate'),
    )

    expect(serialize(duplicated)).toBe('{"x":1,"x copy":1,"x copy 2":2}')
  })

  test('clears a root in one patch and restores it exactly on undo and redo', () => {
    const document = fixture('{"a":[1,{"b":2}]}')
    const result = compileCommand(
      document,
      0,
      command({ type: 'header.clear', targetId: document.rootId }),
      context('clear'),
    )
    if (!result.ok || result.status !== 'applied')
      throw new Error('Expected clear event')
    const cleared = applyTransaction(document, result.transaction)
    const root = getContainer(cleared, cleared.rootId)
    const restored = applyTransaction(
      cleared,
      invertTransaction(result.transaction),
    )

    expect(result.transaction.events).toHaveLength(1)
    expect(result.transaction.events[0]?.records).toHaveLength(
      Object.keys(document.nodes).length,
    )
    expect(result.focusId).toBe(document.rootId)
    expect(root).toMatchObject({
      id: document.rootId,
      caption: null,
      kind: 'object',
      kindOrigin: 'imported',
      childIds: [],
      entries: [],
    })
    expect(restored).toEqual(document)
    expect(applyTransaction(restored, result.transaction)).toEqual(cleared)
    assertDocument(cleared)
  })

  test('clear retains imported empty collection kinds and neutralizes inferred containers', () => {
    for (const [source, kind] of [
      ['[1]', 'array'],
      ['{"a":1}', 'object'],
    ] as const) {
      const document = fixture(source)
      const cleared = apply(
        document,
        command({ type: 'header.clear', targetId: document.rootId }),
      )
      expect(getContainer(cleared, cleared.rootId)).toMatchObject({
        kind,
        kindOrigin: 'imported',
        childIds: [],
      })
    }

    const imported = fixture('[]')
    const inferred = apply(
      imported,
      command({
        type: 'primitive.add',
        parentId: imported.rootId,
        sourceInput: '1',
      }),
      context('setup'),
    )
    const cleared = apply(
      inferred,
      command({ type: 'header.clear', targetId: inferred.rootId }),
    )
    expect(getContainer(cleared, cleared.rootId)).toMatchObject({
      kind: 'neutral',
      kindOrigin: 'neutral',
      childIds: [],
    })
  })

  test('sets primitive formatting with one record without changing JSON data', () => {
    const document = fixture('["2026-08-01",1]')
    const targetId = getContainer(document, document.rootId)
      .childIds[0] as NodeId
    const before = document.nodes[targetId]
    const source = serialize(document)
    const result = compileCommand(
      document,
      0,
      command({
        type: 'primitive.formatting.set',
        targetId,
        formatting: 'source',
      }),
      context('formatting'),
    )
    if (!result.ok || result.status !== 'applied')
      throw new Error('Expected formatting event')
    const formatted = applyTransaction(document, result.transaction)
    const after = formatted.nodes[targetId]

    expect(result.focusId).toBe(targetId)
    expect(result.transaction.events[0]?.records).toHaveLength(1)
    expect(result.transaction.events[0]).not.toHaveProperty('focusId')
    expect(after).toEqual({ ...before, formatting: 'source' })
    expect(serialize(formatted)).toBe(source)
    expect(
      applyTransaction(formatted, invertTransaction(result.transaction)),
    ).toEqual(document)
    expect(applyTransaction(document, result.transaction)).toEqual(formatted)

    expect(
      compileCommand(
        formatted,
        0,
        command({
          type: 'primitive.formatting.set',
          targetId,
          formatting: 'source',
        }),
        context(),
      ),
    ).toEqual({ ok: true, status: 'noop', transaction: null })
    for (const formatting of ['inherit', 'formatted', 'source'] as const) {
      const candidate = compileCommand(
        document,
        0,
        command({
          type: 'primitive.formatting.set',
          targetId,
          formatting,
        }),
        context(),
      )
      expect(candidate.ok).toBe(true)
    }
    const malformed = command({
      type: 'primitive.formatting.set',
      targetId,
      formatting: 'inherit',
    }) as Extract<DocumentCommand, { type: 'primitive.formatting.set' }> & {
      formatting: string
    }
    expect(
      compileCommand(
        document,
        0,
        { ...malformed, formatting: 'invalid' } as unknown as DocumentCommand,
        context(),
      ),
    ).toMatchObject({ ok: false, error: { code: 'InvalidPayload' } })
  })

  test('returns natural ephemeral focus hints for mutation commands', () => {
    const document = fixture('[1,2,3]')
    const root = getContainer(document, document.rootId)
    const middle = root.childIds[1] as NodeId
    const removed = compileCommand(
      document,
      0,
      command({ type: 'subtree.remove', targetId: middle }),
      context(),
    )
    expect(removed).toMatchObject({
      ok: true,
      status: 'applied',
      focusId: root.childIds[2],
    })

    const last = root.childIds[2] as NodeId
    const removedLast = compileCommand(
      document,
      0,
      command({ type: 'subtree.remove', targetId: last }),
      context(),
    )
    expect(removedLast).toMatchObject({ focusId: middle })

    const singleton = fixture('[1]')
    const onlyChild = getContainer(singleton, singleton.rootId)
      .childIds[0] as NodeId
    const removedOnlyChild = compileCommand(
      singleton,
      0,
      command({ type: 'subtree.remove', targetId: onlyChild }),
      context(),
    )
    expect(removedOnlyChild).toMatchObject({ focusId: singleton.rootId })

    const wrapped = compileCommand(
      document,
      0,
      command({ type: 'node.wrap', targetId: middle, caption: 'wrapped' }),
      context('wrap'),
    )
    expect(wrapped).toMatchObject({ focusId: nodeId('wrap-0') })
  })

  test.each([
    [
      '[1,2]',
      (document: JsonDocument) => [document.rootId],
      { type: 'structure.reverse' },
      [2, 1],
    ],
    [
      '[" value ",0]',
      (document: JsonDocument) => [
        getContainer(document, document.rootId).childIds[0] as NodeId,
      ],
      { type: 'text.trim' },
      ['value', 0],
    ],
    [
      '[false,0]',
      (document: JsonDocument) => [
        getContainer(document, document.rootId).childIds[0] as NodeId,
      ],
      { type: 'primitive.toggle' },
      [true, 0],
    ],
    [
      '[1,1,2]',
      (document: JsonDocument) => [document.rootId],
      { type: 'collection.deduplicate' },
      [1, 2],
    ],
    [
      '{"before":1,"keep":2}',
      (document: JsonDocument) => [document.rootId],
      { type: 'data.rename-path', path: ['before'], replacement: 'after' },
      { after: 1, keep: 2 },
    ],
  ] as const)(
    'compiles %s operation into one serializable, invertible transaction',
    (source, select, input, expected) => {
      const document = fixture(source)
      const selectedIds = select(document)
      const value = command({
        type: 'operation.apply',
        selectedIds,
        operation: {
          ...input,
          version: JSON_OPERATION_VERSION,
        },
      })
      const result = compileCommand(document, 0, value, context('operation'))
      if (!result.ok || result.status !== 'applied')
        throw new Error('Expected operation event')
      const updated = applyTransaction(document, result.transaction)

      expect(result.transaction.events).toHaveLength(1)
      expect(result.selectedIds).toEqual(selectedIds)
      expect(result.focusId).toBe(selectedIds[0])
      expect(materialize(updated)).toEqual(expected)
      expect(
        applyTransaction(updated, invertTransaction(result.transaction)),
      ).toEqual(document)
      expect(JSON.parse(JSON.stringify(value))).toEqual(value)
      expect(JSON.parse(JSON.stringify(result.transaction))).toEqual(
        result.transaction,
      )
    },
  )

  test('validates operation revisions and emits no event on failure or no-op', () => {
    const document = fixture('["clean",1]')
    const children = getContainer(document, document.rootId).childIds
    const text = children[0] as NodeId
    const number = children[1] as NodeId
    const operation = (selectedIds: readonly NodeId[], type: 'text.trim') =>
      command({
        type: 'operation.apply',
        selectedIds,
        operation: { version: JSON_OPERATION_VERSION, type },
      })
    const stale = {
      ...operation([text], 'text.trim'),
      expectedRevision: 1,
    }
    expect(compileCommand(document, 0, stale, context())).toMatchObject({
      ok: false,
      error: { code: 'RevisionMismatch' },
    })
    expect(
      compileCommand(document, 0, operation([number], 'text.trim'), context()),
    ).toMatchObject({
      ok: false,
      error: {
        code: 'IncompatibleSelection',
        operationError: { code: 'IncompatibleSelection', nodeId: number },
      },
    })
    expect(
      compileCommand(document, 0, operation([text], 'text.trim'), context()),
    ).toEqual({ ok: true, status: 'noop', transaction: null })
    expect(materialize(document)).toEqual(['clean', 1])
  })

  test.each([
    ['uuid', 'injected-uuid'],
    ['timestamp', '2026-08-01T12:34:56.000Z'],
  ] as const)('uses the injected %s generator', (value, generated) => {
    const document = fixture('["",0]')
    const children = getContainer(document, document.rootId).childIds
    const targetId = children[0] as NodeId
    const untouchedId = children[1] as NodeId
    const result = compileCommand(
      document,
      0,
      command({
        type: 'operation.apply',
        selectedIds: [targetId],
        operation: {
          version: JSON_OPERATION_VERSION,
          type: 'primitive.generate',
          value,
        },
      }),
      {
        ...context('generate'),
        createUuid: () => 'injected-uuid',
        createTimestamp: () => '2026-08-01T12:34:56.000Z',
      },
    )
    if (!result.ok || result.status !== 'applied')
      throw new Error('Expected generated operation')
    const updated = applyTransaction(document, result.transaction)

    expect(materialize(updated)).toEqual([generated, 0])
    expect(updated.nodes[untouchedId]).toBe(document.nodes[untouchedId])
    expect(updated.nodes[document.rootId]).toBe(document.nodes[document.rootId])
  })

  test('returns a typed failure when a requested generator is unavailable', () => {
    const document = fixture('[""]')
    const targetId = getContainer(document, document.rootId)
      .childIds[0] as NodeId
    const result = compileCommand(
      document,
      0,
      command({
        type: 'operation.apply',
        selectedIds: [targetId],
        operation: {
          version: JSON_OPERATION_VERSION,
          type: 'primitive.generate',
          value: 'uuid',
        },
      }),
      context(),
    )

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'InvalidOperation',
        operationError: { code: 'InvalidOperation' },
      },
    })
    if (!result.ok) expect(result.error.message).toContain('unavailable')
    expect(materialize(document)).toEqual([''])
  })
})

function subtreeIds(document: JsonDocument, rootId: NodeId): Set<NodeId> {
  const ids = new Set<NodeId>()
  const visit = (id: NodeId): void => {
    ids.add(id)
    const node = document.nodes[id]
    if (node?.type === 'container') node.childIds.forEach(visit)
  }
  visit(rootId)
  return ids
}
