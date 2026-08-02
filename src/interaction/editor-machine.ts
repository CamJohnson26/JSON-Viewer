import { assign, setup, type SnapshotFrom } from 'xstate'

import type { NodeId } from '../domain/document/index.ts'

export type EditKind = 'primitive' | 'header'

export interface EditSession {
  readonly kind: EditKind
  readonly targetId: NodeId
  readonly sourceDraft: string
}

export interface EditorInteractionContext {
  readonly activeNodeId: NodeId
  readonly expandedContainerIds: readonly NodeId[]
  readonly formattingEnabled: boolean
  readonly edit: EditSession | null
}

export interface EditorInteractionInput {
  readonly rootId: NodeId
}

export type EditorInteractionEvent =
  | { readonly type: 'focus'; readonly nodeId: NodeId }
  | { readonly type: 'expansion.toggle'; readonly containerId: NodeId }
  | {
      readonly type: 'expansion.set'
      readonly containerId: NodeId
      readonly expanded: boolean
    }
  | {
      readonly type: 'editing.begin'
      readonly kind: EditKind
      readonly targetId: NodeId
      readonly sourceDraft: string
    }
  | { readonly type: 'editing.change'; readonly sourceDraft: string }
  | { readonly type: 'editing.finish' }
  | { readonly type: 'editing.cancel' }
  | { readonly type: 'editing.idle' }
  | { readonly type: 'formatting.toggle' }

export type EditHistoryBoundaryEvent = Extract<
  EditorInteractionEvent,
  { readonly type: 'editing.finish' | 'editing.idle' }
>

export const editorInteractionMachine = setup({
  types: {
    context: {} as EditorInteractionContext,
    events: {} as EditorInteractionEvent,
    input: {} as EditorInteractionInput,
  },
}).createMachine({
  id: 'editorInteraction',
  context: ({ input }) => ({
    activeNodeId: input.rootId,
    expandedContainerIds: [],
    formattingEnabled: true,
    edit: null,
  }),
  initial: 'idle',
  on: {
    focus: {
      actions: assign({
        activeNodeId: ({ event }) => event.nodeId,
      }),
    },
    'expansion.toggle': {
      actions: assign({
        expandedContainerIds: ({ context, event }) =>
          context.expandedContainerIds.includes(event.containerId)
            ? context.expandedContainerIds.filter(
                (containerId) => containerId !== event.containerId,
              )
            : [...context.expandedContainerIds, event.containerId],
      }),
    },
    'expansion.set': {
      actions: assign({
        expandedContainerIds: ({ context, event }) => {
          const isExpanded = context.expandedContainerIds.includes(
            event.containerId,
          )
          if (event.expanded === isExpanded) return context.expandedContainerIds
          return event.expanded
            ? [...context.expandedContainerIds, event.containerId]
            : context.expandedContainerIds.filter(
                (containerId) => containerId !== event.containerId,
              )
        },
      }),
    },
    'formatting.toggle': {
      actions: assign({
        formattingEnabled: ({ context }) => !context.formattingEnabled,
      }),
    },
  },
  states: {
    idle: {
      on: {
        'editing.begin': {
          target: 'editing',
          actions: assign({
            activeNodeId: ({ event }) => event.targetId,
            edit: ({ event }) => ({
              kind: event.kind,
              targetId: event.targetId,
              sourceDraft: event.sourceDraft,
            }),
          }),
        },
      },
    },
    editing: {
      on: {
        'editing.begin': {
          actions: assign({
            activeNodeId: ({ event }) => event.targetId,
            edit: ({ event }) => ({
              kind: event.kind,
              targetId: event.targetId,
              sourceDraft: event.sourceDraft,
            }),
          }),
        },
        'editing.change': {
          actions: assign({
            edit: ({ context, event }) =>
              context.edit === null
                ? null
                : { ...context.edit, sourceDraft: event.sourceDraft },
          }),
        },
        'editing.finish': {
          target: 'idle',
          actions: assign({ edit: null }),
        },
        'editing.cancel': {
          target: 'idle',
          actions: assign({ edit: null }),
        },
        // A UI-owned idle timer sends this event and closes its store group.
        'editing.idle': {},
      },
    },
  },
})

export type EditorInteractionSnapshot = SnapshotFrom<
  typeof editorInteractionMachine
>

export const selectActiveNodeId = (
  snapshot: EditorInteractionSnapshot,
): NodeId => snapshot.context.activeNodeId

export const selectExpandedContainerIds = (
  snapshot: EditorInteractionSnapshot,
): readonly NodeId[] => snapshot.context.expandedContainerIds

export const selectFormattingEnabled = (
  snapshot: EditorInteractionSnapshot,
): boolean => snapshot.context.formattingEnabled

export const selectEditSession = (
  snapshot: EditorInteractionSnapshot,
): EditSession | null => snapshot.context.edit

export const selectIsEditing = (snapshot: EditorInteractionSnapshot): boolean =>
  snapshot.matches('editing')

export function selectIsExpanded(
  snapshot: EditorInteractionSnapshot,
  containerId: NodeId,
): boolean {
  return snapshot.context.expandedContainerIds.includes(containerId)
}

export function isEditHistoryBoundaryEvent(
  event: EditorInteractionEvent,
): event is EditHistoryBoundaryEvent {
  return event.type === 'editing.finish' || event.type === 'editing.idle'
}
