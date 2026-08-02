import { describe, expect, test, vi } from 'vitest'

import {
  COMMAND_VERSION,
  type CommandContext,
} from '../domain/commands/index.ts'
import {
  getContainer,
  documentStructureToken,
  nodeId,
  parseJson,
  type JsonDocument,
  type NodeId,
} from '../domain/document/index.ts'
import {
  createDocumentStore,
  createVisibleSelector,
  spreadsheetColumn,
  selectChildren,
  selectCommonParent,
  selectContiguous,
  selectFormattedValue,
  selectNode,
  selectParent,
  selectPath,
  selectValidRoots,
  selectVisibleItems,
} from './index.ts'

function fixture(): JsonDocument {
  let sequence = 0
  const result = parseJson('{"a":[1,2],"b":3}', {}, () =>
    nodeId(`node-${sequence++}`),
  )
  if (!result.ok) throw new Error(result.error.message)
  return result.document
}

function context(): CommandContext {
  let sequence = 0
  return {
    createId: () => nodeId(`new-${sequence++}`),
    createEventMetadata: () => ({
      eventId: `event-${sequence++}`,
      occurredAt: '2026-08-01T00:00:00.000Z',
    }),
  }
}

describe('external document store', () => {
  test('has stable snapshots, safe subscriptions, grouped undo/redo, and monotonic revisions', () => {
    const initial = fixture()
    const store = createDocumentStore(initial, context(), {
      maxEventLog: 3,
      checkpointInterval: 2,
    })
    const firstSnapshot = store.getSnapshot()
    expect(store.getSnapshot()).toBe(firstSnapshot)
    const listener = vi.fn()
    store.subscribe(() => {
      throw new Error('subscriber failure')
    })
    const unsubscribe = store.subscribe(listener)
    const root = getContainer(initial, initial.rootId)
    const a = root.childIds[0] as NodeId
    const values = getContainer(initial, a).childIds

    for (const index of [0, 1]) {
      const result = store.execute(
        {
          version: COMMAND_VERSION,
          type: 'primitive.update',
          expectedRevision: index,
          targetId: values[0] as NodeId,
          sourceInput: String(index + 10),
        },
        { group: 'edit' },
      )
      expect(result.ok).toBe(true)
    }
    expect(store.getSnapshot()).not.toBe(firstSnapshot)
    expect(store.getSnapshot()).toMatchObject({ revision: 2 })
    expect(store.getSnapshot().past).toHaveLength(1)
    expect(store.getSnapshot().checkpoints).toHaveLength(2)
    expect(listener).toHaveBeenCalledTimes(2)

    expect(store.undo()).toBe(true)
    expect(store.getSnapshot().revision).toBe(4)
    expect(store.getSnapshot().present).toEqual(initial)
    expect(store.redo()).toBe(true)
    expect(store.getSnapshot().revision).toBe(6)
    expect(store.getSnapshot().eventLog).toHaveLength(3)

    store.setUrlSavedRevision(6)
    expect(store.getSnapshot().urlSavedRevision).toBe(6)
    unsubscribe()
  })

  test('failed commands and no-ops do not mutate state or clear redo', () => {
    const initial = fixture()
    const store = createDocumentStore(initial, context())
    const root = getContainer(initial, initial.rootId)
    const a = root.childIds[0] as NodeId
    const target = getContainer(initial, a).childIds[0] as NodeId
    store.execute({
      version: COMMAND_VERSION,
      type: 'primitive.update',
      expectedRevision: 0,
      targetId: target,
      sourceInput: '10',
    })
    store.undo()
    const beforeFailure = store.getSnapshot()
    const failure = store.execute({
      version: COMMAND_VERSION,
      type: 'subtree.remove',
      expectedRevision: 0,
      targetId: nodeId('missing'),
    })
    expect(failure.ok).toBe(false)
    expect(store.getSnapshot()).toBe(beforeFailure)
    expect(store.getSnapshot().future).toHaveLength(1)

    const currentTarget = getContainer(store.getSnapshot().present, a)
      .childIds[0] as NodeId
    const noop = store.execute({
      version: COMMAND_VERSION,
      type: 'primitive.update',
      expectedRevision: 2,
      targetId: currentTarget,
      sourceInput: '1',
    })
    expect(noop).toMatchObject({ ok: true, status: 'noop' })
    expect(store.getSnapshot()).toBe(beforeFailure)
  })

  test('a new successful command clears redo', () => {
    const initial = fixture()
    const store = createDocumentStore(initial, context())
    const root = getContainer(initial, initial.rootId)
    const a = root.childIds[0] as NodeId
    const target = getContainer(initial, a).childIds[0] as NodeId
    store.execute({
      version: COMMAND_VERSION,
      type: 'primitive.update',
      expectedRevision: 0,
      targetId: target,
      sourceInput: '10',
    })
    store.undo()
    store.execute({
      version: COMMAND_VERSION,
      type: 'primitive.update',
      expectedRevision: 2,
      targetId: target,
      sourceInput: '20',
    })
    expect(store.getSnapshot().future).toEqual([])
  })

  test('explicitly closes text history groups', () => {
    const initial = fixture()
    const store = createDocumentStore(initial, context())
    const root = getContainer(initial, initial.rootId)
    const a = root.childIds[0] as NodeId
    const target = getContainer(initial, a).childIds[0] as NodeId

    store.execute(
      {
        version: COMMAND_VERSION,
        type: 'primitive.update',
        expectedRevision: 0,
        targetId: target,
        sourceInput: '10',
      },
      { group: 'edit' },
    )
    store.closeHistoryGroup('edit')
    store.execute(
      {
        version: COMMAND_VERSION,
        type: 'primitive.update',
        expectedRevision: 1,
        targetId: target,
        sourceInput: '100',
      },
      { group: 'edit' },
    )

    expect(store.getSnapshot().past).toHaveLength(2)
  })

  test('does not group edits to different primitive targets', () => {
    const initial = fixture()
    const store = createDocumentStore(initial, context())
    const root = getContainer(initial, initial.rootId)
    const a = root.childIds[0] as NodeId
    const [first, second] = getContainer(initial, a).childIds as readonly [
      NodeId,
      NodeId,
    ]

    store.execute(
      {
        version: COMMAND_VERSION,
        type: 'primitive.update',
        expectedRevision: 0,
        targetId: first,
        sourceInput: '10',
      },
      { group: 'edit' },
    )
    store.execute(
      {
        version: COMMAND_VERSION,
        type: 'primitive.update',
        expectedRevision: 1,
        targetId: second,
        sourceInput: '20',
      },
      { group: 'edit' },
    )

    expect(store.getSnapshot().past).toHaveLength(2)
  })

  test('records unique applied revisions and directions', () => {
    const initial = fixture()
    const store = createDocumentStore(initial, context())
    const root = getContainer(initial, initial.rootId)
    const a = root.childIds[0] as NodeId
    const target = getContainer(initial, a).childIds[0] as NodeId

    store.execute({
      version: COMMAND_VERSION,
      type: 'primitive.update',
      expectedRevision: 0,
      targetId: target,
      sourceInput: '10',
    })
    store.undo()
    store.redo()

    const log = store.getSnapshot().eventLog
    expect(log.map(({ revision, direction }) => [revision, direction])).toEqual(
      [
        [1, 'execute'],
        [2, 'undo'],
        [3, 'redo'],
      ],
    )
    expect(new Set(log.map(({ revision }) => revision)).size).toBe(3)
    expect(log[0]?.event.metadata.eventId).toBe(log[1]?.event.metadata.eventId)
  })

  test('replays from bounded checkpoints after event-log truncation', () => {
    const initial = fixture()
    const store = createDocumentStore(initial, context(), {
      maxEventLog: 2,
      checkpointInterval: 2,
      maxCheckpoints: 2,
    })
    const root = getContainer(initial, initial.rootId)
    const a = root.childIds[0] as NodeId
    const target = getContainer(initial, a).childIds[0] as NodeId

    for (let revision = 0; revision < 5; revision++) {
      store.execute({
        version: COMMAND_VERSION,
        type: 'primitive.update',
        expectedRevision: revision,
        targetId: target,
        sourceInput: String(revision + 10),
      })
    }

    const snapshot = store.getSnapshot()
    expect(snapshot.eventLog.map(({ revision }) => revision)).toEqual([4, 5])
    expect(snapshot.checkpoints).toHaveLength(2)
    expect(snapshot.checkpoints[0]?.revision).toBe(3)
    expect(store.replay()).toEqual(snapshot.present)
    expect(store.replay(3)).toBe(snapshot.checkpoints[0]?.document)
    expect(() => store.replay(2)).toThrow('not available')
  })
})

