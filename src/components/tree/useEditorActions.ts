import type { JsonDocument, NodeId } from '../../domain/document/index.ts'
import {
  findMatchingIds,
  nodePayload,
  validateQueryPayload,
  type JsonOperationInput,
  type JsonQuery,
} from '../../domain/operations/index.ts'
import { writeClipboardText } from '../../infrastructure/index.ts'
import {
  ancestorIds,
  descendantContainerIds,
  resolveSourcePath,
  sourcePath,
} from '../../interaction/navigation.ts'
import { presentEditorMessage } from '../../interaction/presentation.ts'
import { selectParent, selectValidRoots } from '../../state/selectors.ts'
import type { DocumentStore } from '../../state/store.ts'
import type { EditorAction } from '../menus/action-catalog.ts'
import type { EditorClipboard } from './useEditorClipboard.ts'

interface ActionsOptions {
  readonly store: DocumentStore
  readonly document: JsonDocument
  readonly selectedIds: readonly NodeId[]
  readonly activeId: NodeId
  readonly clipboard: EditorClipboard
  readonly setSelection: (ids: readonly NodeId[], focusId: NodeId) => void
  readonly setExpanded: (ids: readonly NodeId[], expanded: boolean) => void
  readonly focus: (id: NodeId) => void
  readonly uiCommand: (id: string, targetId: NodeId) => void
  readonly onStatus: (message: string) => void
}

