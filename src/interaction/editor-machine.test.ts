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
  type EditorInteractionEvent,
} from './editor-machine.ts'

const rootId = nodeId('root')
const containerId = nodeId('container')
const valueId = nodeId('value')

function createEditorActor() {
  return createActor(editorInteractionMachine, { input: { rootId } }).start()
}

describe('editor interaction machine', () => {
  test('starts idle with serializable root-focused context', () => {
    const actor = createEditorActor()
    const snapshot = actor.getSnapshot()

    expect(selectIsEditing(snapshot)).toBe(false)
    expect(selectActiveNodeId(snapshot)).toBe(rootId)
    expect(selectExpandedContainerIds(snapshot)).toEqual([])
    expect(selectFormattingEnabled(snapshot)).toBe(true)
    expect(selectEditSession(snapshot)).toBeNull()
    expect(JSON.parse(JSON.stringify(snapshot.context))).toEqual({
      activeNodeId: 'root',
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
