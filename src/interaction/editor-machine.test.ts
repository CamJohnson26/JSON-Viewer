import { createActor } from 'xstate'
import { describe, expect, test } from 'vitest'

import { nodeId } from '../domain/document/index.ts'
import {
  editorInteractionMachine,
  isEditHistoryBoundaryEvent,
  selectActiveNodeId,
  selectEditSession,
  selectExpandedContainerIds,
  selectFormattingEnabled,
  selectIsEditing,
  selectIsExpanded,
  selectIsSelected,
  selectSelectedNodeCount,
  selectSelectedNodeIds,
  selectSelectionAnchorNodeId,
  type EditorInteractionEvent,
} from './editor-machine.ts'

const rootId = nodeId('root')
const containerId = nodeId('container')
const valueId = nodeId('value')
const secondValueId = nodeId('second-value')
const thirdValueId = nodeId('third-value')

function createEditorActor() {
  return createActor(editorInteractionMachine, { input: { rootId } }).start()
}

describe('editor interaction machine', () => {
  test('starts idle with serializable root-focused context', () => {
    const actor = createEditorActor()
    const snapshot = actor.getSnapshot()

    expect(selectIsEditing(snapshot)).toBe(false)
    expect(selectActiveNodeId(snapshot)).toBe(rootId)
    expect(selectSelectedNodeIds(snapshot)).toEqual([rootId])
    expect(selectSelectedNodeCount(snapshot)).toBe(1)
    expect(selectSelectionAnchorNodeId(snapshot)).toBe(rootId)
    expect(selectIsSelected(snapshot, rootId)).toBe(true)
    expect(selectExpandedContainerIds(snapshot)).toEqual([])
    expect(selectFormattingEnabled(snapshot)).toBe(true)
    expect(selectEditSession(snapshot)).toBeNull()
    expect(JSON.parse(JSON.stringify(snapshot.context))).toEqual({
      activeNodeId: 'root',
      selectedNodeIds: ['root'],
      anchorNodeId: 'root',
      expandedContainerIds: [],
      formattingEnabled: true,
      edit: null,
    })
  })

  test('focuses nodes and immutably toggles or sets ordered expansion', () => {
    const actor = createEditorActor()
    const initialContext = actor.getSnapshot().context

    actor.send({ type: 'focus', nodeId: valueId })
    actor.send({ type: 'expansion.toggle', containerId })
    let snapshot = actor.getSnapshot()

    expect(selectActiveNodeId(snapshot)).toBe(valueId)
    expect(selectIsExpanded(snapshot, containerId)).toBe(true)
    expect(initialContext).toEqual({
      activeNodeId: rootId,
      selectedNodeIds: [rootId],
      anchorNodeId: rootId,
      expandedContainerIds: [],
      formattingEnabled: true,
      edit: null,
    })

    const expandedIds = selectExpandedContainerIds(snapshot)
    actor.send({ type: 'expansion.set', containerId, expanded: true })
    expect(selectExpandedContainerIds(actor.getSnapshot())).toBe(expandedIds)

    actor.send({ type: 'expansion.toggle', containerId })
    snapshot = actor.getSnapshot()
    expect(selectExpandedContainerIds(snapshot)).toEqual([])
  })

  test('single focus and additive toggle synchronize active node and anchor', () => {
    const actor = createEditorActor()

    actor.send({ type: 'focus', nodeId: valueId })
    expect(selectSelectedNodeIds(actor.getSnapshot())).toEqual([valueId])

    actor.send({ type: 'selection.toggle', nodeId: secondValueId })
    let snapshot = actor.getSnapshot()
    expect(selectSelectedNodeIds(snapshot)).toEqual([valueId, secondValueId])
    expect(selectActiveNodeId(snapshot)).toBe(secondValueId)
    expect(selectSelectionAnchorNodeId(snapshot)).toBe(secondValueId)

    const selectedNodeIds = selectSelectedNodeIds(snapshot)
    actor.send({ type: 'selection.toggle', nodeId: secondValueId })
    snapshot = actor.getSnapshot()
    expect(selectSelectedNodeIds(snapshot)).toEqual([valueId])
    expect(selectSelectedNodeIds(snapshot)).not.toBe(selectedNodeIds)
    expect(selectActiveNodeId(snapshot)).toBe(secondValueId)
    expect(selectIsSelected(snapshot, secondValueId)).toBe(false)
  })

  test('focus-only navigation preserves selection and anchor', () => {
    const actor = createEditorActor()

    actor.send({ type: 'focus', nodeId: valueId })
    const selectedNodeIds = selectSelectedNodeIds(actor.getSnapshot())
    actor.send({ type: 'focus.only', nodeId: secondValueId })

    const snapshot = actor.getSnapshot()
    expect(selectActiveNodeId(snapshot)).toBe(secondValueId)
    expect(selectSelectedNodeIds(snapshot)).toBe(selectedNodeIds)
    expect(selectSelectionAnchorNodeId(snapshot)).toBe(valueId)
  })

  test('additive toggle may leave focus active with an empty selection', () => {
    const actor = createEditorActor()

    actor.send({ type: 'focus', nodeId: valueId })
    actor.send({ type: 'selection.toggle', nodeId: valueId })

    const snapshot = actor.getSnapshot()
    expect(selectActiveNodeId(snapshot)).toBe(valueId)
    expect(selectSelectedNodeCount(snapshot)).toBe(0)
    expect(selectIsSelected(snapshot, valueId)).toBe(false)
    expect(selectSelectionAnchorNodeId(snapshot)).toBe(valueId)
  })

  test('sets an explicitly normalized selection without moving focus', () => {
    const actor = createEditorActor()
    const nodeIds = [valueId, thirdValueId]

    actor.send({ type: 'focus.only', nodeId: containerId })
    actor.send({
      type: 'selection.set',
      nodeIds,
      anchorNodeId: thirdValueId,
    })
    nodeIds.push(secondValueId)

    const snapshot = actor.getSnapshot()
    expect(selectSelectedNodeIds(snapshot)).toEqual([valueId, thirdValueId])
    expect(selectActiveNodeId(snapshot)).toBe(containerId)
    expect(selectSelectionAnchorNodeId(snapshot)).toBe(thirdValueId)
  })

  test('selects an ordered visible sibling range from a stable anchor', () => {
    const actor = createEditorActor()
    const siblingNodeIds = [valueId, secondValueId, thirdValueId]

    actor.send({ type: 'focus', nodeId: valueId })
    actor.send({
      type: 'selection.range',
      siblingNodeIds,
      targetId: thirdValueId,
    })

    let snapshot = actor.getSnapshot()
    expect(selectSelectedNodeIds(snapshot)).toEqual(siblingNodeIds)
    expect(selectActiveNodeId(snapshot)).toBe(thirdValueId)
    expect(selectSelectionAnchorNodeId(snapshot)).toBe(valueId)

    actor.send({
      type: 'selection.range',
      siblingNodeIds,
      targetId: secondValueId,
    })
    snapshot = actor.getSnapshot()
    expect(selectSelectedNodeIds(snapshot)).toEqual([valueId, secondValueId])

    actor.send({
      type: 'selection.range',
      siblingNodeIds: [secondValueId, thirdValueId],
      targetId: thirdValueId,
    })
    snapshot = actor.getSnapshot()
    expect(selectSelectedNodeIds(snapshot)).toEqual([thirdValueId])
    expect(selectSelectionAnchorNodeId(snapshot)).toBe(thirdValueId)
  })

  test('prunes deleted selection state and uses a supplied focus fallback', () => {
    const actor = createEditorActor()

    actor.send({
      type: 'selection.all',
      nodeIds: [valueId, secondValueId, thirdValueId],
    })
    const beforePrune = actor.getSnapshot().context
    actor.send({
      type: 'selection.prune',
      deletedNodeIds: [rootId, valueId, secondValueId],
      fallbackNodeId: containerId,
    })

    const snapshot = actor.getSnapshot()
    expect(selectSelectedNodeIds(snapshot)).toEqual([thirdValueId])
    expect(selectActiveNodeId(snapshot)).toBe(containerId)
    expect(selectSelectionAnchorNodeId(snapshot)).toBeNull()
    expect(beforePrune.selectedNodeIds).toEqual([
      valueId,
      secondValueId,
      thirdValueId,
    ])
  })

  test('prunes expansion, cancels a deleted edit, and selects valid fallback', () => {
    const actor = createEditorActor()

    actor.send({ type: 'expansion.toggle', containerId })
    actor.send({ type: 'expansion.toggle', containerId: thirdValueId })
    actor.send({
      type: 'editing.begin',
      kind: 'primitive',
      targetId: valueId,
      sourceDraft: '1',
    })
    actor.send({
      type: 'selection.prune',
      deletedNodeIds: [valueId, containerId],
      fallbackNodeId: rootId,
    })

    const snapshot = actor.getSnapshot()
    expect(selectIsEditing(snapshot)).toBe(false)
    expect(selectEditSession(snapshot)).toBeNull()
    expect(selectSelectedNodeIds(snapshot)).toEqual([rootId])
    expect(selectActiveNodeId(snapshot)).toBe(rootId)
    expect(selectSelectionAnchorNodeId(snapshot)).toBe(rootId)
    expect(selectExpandedContainerIds(snapshot)).toEqual([thirdValueId])
  })

  test('selects all supplied IDs in order without duplicates', () => {
    const actor = createEditorActor()

    actor.send({ type: 'focus', nodeId: secondValueId })
    actor.send({
      type: 'selection.all',
      nodeIds: [valueId, secondValueId, valueId, thirdValueId],
    })

    let snapshot = actor.getSnapshot()
    expect(selectSelectedNodeIds(snapshot)).toEqual([
      valueId,
      secondValueId,
      thirdValueId,
    ])
    expect(selectSelectedNodeCount(snapshot)).toBe(3)
    expect(selectActiveNodeId(snapshot)).toBe(secondValueId)
    expect(selectSelectionAnchorNodeId(snapshot)).toBe(secondValueId)

    actor.send({ type: 'selection.all', nodeIds: [] })
    snapshot = actor.getSnapshot()
    expect(selectSelectedNodeIds(snapshot)).toEqual([])
    expect(selectActiveNodeId(snapshot)).toBe(secondValueId)
    expect(selectSelectionAnchorNodeId(snapshot)).toBeNull()
  })

  test('owns primitive and header draft workflows without document state', () => {
    const actor = createEditorActor()

    actor.send({
      type: 'editing.begin',
      kind: 'primitive',
      targetId: valueId,
      sourceDraft: '1',
    })
    actor.send({ type: 'editing.change', sourceDraft: '12' })

    let snapshot = actor.getSnapshot()
    expect(selectIsEditing(snapshot)).toBe(true)
    expect(selectActiveNodeId(snapshot)).toBe(valueId)
    expect(selectEditSession(snapshot)).toEqual({
      kind: 'primitive',
      targetId: valueId,
      sourceDraft: '12',
    })

    actor.send({ type: 'editing.idle' })
    expect(selectIsEditing(actor.getSnapshot())).toBe(true)

    actor.send({ type: 'editing.finish' })
    snapshot = actor.getSnapshot()
    expect(selectIsEditing(snapshot)).toBe(false)
    expect(selectEditSession(snapshot)).toBeNull()

    actor.send({
      type: 'editing.begin',
      kind: 'header',
      targetId: containerId,
      sourceDraft: 'Heading',
    })
    expect(selectEditSession(actor.getSnapshot())?.kind).toBe('header')
    actor.send({ type: 'editing.cancel' })
    expect(selectEditSession(actor.getSnapshot())).toBeNull()
  })

  test('toggles global formatting independently of editing', () => {
    const actor = createEditorActor()

    actor.send({ type: 'formatting.toggle' })
    expect(selectFormattingEnabled(actor.getSnapshot())).toBe(false)
    actor.send({ type: 'formatting.toggle' })
    expect(selectFormattingEnabled(actor.getSnapshot())).toBe(true)
  })

  test('identifies commit and external idle events as history boundaries', () => {
    const events: readonly EditorInteractionEvent[] = [
      { type: 'editing.finish' },
      { type: 'editing.idle' },
      { type: 'editing.cancel' },
      { type: 'editing.change', sourceDraft: 'next' },
    ]

    expect(events.map(isEditHistoryBoundaryEvent)).toEqual([
      true,
      true,
      false,
      false,
    ])
  })
})