export function useEditorActions(options: ActionsOptions) {
  const roots = selectValidRoots(options.document, options.selectedIds)
  const executeOperation = (operation: JsonOperationInput): string | null => {
    const result = options.store.execute({
      version: 1,
      expectedRevision: options.store.getSnapshot().revision,
      type: 'operation.apply',
      selectedIds: roots,
      operation: { ...operation, version: 1 } as never,
    })
    if (!result.ok) {
      options.onStatus(presentEditorMessage(result.error.message))
      return presentEditorMessage(result.error.message)
    }
    if (result.status === 'applied') {
      options.setSelection(
        result.selectedIds ?? [result.focusId],
        result.focusId,
      )
      options.onStatus('Action applied')
    } else options.onStatus('No changes needed')
    return null
  }

  const run = async (
    action: EditorAction,
    values: Readonly<Record<string, string | boolean>> = {},
  ): Promise<string | null> => {
    try {
      if (action.id === 'structure.move-to') {
        const target = resolveSourcePath(
          options.document,
          String(values.path ?? ''),
        )
        if (!target || options.document.nodes[target]?.type !== 'container')
          throw new Error('Destination path must identify a header')
        return executeOperation({
          type: 'structure.move-to',
          containerId: target,
          index: Number(values.index ?? 0),
        })
      }
      if (action.id === 'collection.reorder') {
        const node = options.document.nodes[roots[0] as NodeId]
        if (node?.type !== 'container') throw new Error('Choose one header')
        const positions = String(values.positions ?? '')
          .split(',')
          .map((item) => Number(item.trim()) - 1)
        if (
          positions.length !== node.childIds.length ||
          positions.some((index) => !Number.isSafeInteger(index) || index < 0)
        )
          throw new Error('Positions must list every child exactly once')
        return executeOperation({
          type: 'collection.reorder',
          childIds: positions.map((index) => node.childIds[index] as NodeId),
        })
      }
      if (action.operation) {
        return executeOperation(action.operation(values))
      }
      if (action.kind === 'command') {
        options.uiCommand(action.id, roots[0] as NodeId)
        return null
      }
      if (action.id === 'copy') return options.clipboard.copy()
      if (action.id === 'paste') return options.clipboard.paste()
      if (action.id === 'paste.into') return options.clipboard.paste('into')
      if (action.id === 'paste.beside') return options.clipboard.paste('beside')
      if (action.id === 'paste.replace')
        return options.clipboard.paste('replace')
      if (action.id === 'show.path' || action.id === 'copy.path') {
        const path = sourcePath(options.document, options.activeId)
        if (path === null) {
          options.onStatus('Source path is unavailable')
          return 'Source path is unavailable'
        }
        if (action.id === 'copy.path') await writeClipboardText(path)
        options.onStatus(path === '' ? '/' : path)
        return null
      }
      if (action.id === 'focus.path') {
        const id = resolveSourcePath(
          options.document,
          String(values.path ?? ''),
        )
        if (!id) {
          options.onStatus('Source path was not found')
          return 'Source path was not found'
        }
        options.setExpanded(ancestorIds(options.document, id), true)
        options.focus(id)
        options.onStatus(`Focused ${sourcePath(options.document, id) || '/'}`)
        return null
      }
      if (action.id === 'select.matches') {
        const query = JSON.parse(String(values.query ?? '')) as JsonQuery
        const validation = validateQueryPayload(query)
        if (validation) throw new Error(validation.message)
        const ids = findMatchingIds(options.document, roots, query)
        if (ids.length === 0) throw new Error('No matching values were found')
        options.setSelection(ids, ids[0] as NodeId)
        options.onStatus(`${ids.length} selected`)
        return null
      }
      const all = action.id.endsWith('.all')
      const expanding = action.id.startsWith('expand.')
      const targets = descendantContainerIds(
        options.document,
        all ? [options.document.rootId] : roots,
        all,
      )
      if (!expanding) {
        const fallback = ancestorIds(options.document, options.activeId).find(
          (id) => targets.includes(id),
        )
        if (fallback) options.setSelection([fallback], fallback)
      }
      options.setExpanded(targets, expanding)
      options.onStatus(
        expanding ? 'Expanded requested rows' : 'Collapsed requested rows',
      )
      return null
    } catch (error) {
      const message = presentEditorMessage(
        error instanceof Error ? error.message : 'Action failed',
      )
      options.onStatus(message)
      return message
    }
  }

  const disabledReason = (action: EditorAction): string | null => {
    const active = options.document.nodes[roots[0] ?? options.activeId]
    const nodes = roots.flatMap((id) => {
      const node = options.document.nodes[id]
      return node ? [node] : []
    })
    if (roots.length === 0) return 'Select at least one item'
    const values = roots.map((id) => nodePayload(options.document, id))
    const objects = values.every(
      (value) =>
        value !== null && typeof value === 'object' && !Array.isArray(value),
    )
    const arrays = values.every(Array.isArray)
    if (action.kind === 'command' && roots.length !== 1)
      return 'Choose one item'
    if (
      action.id === 'rename' &&
      (active?.type !== 'container' || active.id === options.document.rootId)
    )
      return 'Choose a named header'
    if (
      (action.id === 'unwrap' ||
        action.id === 'clear' ||
        action.id === 'paste.into') &&
      active?.type !== 'container'
    )
      return 'Choose a header'
    if (
      (action.id === 'delete' ||
        action.id === 'duplicate' ||
        action.id === 'wrap') &&
      roots.includes(options.document.rootId)
    )
      return 'The root cannot use this action'
    if (action.id === 'wrap' && active?.type !== 'primitive')
      return 'Choose a value'
    if (action.id === 'duplicate' && roots.length !== 1)
      return 'Choose one item'
    if (
      action.id === 'clear' &&
      active?.type === 'container' &&
      active.childIds.length === 0
    )
      return 'The header is already empty'
    if (
      action.id === 'unwrap' &&
      (active?.type !== 'container' ||
        active.caption === null ||
        active.childIds.length === 0)
    )
      return 'Choose a non-empty named header'
    if (
      (action.id === 'paste.beside' || action.id === 'paste.replace') &&
      options.activeId === options.document.rootId
    )
      return 'Choose a nested item'
    if (action.id === 'data.diff' && roots.length !== 2)
      return 'Select exactly two items'
    if (action.id === 'data.merge' && roots.length < 2)
      return 'Select at least two items'
    if (action.id === 'data.merge' && !objects) return 'Choose named headers'
    if (action.id === 'data.extract' && !objects) return 'Choose named headers'
    if (action.id === 'data.rename-path' && !objects)
      return 'Choose named headers'
    if (action.id === 'collection.group' && !arrays)
      return 'Choose ordered values'
    if (action.id === 'collection.reorder' && roots.length !== 1)
      return 'Choose one header'
    if (
      (action.id === 'move.up' || action.id === 'move.down') &&
      !sameParent(options.document, roots)
    )
      return 'Select siblings'
    if (
      action.id.startsWith('text.') &&
      !nodes.every(
        (node) => node.type === 'primitive' && typeof node.value === 'string',
      )
    )
      return 'Choose text values'
    if (
      action.id.startsWith('primitive.') &&
      !nodes.every((node) => node.type === 'primitive')
    )
      return 'Choose values'
    if (
      action.id === 'primitive.toggle' &&
      !nodes.every(
        (node) => node.type === 'primitive' && typeof node.value === 'boolean',
      )
    )
      return 'Choose boolean values'
    if (
      (action.id === 'primitive.adjust' ||
        action.id === 'primitive.number-format') &&
      !nodes.every(
        (node) => node.type === 'primitive' && typeof node.value === 'number',
      )
    )
      return 'Choose number values'
    if (
      action.id === 'primitive.date-format' &&
      !nodes.every(
        (node) =>
          node.type === 'primitive' &&
          (node.detectedKind === 'date' || node.detectedKind === 'datetime'),
      )
    )
      return 'Choose date values'
    if (
      action.id.startsWith('collection.') &&
      !nodes.every((node) => node.type === 'container')
    )
      return 'Choose headers'
    if (
      ['structure.reverse', 'structure.remove-empty'].includes(action.id) &&
      !nodes.every((node) => node.type === 'container')
    )
      return 'Choose headers'
    if (
      action.id === 'structure.flatten' &&
      !nodes.every(
        (node) =>
          node.type === 'container' &&
          node.id !== options.document.rootId &&
          node.kind !== 'scalar',
      )
    )
      return 'Choose nested headers'
    if (
      action.id === 'structure.remove' &&
      roots.includes(options.document.rootId)
    )
      return 'The root cannot use this action'
    if (
      action.id === 'structure.move-to' &&
      roots.includes(options.document.rootId)
    )
      return 'The root cannot be moved'
    if (
      (action.id === 'expand.descendants' ||
        action.id === 'collapse.descendants') &&
      !nodes.every((node) => node.type === 'container')
    )
      return 'Choose headers'
    return null
  }

  return { run, disabledReason, executeOperation }
}

function sameParent(document: JsonDocument, ids: readonly NodeId[]): boolean {
  if (ids.length === 0) return false
  const parent = selectParent(document, ids[0] as NodeId)?.parentId
  return (
    parent !== undefined &&
    ids.every((id) => selectParent(document, id)?.parentId === parent)
  )
}
