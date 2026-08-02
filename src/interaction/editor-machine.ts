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
  readonly selectedNodeIds: readonly NodeId[]
  readonly anchorNodeId: NodeId | null
  readonly expandedContainerIds: readonly NodeId[]
  readonly formattingEnabled: boolean
  readonly edit: EditSession | null
}

export interface EditorInteractionInput {
  readonly rootId: NodeId
}

export type EditorInteractionEvent =
  | { readonly type: 'focus'; readonly nodeId: NodeId }
  | { readonly type: 'focus.only'; readonly nodeId: NodeId }
  | { readonly type: 'selection.toggle'; readonly nodeId: NodeId }
  | {
      readonly type: 'selection.set'
      readonly nodeIds: readonly NodeId[]
      readonly anchorNodeId: NodeId | null
    }
  | {
      readonly type: 'selection.range'
      readonly siblingNodeIds: readonly NodeId[]
      readonly targetId: NodeId
    }
  | {
      readonly type: 'selection.prune'
      readonly deletedNodeIds: readonly NodeId[]
      readonly fallbackNodeId?: NodeId
    }
  | { readonly type: 'selection.all'; readonly nodeIds: readonly NodeId[] }
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

function uniqueNodeIds(nodeIds: readonly NodeId[]): readonly NodeId[] {
  return [...new Set(nodeIds)]
}

type SelectionPruneEvent = Extract<
  EditorInteractionEvent,
  { readonly type: 'selection.prune' }
>

function pruneDeletedNodes(
  context: EditorInteractionContext,
  event: SelectionPruneEvent,
): Partial<EditorInteractionContext> {
  const deletedNodeIds = new Set(event.deletedNodeIds)
  const fallbackNodeId =
    event.fallbackNodeId !== undefined &&
    !deletedNodeIds.has(event.fallbackNodeId)
      ? event.fallbackNodeId
      : undefined
  let selectedNodeIds = context.selectedNodeIds.filter(
    (nodeId) => !deletedNodeIds.has(nodeId),
  )
  const selectsFallback =
    selectedNodeIds.length === 0 && fallbackNodeId !== undefined

  if (selectsFallback) {
    selectedNodeIds = [fallbackNodeId]
  }

  return {
    selectedNodeIds,
    anchorNodeId:
      context.anchorNodeId !== null && !deletedNodeIds.has(context.anchorNodeId)
        ? context.anchorNodeId
        : selectsFallback
          ? fallbackNodeId
          : null,
    activeNodeId: deletedNodeIds.has(context.activeNodeId)
      ? (fallbackNodeId ?? selectedNodeIds[0] ?? context.activeNodeId)
      : context.activeNodeId,
    expandedContainerIds: context.expandedContainerIds.filter(
      (containerId) => !deletedNodeIds.has(containerId),
    ),
    edit:
      context.edit !== null && deletedNodeIds.has(context.edit.targetId)
        ? null
        : context.edit,
  }
}

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
    selectedNodeIds: [input.rootId],
    anchorNodeId: input.rootId,
    expandedContainerIds: [],
    formattingEnabled: true,
    edit: null,
  }),
  initial: 'idle',
  on: {
    focus: {
      actions: assign({
        activeNodeId: ({ event }) => event.nodeId,
        selectedNodeIds: ({ event }) => [event.nodeId],
        anchorNodeId: ({ event }) => event.nodeId,
      }),
    },
    'focus.only': {
      actions: assign({
        activeNodeId: ({ event }) => event.nodeId,
      }),
    },
    'selection.set': {
      actions: assign({
        selectedNodeIds: ({ event }) => [...event.nodeIds],
        anchorNodeId: ({ event }) => event.anchorNodeId,
      }),
    },
    'selection.toggle': {
      // Additive deselection intentionally leaves focus and anchor on the toggled node.
      actions: assign({
        activeNodeId: ({ event }) => event.nodeId,
        selectedNodeIds: ({ context, event }) =>
          context.selectedNodeIds.includes(event.nodeId)
            ? context.selectedNodeIds.filter(
                (nodeId) => nodeId !== event.nodeId,
              )
            : [...context.selectedNodeIds, event.nodeId],
        anchorNodeId: ({ event }) => event.nodeId,
      }),
    },
    'selection.range': {
      actions: assign(({ context, event }) => {
        const siblingNodeIds = uniqueNodeIds(event.siblingNodeIds)
        const targetIndex = siblingNodeIds.indexOf(event.targetId)
        const anchorIndex =
          context.anchorNodeId === null
            ? -1
            : siblingNodeIds.indexOf(context.anchorNodeId)

        if (targetIndex === -1 || anchorIndex === -1) {
          return {
            activeNodeId: event.targetId,
            selectedNodeIds: [event.targetId],
            anchorNodeId: event.targetId,
          }
        }

        return {
          activeNodeId: event.targetId,
          selectedNodeIds: siblingNodeIds.slice(
            Math.min(anchorIndex, targetIndex),
            Math.max(anchorIndex, targetIndex) + 1,
          ),
        }
      }),
    },
    'selection.prune': [
      {
        guard: ({ context, event }) =>
          context.edit !== null &&
          event.deletedNodeIds.includes(context.edit.targetId),
        target: '#editorInteraction.idle',
        actions: assign(({ context, event }) =>
          pruneDeletedNodes(context, event),
        ),
      },
      {
        actions: assign(({ context, event }) =>
          pruneDeletedNodes(context, event),
        ),
      },
    ],
    'selection.all': {
      actions: assign(({ context, event }) => {
        const selectedNodeIds = uniqueNodeIds(event.nodeIds)
        const activeNodeId = selectedNodeIds.includes(context.activeNodeId)
          ? context.activeNodeId
          : (selectedNodeIds[0] ?? context.activeNodeId)

        return {
          selectedNodeIds,
          activeNodeId,
          anchorNodeId: selectedNodeIds.length === 0 ? null : activeNodeId,
        }
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
            selectedNodeIds: ({ event }) => [event.targetId],
            anchorNodeId: ({ event }) => event.targetId,
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
            selectedNodeIds: ({ event }) => [event.targetId],
            anchorNodeId: ({ event }) => event.targetId,
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

export const selectSelectedNodeIds = (
  snapshot: EditorInteractionSnapshot,
): readonly NodeId[] => snapshot.context.selectedNodeIds

export const selectSelectedNodeCount = (
  snapshot: EditorInteractionSnapshot,
): number => snapshot.context.selectedNodeIds.length

export const selectSelectionAnchorNodeId = (
  snapshot: EditorInteractionSnapshot,
): NodeId | null => snapshot.context.anchorNodeId

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

export function selectIsSelected(
  snapshot: EditorInteractionSnapshot,
  nodeId: NodeId,
): boolean {
  return snapshot.context.selectedNodeIds.includes(nodeId)
}

export function isEditHistoryBoundaryEvent(
  event: EditorInteractionEvent,
): event is EditHistoryBoundaryEvent {
  return event.type === 'editing.finish' || event.type === 'editing.idle'
}