describe('focused selectors', () => {
  test('selects nodes, paths, formatting, roots, common parents, and ranges', () => {
    const document = fixture()
    const root = getContainer(document, document.rootId)
    const a = root.childIds[0] as NodeId
    const children = getContainer(document, a).childIds
    const first = children[0] as NodeId
    const second = children[1] as NodeId

    expect(selectNode(document, first)).toBe(document.nodes[first])
    expect(selectChildren(document, a)).toBe(getContainer(document, a).childIds)
    expect(selectPath(document, first).map((node) => node.id)).toEqual([
      document.rootId,
      a,
      first,
    ])
    expect(selectFormattedValue(document, first, { enabled: true })).toBe('1')
    expect(selectValidRoots(document, [a, first, second])).toEqual([a])
    expect(selectCommonParent(document, [first, second])).toBe(a)
    expect(selectContiguous(document, [second, first])).toBe(true)
    expect(selectContiguous(document, [first, first])).toBe(false)
    const selection = [a, first, second]
    expect(selectValidRoots(document, selection)).toBe(
      selectValidRoots(document, selection),
    )
    expect(selectChildren(document, first)).toBe(
      selectChildren(document, first),
    )
    expect(selectPath(document, nodeId('missing'))).toBe(
      selectPath(document, nodeId('missing')),
    )
  })

  test('projects expanded visible nodes and memoizes by structure token', () => {
    const document = fixture()
    const root = getContainer(document, document.rootId)
    const a = root.childIds[0] as NodeId
    const expanded = new Set([document.rootId, a])
    const visible = selectVisibleItems(document, expanded)
    const third = visible[2]
    if (!third) throw new Error('Missing visible child')

    expect(visible.map((item) => item.depth)).toEqual([0, 1, 2, 2, 1])
    expect(visible.map((item) => item.reference)).toEqual([
      'Root',
      'A',
      'A.1',
      'A.2',
      'B',
    ])
    expect(third.path).toEqual([document.rootId, a, third.id])
    const memoized = createVisibleSelector()
    expect(memoized(document, expanded)).toBe(memoized(document, expanded))
    expect(memoized(document, new Set(expanded))).not.toBe(visible)

    const store = createDocumentStore(document, context())
    store.execute({
      version: COMMAND_VERSION,
      type: 'primitive.update',
      expectedRevision: 0,
      targetId: third.id,
      sourceInput: 'updated',
    })
    const edited = store.getSnapshot().present
    expect(documentStructureToken(edited)).toBe(
      documentStructureToken(document),
    )
    const stableExpanded = new Set([document.rootId, a])
    const beforeEdit = memoized(document, stableExpanded)
    expect(memoized(edited, stableExpanded)).toBe(beforeEdit)

    store.execute({
      version: COMMAND_VERSION,
      type: 'primitive.add',
      expectedRevision: 1,
      parentId: a,
      sourceInput: '3',
    })
    expect(memoized(store.getSnapshot().present, stableExpanded)).not.toBe(
      beforeEdit,
    )
  })

  test('generates spreadsheet reference segments past Z', () => {
    expect([0, 25, 26, 27, 51, 52, 701, 702].map(spreadsheetColumn)).toEqual([
      'A',
      'Z',
      'AA',
      'AB',
      'AZ',
      'BA',
      'ZZ',
      'AAA',
    ])
  })

  test('keeps parent and unrelated path references across publications', () => {
    const initial = fixture()
    const root = getContainer(initial, initial.rootId)
    const a = root.childIds[0] as NodeId
    const [first, second] = getContainer(initial, a).childIds as readonly [
      NodeId,
      NodeId,
    ]
    const store = createDocumentStore(initial, context())
    const parent = selectParent(initial, second)
    const path = selectPath(initial, second)

    store.execute({
      version: COMMAND_VERSION,
      type: 'primitive.update',
      expectedRevision: 0,
      targetId: first,
      sourceInput: '10',
    })
    const edited = store.getSnapshot().present
    expect(selectParent(edited, second)).toBe(parent)
    expect(selectPath(edited, second)).toBe(path)

    store.setUrlSavedRevision(1)
    expect(store.getSnapshot().present).toBe(edited)
    expect(selectPath(store.getSnapshot().present, second)).toBe(path)
  })
})
