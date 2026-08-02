import { useMachine } from '@xstate/react'
import {
  type ChangeEvent,
  type ClipboardEvent,
  type KeyboardEvent,
  type MouseEvent,
  useEffect,
  useEffectEvent,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'

import {
  formatPrimitive,
  type FormattingOverride,
  type JsonDocument,
  type NodeId,
  type PrimitiveNode,
} from '../../domain/document/index.ts'
import type { EventTransaction } from '../../domain/events/index.ts'
import {
  editorInteractionMachine,
  descendantContainerIds,
  presentEditorMessage,
  selectActiveNodeId,
  selectEditSession,
  selectExpandedContainerIds,
  selectFormattingEnabled,
  selectSelectedNodeIds,
} from '../../interaction/index.ts'
import {
  createVisibleSelector,
  selectParent,
  selectValidRoots,
  type UiContainerNode,
  type UiDocumentNode,
  type VisibleItem,
} from '../../state/selectors.ts'
import type { DocumentStore } from '../../state/store.ts'
import { useDocumentStore } from '../../state/react.ts'
import { EditorActionSurface } from '../menus/EditorActionSurface.tsx'
import { useEditorActions } from './useEditorActions.ts'
import { useEditorClipboard } from './useEditorClipboard.ts'

interface EditorTreeProps {
  readonly store: DocumentStore
  readonly onStatus: (message: string) => void
}

interface ComposerState {
  readonly draft: string
  readonly touched: boolean
  readonly error: string | null
}

interface InsertSession {
  readonly anchorId: NodeId
  readonly parentId: NodeId
  readonly index: number
  readonly kind: 'primitive' | 'header'
}

const EMPTY_COMPOSER: ComposerState = {
  draft: '',
  touched: false,
  error: null,
}

export function EditorTree({ store, onStatus }: EditorTreeProps) {
  const snapshot = useDocumentStore(store)
  const document = snapshot.present
  const [machine, send] = useMachine(editorInteractionMachine, {
    input: { rootId: document.rootId },
  })
  const activeId = selectActiveNodeId(machine)
  const selectedIds = selectSelectedNodeIds(machine)
  const edit = selectEditSession(machine)
  const formattingEnabled = selectFormattingEnabled(machine)
  const expandedIds = selectExpandedContainerIds(machine)
  const expanded = useMemo(() => new Set(expandedIds), [expandedIds])
  const [visibleSelector] = useState(() => createVisibleSelector())
  const visible = visibleSelector(document, expanded)
  const visibleById = useMemo(
    () => new Map(visible.map((item) => [item.id, item])),
    [visible],
  )
  const [editError, setEditError] = useState<string | null>(null)
  const [pasteError, setPasteError] = useState<{
    readonly id: NodeId
    readonly message: string
  } | null>(null)
  const [insertSession, setInsertSession] = useState<InsertSession | null>(null)
  const rowRefs = useRef(new Map<NodeId, HTMLElement>())
  const composerRefs = useRef(new Map<NodeId, HTMLInputElement>())
  const requestedComposerFocus = useRef<NodeId | null>(null)
  const requestedRowFocus = useRef<NodeId | null>(null)
  const [treeElement, setTreeElement] = useState<HTMLElement | null>(null)

  useEffect(() => {
    const id = requestedComposerFocus.current
    if (id === null) return
    const composer = composerRefs.current.get(id)
    if (!composer) return
    requestedComposerFocus.current = null
    composer.focus()
  }, [document, expandedIds, insertSession])

  useEffect(() => {
    const id = requestedRowFocus.current
    if (id === null || edit !== null) return
    const row = rowRefs.current.get(id)
    if (!row) return
    requestedRowFocus.current = null
    row.focus()
  }, [activeId, document, edit])

  useEffect(() => {
    const deleted = selectedIds.filter((id) => !document.nodes[id])
    if (!document.nodes[activeId]) deleted.push(activeId)
    if (deleted.length === 0) return
    requestedRowFocus.current = document.rootId
    send({
      type: 'selection.prune',
      deletedNodeIds: [...new Set(deleted)],
      fallbackNodeId: document.rootId,
    })
  }, [activeId, document, selectedIds, send])

  const focusNode = (id: NodeId): void => {
    setPasteError(null)
    requestedRowFocus.current = id
    send({ type: 'focus', nodeId: id })
    const row = rowRefs.current.get(id)
    if (row && edit === null) {
      requestedRowFocus.current = null
      row.focus()
    }
  }
  const focusOnly = (id: NodeId): void => {
    setPasteError(null)
    requestedRowFocus.current = id
    send({ type: 'focus.only', nodeId: id })
    const row = rowRefs.current.get(id)
    if (row && edit === null) {
      requestedRowFocus.current = null
      row.focus()
    }
  }
  const setSelection = (ids: readonly NodeId[], focusId: NodeId): void => {
    setPasteError(null)
    requestedRowFocus.current = focusId
    send({ type: 'focus.only', nodeId: focusId })
    send({ type: 'selection.set', nodeIds: ids, anchorNodeId: focusId })
    requestAnimationFrame(() => rowRefs.current.get(focusId)?.focus())
  }
  const openInsert = (
    anchorId: NodeId,
    kind: 'primitive' | 'header' = 'primitive',
  ): void => {
    const anchor = document.nodes[anchorId]
    if (!anchor) return
    const location = selectParent(document, anchorId)
    const parentId = anchor.type === 'container' ? anchorId : location?.parentId
    if (!parentId) return
    const index =
      anchor.type === 'container'
        ? anchor.childIds.length
        : (location?.index ?? -1) + 1
    if (anchor.type === 'container')
      send({ type: 'expansion.set', containerId: anchorId, expanded: true })
    requestedRowFocus.current = null
    setInsertSession({ anchorId, parentId, index, kind })
    requestedComposerFocus.current = anchorId
    const composer = composerRefs.current.get(anchorId)
    if (composer) composer.focus()
  }
  const focusRow = (id: NodeId): void => {
    focusNode(id)
  }
  const focusHistoryRow = (id: NodeId): void => {
    requestedRowFocus.current = id
    send({ type: 'focus', nodeId: id })
    requestAnimationFrame(() => {
      if (requestedRowFocus.current !== id) return
      requestedRowFocus.current = null
      rowRefs.current.get(id)?.focus()
    })
  }
  const dismissComposer = (id: NodeId, restoreFocus: boolean): void => {
    setInsertSession((current) => (current?.anchorId === id ? null : current))
    if (restoreFocus) focusRow(id)
  }

  const execute = (
    command: Parameters<DocumentStore['execute']>[0],
    success: string,
  ) => {
    const result = store.execute(command)
    if (!result.ok) {
      onStatus(presentEditorMessage(result.error.message))
      return result
    }
    if (result.status === 'applied') {
      if (result.selectedIds) setSelection(result.selectedIds, result.focusId)
      else focusHistoryRow(result.focusId)
      onStatus(success)
    }
    return result
  }

  const commandBase = () => ({
    version: 1 as const,
    expectedRevision: store.getSnapshot().revision,
  })

  const setExpandedIds = (ids: readonly NodeId[], value: boolean): void => {
    ids.forEach((containerId) =>
      send({ type: 'expansion.set', containerId, expanded: value }),
    )
  }

  const setHeaderExpansion = (
    id: NodeId,
    value: boolean,
    includeDescendants: boolean,
  ): void => {
    setExpandedIds(
      includeDescendants ? descendantContainerIds(document, [id], true) : [id],
      value,
    )
  }

  const toggleContainer = (id: NodeId, includeDescendants = false): void => {
    setHeaderExpansion(id, !expanded.has(id), includeDescendants)
  }

  const addPrimitive = (
    parentId: NodeId,
    index: number,
    draft: string,
  ): string | null => {
    const result = execute(
      {
        ...commandBase(),
        type: 'primitive.add',
        parentId,
        index,
        sourceInput: draft,
      },
      'Value added',
    )
    if (!result.ok) {
      return presentEditorMessage(result.error.message)
    }
    if (result.status === 'applied') setInsertSession(null)
    return null
  }

  const addHeader = (
    parentId: NodeId,
    index: number,
    draft: string,
    touched: boolean,
  ): string | null => {
    const result = execute(
      {
        ...commandBase(),
        type: 'header.add',
        parentId,
        index,
        caption: touched ? draft : null,
      },
      'Header added',
    )
    if (!result.ok) {
      return presentEditorMessage(result.error.message)
    }
    if (result.status === 'applied') {
      setInsertSession(null)
      send({
        type: 'expansion.set',
        containerId: result.focusId,
        expanded: true,
      })
    }
    return null
  }

  const beginEdit = (node: UiDocumentNode, initialDraft?: string): void => {
    if (node.type === 'container' && node.id === document.rootId) return
    setEditError(null)
    send({
      type: 'editing.begin',
      kind: node.type === 'primitive' ? 'primitive' : 'header',
      targetId: node.id,
      sourceDraft:
        initialDraft ??
        (node.type === 'primitive' ? node.sourceInput : (node.caption ?? '')),
    })
  }

  const cancelEdit = (): void => {
    const targetId = edit?.targetId
    setEditError(null)
    send({ type: 'editing.cancel' })
    if (targetId) focusHistoryRow(targetId)
    onStatus('Edit cancelled')
  }
  const idleEdit = (id: NodeId): void => {
    send({ type: 'editing.idle' })
    store.closeHistoryGroup(`edit:${id}`)
  }

  const commitEdit = (sourceDraft: string): void => {
    if (!edit) return
    send({ type: 'editing.change', sourceDraft })
    const node = document.nodes[edit.targetId]
    if (!node) {
      send({ type: 'editing.cancel' })
      return
    }
    const unchanged =
      node.type === 'primitive'
        ? node.sourceInput === sourceDraft
        : (node.caption ?? '') === sourceDraft
    if (unchanged) {
      send({ type: 'editing.finish' })
      focusHistoryRow(node.id)
      return
    }
    const result = store.execute(
      node.type === 'primitive'
        ? {
            ...commandBase(),
            type: 'primitive.update',
            targetId: node.id,
            sourceInput: sourceDraft,
          }
        : {
            ...commandBase(),
            type: 'header.rename',
            targetId: node.id,
            caption: sourceDraft,
          },
    )
    if (!result.ok) {
      const message = presentEditorMessage(result.error.message)
      setEditError(message)
      onStatus(message)
      return
    }
    send({ type: 'editing.finish' })
    if (result.status === 'applied') focusNode(result.focusId)
    onStatus(node.type === 'primitive' ? 'Value updated' : 'Header renamed')
  }

  const mutate = (
    type:
      'subtree.remove' | 'subtree.duplicate' | 'header.clear' | 'header.unwrap',
    targetId: NodeId,
    message: string,
  ): void => {
    execute({ ...commandBase(), type, targetId }, message)
  }

  const wrap = (targetId: NodeId): void => {
    const parentId = selectParent(document, targetId)?.parentId
    const parent = parentId ? document.nodes[parentId] : undefined
    const captions = new Set(
      parent?.type === 'container'
        ? parent.childIds.flatMap((id) => {
            const sibling = document.nodes[id]
            return sibling?.type === 'container' && sibling.caption !== null
              ? [sibling.caption]
              : []
          })
        : [],
    )
    let caption = 'new'
    while (captions.has(caption)) caption += ' copy'
    const result = execute(
      { ...commandBase(), type: 'node.wrap', targetId, caption },
      'Item wrapped',
    )
    if (result.ok && result.status === 'applied') {
      send({
        type: 'expansion.set',
        containerId: result.focusId,
        expanded: true,
      })
      const wrapped = store.getSnapshot().present.nodes[result.focusId]
      if (wrapped) {
        requestedRowFocus.current = null
        beginEdit(wrapped)
      }
    }
  }

  const moveHistory = (direction: 'undo' | 'redo'): void => {
    const priorIndex = visible.findIndex(({ id }) => id === activeId)
    const priorNode = document.nodes[activeId]
    const redoFocus =
      direction === 'redo'
        ? addedRoot(snapshot.future.at(-1)?.transaction)
        : undefined
    const moved = direction === 'undo' ? store.undo() : store.redo()
    if (!moved) return
    setInsertSession(null)
    requestedComposerFocus.current = null
    const nextDocument = store.getSnapshot().present
    if (redoFocus && nextDocument.nodes[redoFocus]) focusHistoryRow(redoFocus)
    else if (nextDocument.nodes[activeId]) focusHistoryRow(activeId)
    else {
      const unwrappedChild =
        priorNode?.type === 'container'
          ? priorNode.childIds.find(
              (id) => nextDocument.nodes[id] !== undefined,
            )
          : undefined
      const nextVisible = visibleSelector(nextDocument, expanded)
      const fallback =
        unwrappedChild ??
        nextVisible[Math.min(Math.max(priorIndex, 0), nextVisible.length - 1)]
          ?.id ??
        nextDocument.rootId
      focusHistoryRow(fallback)
    }
    onStatus(direction === 'undo' ? 'Undid last change' : 'Redid last change')
  }

  const undo = (): void => moveHistory('undo')
  const redo = (): void => moveHistory('redo')

  const runHistoryShortcut = useEffectEvent((direction: 'undo' | 'redo') => {
    moveHistory(direction)
  })
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (
        event.defaultPrevented ||
        isTextEntry(event.target) ||
        (!event.ctrlKey && !event.metaKey) ||
        event.key.toLowerCase() !== 'z'
      )
        return
      event.preventDefault()
      runHistoryShortcut(event.shiftKey ? 'redo' : 'undo')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const navigate = (event: KeyboardEvent<HTMLElement>, id: NodeId): void => {
    const node = document.nodes[id]
    if (!node || event.target !== event.currentTarget) return
    const index = visible.findIndex((item) => item.id === id)
    const stop = (): void => {
      event.preventDefault()
      event.stopPropagation()
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      stop()
      if (event.shiftKey) redo()
      else undo()
      return
    }
    if (
      (event.ctrlKey || event.metaKey) &&
      event.key.toLowerCase() === 'd' &&
      id !== document.rootId
    ) {
      stop()
      mutate('subtree.duplicate', id, 'Item duplicated')
      return
    }
    if (
      (event.ctrlKey || event.metaKey) &&
      event.shiftKey &&
      (event.key === 'ArrowUp' || event.key === 'ArrowDown')
    ) {
      stop()
      editorActions.executeOperation({
        type: 'structure.move',
        direction: event.key === 'ArrowUp' ? 'up' : 'down',
      })
      return
    }
    if (
      (event.ctrlKey || event.metaKey) &&
      event.shiftKey &&
      event.key === 'ArrowRight'
    ) {
      stop()
      const roots = selectValidRoots(document, selectedIds)
      const location = selectParent(document, roots[0] ?? id)
      const parent = location ? document.nodes[location.parentId] : undefined
      const targetId =
        parent?.type === 'container' && location
          ? parent.childIds[location.index - 1]
          : undefined
      if (targetId && document.nodes[targetId]?.type === 'container') {
        send({ type: 'expansion.set', containerId: targetId, expanded: true })
        editorActions.executeOperation({
          type: 'structure.move-to',
          containerId: targetId,
          index: document.nodes[targetId].childIds.length,
        })
      } else onStatus('A preceding header is required')
      return
    }
    if (
      (event.ctrlKey || event.metaKey) &&
      event.shiftKey &&
      event.key === 'ArrowLeft'
    ) {
      stop()
      const roots = selectValidRoots(document, selectedIds)
      const parentLocation = selectParent(document, roots[0] ?? id)
      const grandLocation = parentLocation
        ? selectParent(document, parentLocation.parentId)
        : undefined
      if (grandLocation)
        editorActions.executeOperation({
          type: 'structure.move-to',
          containerId: grandLocation.parentId,
          index: grandLocation.index + 1,
        })
      else onStatus('The selection cannot move farther out')
      return
    }
    const directCharacter = Array.from(event.key).length === 1
    const altGraph = event.getModifierState('AltGraph')
    if (
      directCharacter &&
      (event.key !== ' ' || node.type === 'primitive') &&
      ((!event.ctrlKey && !event.metaKey && !event.altKey) || altGraph) &&
      !(node.type === 'container' && id === document.rootId)
    ) {
      stop()
      beginEdit(node, event.key)
      return
    }
    switch (event.key) {
      case 'ArrowDown':
        stop()
        if (event.shiftKey) extendSelection(id, 1)
        else
          focusOnly(visible[Math.min(index + 1, visible.length - 1)]?.id ?? id)
        break
      case 'ArrowUp':
        stop()
        if (event.shiftKey) extendSelection(id, -1)
        else focusOnly(visible[Math.max(index - 1, 0)]?.id ?? id)
        break
      case 'Home':
        stop()
        focusOnly(visible[0]?.id ?? id)
        break
      case 'End':
        stop()
        focusOnly(visible.at(-1)?.id ?? id)
        break
      case 'ArrowRight':
        stop()
        if (
          node.type === 'container' &&
          event.altKey &&
          !event.getModifierState('AltGraph')
        )
          setHeaderExpansion(id, true, true)
        else if (node.type === 'container' && !expanded.has(id))
          setHeaderExpansion(id, true, false)
        else if (node.type === 'container' && node.childIds[0])
          focusOnly(node.childIds[0])
        else if (node.type === 'container') openInsert(id)
        break
      case 'ArrowLeft': {
        stop()
        if (
          node.type === 'container' &&
          event.altKey &&
          !event.getModifierState('AltGraph')
        )
          setHeaderExpansion(id, false, true)
        else if (node.type === 'container' && expanded.has(id))
          setHeaderExpansion(id, false, false)
        else {
          const parentId = selectParent(document, id)?.parentId
          if (parentId) focusOnly(parentId)
        }
        break
      }
      case ' ':
        if (event.ctrlKey || event.metaKey) {
          stop()
          toggleSelection(id)
        } else if (node.type === 'container') {
          stop()
          toggleContainer(
            id,
            event.altKey && !event.getModifierState('AltGraph'),
          )
        }
        break
      case 'Enter':
        stop()
        openInsert(id, event.altKey ? 'header' : 'primitive')
        break
      case 'F2':
        if (id !== document.rootId) {
          stop()
          beginEdit(node)
        }
        break
      case 'Delete':
        if (id !== document.rootId) {
          stop()
          mutate('subtree.remove', id, 'Item deleted')
        }
        break
      case 'Escape':
        if (edit) {
          stop()
          cancelEdit()
        }
        break
    }
  }

  const extendSelection = (id: NodeId, direction: -1 | 1): void => {
    const parentId = selectParent(document, id)?.parentId
    const siblings = parentId
      ? document.nodes[parentId]?.type === 'container'
        ? document.nodes[parentId].childIds
        : [id]
      : [document.rootId]
    const target =
      siblings[
        Math.max(
          0,
          Math.min(siblings.length - 1, siblings.indexOf(id) + direction),
        )
      ] ?? id
    send({
      type: 'selection.range',
      siblingNodeIds: siblings,
      targetId: target,
    })
    const anchor = machine.context.anchorNodeId
    const anchorIndex = anchor === null ? -1 : siblings.indexOf(anchor)
    const targetIndex = siblings.indexOf(target)
    const count = anchorIndex < 0 ? 1 : Math.abs(targetIndex - anchorIndex) + 1
    onStatus(`${count} selected`)
    requestedRowFocus.current = target
    requestAnimationFrame(() => rowRefs.current.get(target)?.focus())
  }

  const selectFromPointer = (
    id: NodeId,
    event: MouseEvent<HTMLElement>,
  ): void => {
    if (event.ctrlKey || event.metaKey) {
      toggleSelection(id)
      return
    }
    if (event.shiftKey) {
      const parentId = selectParent(document, id)?.parentId
      const parent = parentId ? document.nodes[parentId] : undefined
      const siblings = parent?.type === 'container' ? parent.childIds : [id]
      send({ type: 'selection.range', siblingNodeIds: siblings, targetId: id })
      const anchor = machine.context.anchorNodeId
      const anchorIndex = anchor === null ? -1 : siblings.indexOf(anchor)
      const targetIndex = siblings.indexOf(id)
      const count =
        anchorIndex < 0 ? 1 : Math.abs(targetIndex - anchorIndex) + 1
      onStatus(`${count} selected`)
      return
    }
    focusNode(id)
    onStatus('1 selected')
    if (document.nodes[id]?.type === 'container' && edit?.targetId !== id) {
      if (event.altKey) event.preventDefault()
      toggleContainer(id, event.altKey && !event.ctrlKey && !event.shiftKey)
    }
  }

  const toggleSelection = (id: NodeId): void => {
    const candidate = selectedIds.includes(id)
      ? selectedIds.filter((selectedId) => selectedId !== id)
      : [...selectedIds, id]
    const roots = selectValidRoots(document, candidate)
    requestedRowFocus.current = id
    send({ type: 'focus.only', nodeId: id })
    send({ type: 'selection.set', nodeIds: roots, anchorNodeId: id })
    onStatus(`${roots.length} selected`)
  }

  const clipboard = useEditorClipboard({
    store,
    document,
    selectedIds,
    activeId,
    treeElement,
    onApplied: (focusId, ids) => setSelection(ids ?? [focusId], focusId),
    onStatus,
    onError: (message) =>
      setPasteError(message === null ? null : { id: activeId, message }),
  })
  const editorActions = useEditorActions({
    store,
    document,
    selectedIds,
    activeId,
    clipboard,
    setSelection,
    setExpanded: setExpandedIds,
    focus: focusOnly,
    onStatus,
    uiCommand: (id, targetId) => {
      const node = document.nodes[targetId]
      if (!node) return
      if (id === 'add.value' || id === 'add.header') {
        openInsert(targetId, id === 'add.header' ? 'header' : 'primitive')
      } else if (id === 'rename') beginEdit(node)
      else if (id === 'duplicate')
        mutate('subtree.duplicate', targetId, 'Item duplicated')
      else if (id === 'delete')
        mutate('subtree.remove', targetId, 'Item deleted')
      else if (id === 'clear')
        mutate('header.clear', targetId, 'Header cleared')
      else if (id === 'wrap') wrap(targetId)
      else if (id === 'unwrap')
        mutate('header.unwrap', targetId, 'Header unwrapped')
    },
  })

  const setFormatting = (id: NodeId, formatting: FormattingOverride): void => {
    execute(
      {
        ...commandBase(),
        type: 'primitive.formatting.set',
        targetId: id,
        formatting,
      },
      `Formatting set to ${formatting}`,
    )
  }

  return (
    <>
      <div className="editor-toolbar" aria-label="Editor controls">
        <button
          aria-pressed={formattingEnabled}
          className="toolbar-button"
          onClick={() => send({ type: 'formatting.toggle' })}
          type="button"
        >
          Formatting {formattingEnabled ? 'on' : 'off'}
        </button>
        <button
          disabled={snapshot.past.length === 0}
          onClick={undo}
          type="button"
        >
          Undo
        </button>
        <button
          disabled={snapshot.future.length === 0}
          onClick={redo}
          type="button"
        >
          Redo
        </button>
      </div>
      <EditorActionSurface
        disabledReason={editorActions.disabledReason}
        onContextTarget={(id) => {
          if (selectedIds.includes(id)) focusOnly(id)
          else focusNode(id)
        }}
        run={editorActions.run}
      >
        <div
          aria-label="Document"
          className="document-tree"
          ref={setTreeElement}
          role="tree"
        >
          <TreeItem
            activeId={activeId}
            selectedIds={selectedIds}
            registerComposer={(id, element) => {
              if (element) composerRefs.current.set(id, element)
              else composerRefs.current.delete(id)
            }}
            document={document}
            edit={edit}
            editError={editError}
            pasteError={pasteError}
            expanded={expanded}
            formattingEnabled={formattingEnabled}
            id={document.rootId}
            insertSession={insertSession}
            level={1}
            onAddHeader={addHeader}
            onAddPrimitive={addPrimitive}
            onBeginEdit={beginEdit}
            onCancelEdit={cancelEdit}
            onClear={(id) => mutate('header.clear', id, 'Header cleared')}
            onCommitEdit={commitEdit}
            onDelete={(id) => mutate('subtree.remove', id, 'Item deleted')}
            onDuplicate={(id) =>
              mutate('subtree.duplicate', id, 'Item duplicated')
            }
            onFocus={focusOnly}
            onSelect={selectFromPointer}
            onEditIdle={idleEdit}
            onNavigate={navigate}
            onRedo={redo}
            onSetFormatting={setFormatting}
            onUndo={undo}
            onUnwrap={(id) => mutate('header.unwrap', id, 'Header unwrapped')}
            onDismissComposer={dismissComposer}
            onWrap={wrap}
            onPasteReplace={(source) => {
              const error = clipboard.pasteText(source, 'replace')
              if (error === null) send({ type: 'editing.finish' })
            }}
            position={1}
            registerRow={(id, element) => {
              if (element) rowRefs.current.set(id, element)
              else rowRefs.current.delete(id)
            }}
            setSize={1}
            visibleById={visibleById}
          />
        </div>
      </EditorActionSurface>
    </>
  )
}

interface TreeItemProps {
  readonly id: NodeId
  readonly document: JsonDocument
  readonly level: number
  readonly position: number
  readonly setSize: number
  readonly activeId: NodeId
  readonly selectedIds: readonly NodeId[]
  readonly expanded: ReadonlySet<NodeId>
  readonly formattingEnabled: boolean
  readonly edit: ReturnType<typeof selectEditSession>
  readonly editError: string | null
  readonly pasteError: { readonly id: NodeId; readonly message: string } | null
  readonly insertSession: InsertSession | null
  readonly visibleById: ReadonlyMap<NodeId, VisibleItem>
  readonly registerRow: (id: NodeId, element: HTMLElement | null) => void
  readonly registerComposer: (
    id: NodeId,
    element: HTMLInputElement | null,
  ) => void
  readonly onFocus: (id: NodeId) => void
  readonly onSelect: (id: NodeId, event: MouseEvent<HTMLElement>) => void
  readonly onEditIdle: (id: NodeId) => void
  readonly onNavigate: (event: KeyboardEvent<HTMLElement>, id: NodeId) => void
  readonly onUndo: () => void
  readonly onRedo: () => void
  readonly onBeginEdit: (node: UiDocumentNode) => void
  readonly onCommitEdit: (value: string) => void
  readonly onCancelEdit: () => void
  readonly onAddPrimitive: (
    id: NodeId,
    index: number,
    draft: string,
  ) => string | null
  readonly onAddHeader: (
    id: NodeId,
    index: number,
    draft: string,
    touched: boolean,
  ) => string | null
  readonly onDismissComposer: (id: NodeId, restoreFocus: boolean) => void
  readonly onDuplicate: (id: NodeId) => void
  readonly onDelete: (id: NodeId) => void
  readonly onClear: (id: NodeId) => void
  readonly onWrap: (id: NodeId) => void
  readonly onUnwrap: (id: NodeId) => void
  readonly onSetFormatting: (id: NodeId, formatting: FormattingOverride) => void
  readonly onPasteReplace: (source: string) => void
}

function TreeItem(props: TreeItemProps) {
  const node = props.document.nodes[props.id]
  if (!node) return null
  const active = props.activeId === node.id
  const visibleItem = props.visibleById.get(node.id)
  const reference = visibleItem?.reference ?? 'Root'
  const selected = props.selectedIds.includes(node.id)
  const isExpanded = node.type === 'container' && props.expanded.has(node.id)
  const editing = props.edit?.targetId === node.id
  const anonymousLabel =
    node.type === 'container' &&
    node.id !== props.document.rootId &&
    node.caption === null &&
    node.kindOrigin === 'imported'
      ? `Item ${props.position}`
      : null
  const label =
    node.type === 'container'
      ? node.id === props.document.rootId
        ? 'Blank document'
        : node.caption === null
          ? (anonymousLabel ?? 'Blank header')
          : node.caption === ''
            ? 'Empty caption header'
            : node.caption
      : `${node.detectedKind} value`
  const errorId = `edit-error-${node.id}`
  const pasteErrorId = `paste-error-${node.id}`
  const nodePasteError =
    props.pasteError?.id === node.id ? props.pasteError.message : null
  const descriptionId = `kind-${node.id}`
  const shape = visibleItem?.containerPresentation
  const shapeLabel =
    shape === 'object'
      ? 'Object'
      : shape === 'array'
        ? 'Array'
        : shape === 'single'
          ? 'Single value'
          : 'Header'
  const previewNode =
    node.type === 'container' &&
    !isExpanded &&
    node.caption !== null &&
    node.childIds.length === 1
      ? props.document.nodes[node.childIds[0] as NodeId]
      : undefined
  const preview =
    previewNode?.type === 'primitive'
      ? formatPrimitive(previewNode, { enabled: props.formattingEnabled }) ||
        'empty string'
      : null
  const coloredHeaderKind =
    node.type === 'container' &&
    preview === null &&
    (shape === 'object' || shape === 'array')
      ? shape
      : undefined

  const actions = (
    <span aria-label="Item actions" className="row-actions">
      {node.type === 'container' && node.id !== props.document.rootId && (
        <button
          aria-label="Rename header"
          onClick={(event) => {
            event.stopPropagation()
            props.onBeginEdit(node)
          }}
          type="button"
        >
          Rename
        </button>
      )}
      {node.id !== props.document.rootId && (
        <button
          aria-label="Duplicate item"
          onClick={(event) => {
            event.stopPropagation()
            props.onDuplicate(node.id)
          }}
          type="button"
        >
          Duplicate
        </button>
      )}
      {node.type === 'container' && (
        <button
          aria-label="Clear header"
          disabled={node.childIds.length === 0}
          onClick={(event) => {
            event.stopPropagation()
            props.onClear(node.id)
          }}
          type="button"
        >
          Clear
        </button>
      )}
      {node.type === 'primitive' && (
        <button
          aria-label="Promote value to header"
          onClick={(event) => {
            event.stopPropagation()
            props.onWrap(node.id)
          }}
          type="button"
        >
          Promote
        </button>
      )}
      {node.type === 'container' && node.id !== props.document.rootId && (
        <button
          aria-label="Unwrap header"
          onClick={(event) => {
            event.stopPropagation()
            props.onUnwrap(node.id)
          }}
          type="button"
        >
          Unwrap
        </button>
      )}
      {node.id !== props.document.rootId && (
        <button
          aria-label="Delete item"
          className="danger-action"
          onClick={(event) => {
            event.stopPropagation()
            props.onDelete(node.id)
          }}
          type="button"
        >
          Delete
        </button>
      )}
    </span>
  )
  const formattingActions =
    node.type === 'primitive' ? (
      <span
        aria-label="Value formatting"
        className="format-controls"
        onClick={(event) => event.stopPropagation()}
        role="group"
      >
        {(['inherit', 'formatted', 'source'] as const).map((formatting) => (
          <button
            aria-pressed={node.formatting === formatting}
            key={formatting}
            onClick={() => props.onSetFormatting(node.id, formatting)}
            type="button"
          >
            {formatting}
          </button>
        ))}
      </span>
    ) : null

  return (
    <div
      aria-describedby={
        [descriptionId, nodePasteError ? pasteErrorId : null]
          .filter(Boolean)
          .join(' ') || undefined
      }
      aria-expanded={node.type === 'container' ? isExpanded : undefined}
      aria-label={label}
      aria-level={props.level}
      aria-posinset={props.position}
      aria-selected={selected}
      aria-setsize={props.setSize}
      className={`tree-branch level-${props.level}`}
      data-node-id={node.id}
      onFocus={(event) => {
        if (event.target === event.currentTarget) props.onFocus(node.id)
      }}
      onKeyDown={(event) => props.onNavigate(event, node.id)}
      ref={(element) => {
        props.registerRow(node.id, element)
      }}
      role="treeitem"
      tabIndex={active ? 0 : -1}
    >
      <div
        className={`tree-row ${node.type === 'container' ? `header-row${preview === null ? '' : ' has-primitive-preview'}` : 'primitive-row'} ${selected ? 'is-selected' : ''} ${active ? 'is-active' : ''}`}
        data-depth-tone={(props.level - 1) % 6}
        data-header-kind={coloredHeaderKind}
        onClick={(event) => props.onSelect(node.id, event)}
        onDoubleClick={(event) => {
          if (
            node.type === 'primitive' ||
            (node.type === 'container' && node.id !== props.document.rootId)
          ) {
            event.stopPropagation()
            props.onBeginEdit(node)
          }
        }}
      >
        <span aria-hidden="true" className="row-reference">
          {reference}
        </span>
        {node.type === 'container' ? (
          <HeaderContent
            anonymousLabel={anonymousLabel}
            editing={editing}
            error={props.editError}
            errorId={errorId}
            node={node}
            onCancel={props.onCancelEdit}
            onCommit={props.onCommitEdit}
            onIdle={() => props.onEditIdle(node.id)}
            root={node.id === props.document.rootId}
            preview={preview}
            previewKind={
              previewNode?.type === 'primitive'
                ? previewNode.detectedKind
                : null
            }
            sourceDraft={props.edit?.sourceDraft ?? ''}
          />
        ) : (
          <PrimitiveContent
            editing={editing}
            error={props.editError ?? nodePasteError}
            errorId={errorId}
            formattingEnabled={props.formattingEnabled}
            node={node}
            onCancel={props.onCancelEdit}
            onCommit={props.onCommitEdit}
            onIdle={() => props.onEditIdle(node.id)}
            onPaste={props.onPasteReplace}
            sourceDraft={props.edit?.sourceDraft ?? ''}
          />
        )}
        <span aria-hidden={!active} className="active-controls" inert={!active}>
          {formattingActions}
          {actions}
        </span>
        <span className="sr-only" id={descriptionId}>
          Reference {reference}.{' '}
          {node.type === 'primitive'
            ? `Type: ${node.detectedKind}. Value: ${node.sourceInput || 'empty string'}`
            : `${shapeLabel} header${preview === null ? '' : `. Collapsed value: ${preview}`}`}
        </span>
      </div>
      {nodePasteError && !editing && (
        <span className="inline-error" id={pasteErrorId} role="alert">
          {nodePasteError}
        </span>
      )}
      {props.insertSession?.anchorId === node.id && (
        <Composer
          inputRef={(element) => {
            props.registerComposer(node.id, element)
          }}
          onAddHeader={(draft, touched) =>
            props.onAddHeader(
              props.insertSession!.parentId,
              props.insertSession!.index,
              draft,
              touched,
            )
          }
          onAddPrimitive={(draft) =>
            props.onAddPrimitive(
              props.insertSession!.parentId,
              props.insertSession!.index,
              draft,
            )
          }
          onDismiss={(restoreFocus) =>
            props.onDismissComposer(node.id, restoreFocus)
          }
          onRedo={props.onRedo}
          onUndo={props.onUndo}
          preferredKind={props.insertSession.kind}
        />
      )}
      {node.type === 'container' && isExpanded && (
        <div className="tree-group" role="group">
          {node.childIds.map((childId, index) => (
            <TreeItem
              {...props}
              id={childId}
              key={childId}
              level={props.level + 1}
              position={index + 1}
              setSize={node.childIds.length}
            />
          ))}
        </div>
      )}
    </div>
  )
}

interface EditableProps {
  readonly sourceDraft: string
  readonly error: string | null
  readonly errorId: string
  readonly onCommit: (value: string) => void
  readonly onCancel: () => void
  readonly onIdle: () => void
  readonly onPaste?: (source: string) => void
}

function HeaderContent({
  node,
  root,
  anonymousLabel,
  preview,
  previewKind,
  editing,
  ...editable
}: EditableProps & {
  readonly node: UiContainerNode
  readonly root: boolean
  readonly anonymousLabel: string | null
  readonly preview: string | null
  readonly previewKind: PrimitiveNode['detectedKind'] | null
  readonly editing: boolean
}) {
  return (
    <span className="header-content">
      <span aria-hidden="true" className="disclosure" />
      {editing ? (
        <InlineEditor {...editable} ariaLabel="Header caption" singleLine />
      ) : (
        <span className={node.caption === null ? 'blank-caption' : undefined}>
          {root
            ? ''
            : node.caption === null
              ? anonymousLabel
              : node.caption === ''
                ? '""'
                : node.caption}
          {preview !== null && (
            <span
              className={`collapsed-preview value-${previewKind ?? 'string'}`}
            >
              : {preview}
            </span>
          )}
        </span>
      )}
      <span className="child-count">{node.childIds.length}</span>
    </span>
  )
}

function PrimitiveContent({
  node,
  editing,
  formattingEnabled,
  ...editable
}: EditableProps & {
  readonly node: PrimitiveNode
  readonly editing: boolean
  readonly formattingEnabled: boolean
}) {
  if (editing)
    return (
      <InlineEditor {...editable} ariaLabel="Value source" singleLine={false} />
    )
  const value = formatPrimitive(node, { enabled: formattingEnabled })
  return (
    <>
      <span
        aria-label={`${node.detectedKind} type`}
        className={`type-marker type-${node.detectedKind}`}
      >
        {marker(node.detectedKind)}
      </span>
      <span className={`primitive-value value-${node.detectedKind}`}>
        {value === '' ? (
          <span className="empty-value">empty string</span>
        ) : (
          value
        )}
      </span>
    </>
  )
}

function InlineEditor({
  sourceDraft,
  error,
  errorId,
  onCommit,
  onCancel,
  onIdle,
  onPaste,
  ariaLabel,
  singleLine,
}: EditableProps & {
  readonly ariaLabel: string
  readonly singleLine: boolean
}) {
  const [draft, setDraft] = useState(sourceDraft)
  useEffect(() => {
    const timeout = window.setTimeout(onIdle, 500)
    return () => window.clearTimeout(timeout)
  }, [draft, onIdle])
  const onBlur = () => onCommit(draft)
  const onKeyDown = (
    event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    event.stopPropagation()
    if (event.key === 'Escape') {
      event.preventDefault()
      onCancel()
    } else if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      onCommit(draft)
    }
  }
  const common = {
    'aria-describedby': error ? errorId : undefined,
    'aria-invalid': error ? (true as const) : undefined,
    'aria-label': ariaLabel,
    autoFocus: true,
    className: 'inline-editor',
    onBlur,
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setDraft(event.currentTarget.value),
    onClick: (event: MouseEvent) => event.stopPropagation(),
    onKeyDown,
    onPaste: (
      event: ClipboardEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => {
      if (!onPaste) return
      event.preventDefault()
      onPaste(event.clipboardData.getData('text/plain'))
    },
    value: draft,
  }
  return (
    <span className="edit-wrap">
      {singleLine ? <input {...common} /> : <textarea {...common} rows={1} />}
      {error && (
        <span className="inline-error" id={errorId} role="alert">
          {error}
        </span>
      )}
    </span>
  )
}

function Composer({
  inputRef,
  onAddPrimitive,
  onAddHeader,
  onDismiss,
  onUndo,
  onRedo,
  preferredKind,
}: {
  readonly inputRef: (element: HTMLInputElement | null) => void
  readonly onAddPrimitive: (draft: string) => string | null
  readonly onAddHeader: (draft: string, touched: boolean) => string | null
  readonly onDismiss: (restoreFocus: boolean) => void
  readonly onUndo: () => void
  readonly onRedo: () => void
  readonly preferredKind: 'primitive' | 'header'
}) {
  const [composer, setComposer] = useState(EMPTY_COMPOSER)
  const errorId = `composer-error-${useId()}`
  const commit = (kind: 'primitive' | 'header'): void => {
    const error =
      kind === 'primitive'
        ? onAddPrimitive(composer.draft)
        : onAddHeader(composer.draft, composer.touched)
    if (error) setComposer((current) => ({ ...current, error }))
    else setComposer(EMPTY_COMPOSER)
  }
  return (
    <div className="add-composer">
      <span aria-hidden="true" className="composer-prompt">
        +
      </span>
      <input
        aria-describedby={composer.error ? errorId : undefined}
        aria-invalid={composer.error ? true : undefined}
        aria-label={
          preferredKind === 'header' ? 'Add header caption' : 'Add value'
        }
        onBlur={() => {
          setComposer(EMPTY_COMPOSER)
          onDismiss(false)
        }}
        onChange={(event) =>
          setComposer({
            draft: event.currentTarget.value,
            touched: true,
            error: null,
          })
        }
        onKeyDown={(event) => {
          event.stopPropagation()
          if (
            !composer.touched &&
            (event.ctrlKey || event.metaKey) &&
            event.key.toLowerCase() === 'z'
          ) {
            event.preventDefault()
            if (event.shiftKey) onRedo()
            else onUndo()
          } else if (event.key === 'Escape') {
            event.preventDefault()
            setComposer(EMPTY_COMPOSER)
            onDismiss(true)
          } else if (event.key === 'Enter') {
            event.preventDefault()
            commit(preferredKind)
          }
        }}
        ref={inputRef}
        value={composer.draft}
      />
      {composer.error && (
        <span className="inline-error" id={errorId} role="alert">
          {composer.error}
        </span>
      )}
    </div>
  )
}

function isTextEntry(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  )
}

function marker(kind: PrimitiveNode['detectedKind']): string {
  switch (kind) {
    case 'string':
      return 'S'
    case 'number':
      return '#'
    case 'boolean':
      return 'B'
    case 'null':
      return 'N'
    case 'date':
      return 'D'
    case 'datetime':
      return 'T'
  }
}

function addedRoot(
  transaction: EventTransaction | undefined,
): NodeId | undefined {
  if (!transaction) return undefined
  for (const event of [...transaction.events].reverse()) {
    if (event.rootId.before !== event.rootId.after) return event.rootId.after
    const added = new Set(
      event.records
        .filter(({ before, after }) => before === null && after !== null)
        .map(({ id }) => id),
    )
    for (const record of event.records) {
      const before = record.before
      const after = record.after
      if (before?.type !== 'container' || after?.type !== 'container') continue
      const child = after.childIds.find(
        (id) => added.has(id) && !before.childIds.includes(id),
      )
      if (child) return child
    }
  }
  return undefined
}
