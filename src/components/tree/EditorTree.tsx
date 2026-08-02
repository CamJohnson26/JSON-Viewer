import { useMachine } from '@xstate/react'
import {
  type ChangeEvent,
  type KeyboardEvent,
  type MouseEvent,
  useEffect,
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
  selectActiveNodeId,
  selectEditSession,
  selectExpandedContainerIds,
  selectFormattingEnabled,
} from '../../interaction/index.ts'
import {
  createVisibleSelector,
  selectParent,
  type UiContainerNode,
  type UiDocumentNode,
} from '../../state/selectors.ts'
import type { DocumentStore } from '../../state/store.ts'
import { useDocumentStore } from '../../state/react.ts'

interface EditorTreeProps {
  readonly store: DocumentStore
  readonly onStatus: (message: string) => void
}

interface ComposerState {
  readonly draft: string
  readonly touched: boolean
  readonly error: string | null
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
  const edit = selectEditSession(machine)
  const formattingEnabled = selectFormattingEnabled(machine)
  const expandedIds = selectExpandedContainerIds(machine)
  const expanded = useMemo(() => new Set(expandedIds), [expandedIds])
  const [visibleSelector] = useState(() => createVisibleSelector())
  const visible = visibleSelector(document, expanded)
  const [editError, setEditError] = useState<string | null>(null)
  const [hiddenComposers, setHiddenComposers] = useState<readonly NodeId[]>([])
  const rowRefs = useRef(new Map<NodeId, HTMLElement>())
  const composerRefs = useRef(new Map<NodeId, HTMLInputElement>())
  const requestedComposerFocus = useRef<NodeId | null>(null)
  const requestedRowFocus = useRef<NodeId | null>(null)

  useEffect(() => {
    const id = requestedComposerFocus.current
    if (id === null) return
    const composer = composerRefs.current.get(id)
    if (!composer) return
    requestedComposerFocus.current = null
    composer.focus()
  }, [document, expandedIds, hiddenComposers])

  useEffect(() => {
    const id = requestedRowFocus.current
    if (id === null || edit !== null) return
    const row = rowRefs.current.get(id)
    if (!row) return
    requestedRowFocus.current = null
    row.focus()
  }, [activeId, document, edit])

  useEffect(() => {
    if (document.nodes[activeId]) return
    requestedRowFocus.current = document.rootId
    send({ type: 'focus', nodeId: document.rootId })
  }, [activeId, document, send])

  const focusNode = (id: NodeId): void => {
    requestedRowFocus.current = id
    send({ type: 'focus', nodeId: id })
    const row = rowRefs.current.get(id)
    if (row && edit === null) {
      requestedRowFocus.current = null
      row.focus()
    }
  }
  const focusComposer = (id: NodeId): void => {
    requestedRowFocus.current = null
    setHiddenComposers((current) => current.filter((item) => item !== id))
    const composer = composerRefs.current.get(id)
    if (composer) composer.focus()
    else requestedComposerFocus.current = id
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
    setHiddenComposers((current) =>
      current.includes(id) ? current : [...current, id],
    )
    if (restoreFocus) focusRow(id)
  }

  const execute = (
    command: Parameters<DocumentStore['execute']>[0],
    success: string,
  ) => {
    const result = store.execute(command)
    if (!result.ok) {
      onStatus(result.error.message)
      return result
    }
    if (result.status === 'applied') {
      focusHistoryRow(result.focusId)
      onStatus(success)
    }
    return result
  }

  const commandBase = () => ({
    version: 1 as const,
    expectedRevision: store.getSnapshot().revision,
  })

  const toggleContainer = (id: NodeId): void => {
    if (!expanded.has(id)) {
      setHiddenComposers((current) => current.filter((item) => item !== id))
    }
    send({ type: 'expansion.toggle', containerId: id })
  }

  const addPrimitive = (parentId: NodeId, draft: string): string | null => {
    const result = execute(
      { ...commandBase(), type: 'primitive.add', parentId, sourceInput: draft },
      'Value added',
    )
    if (!result.ok) {
      return result.error.message
    }
    focusComposer(parentId)
    return null
  }

  const addHeader = (
    parentId: NodeId,
    draft: string,
    touched: boolean,
  ): string | null => {
    const result = execute(
      {
        ...commandBase(),
        type: 'header.add',
        parentId,
        caption: touched ? draft : null,
      },
      'Header added',
    )
    if (!result.ok) {
      return result.error.message
    }
    if (result.status === 'applied') {
      focusComposer(result.focusId)
      send({
        type: 'expansion.set',
        containerId: result.focusId,
        expanded: true,
      })
    }
    return null
  }

  const beginEdit = (node: UiDocumentNode): void => {
    if (node.type === 'container' && node.id === document.rootId) return
    setEditError(null)
    send({
      type: 'editing.begin',
      kind: node.type === 'primitive' ? 'primitive' : 'header',
      targetId: node.id,
      sourceDraft:
        node.type === 'primitive' ? node.sourceInput : (node.caption ?? ''),
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
      setEditError(result.error.message)
      onStatus(result.error.message)
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
    switch (event.key) {
      case 'ArrowDown':
        stop()
        focusNode(visible[Math.min(index + 1, visible.length - 1)]?.id ?? id)
        break
      case 'ArrowUp':
        stop()
        focusNode(visible[Math.max(index - 1, 0)]?.id ?? id)
        break
      case 'Home':
        stop()
        focusNode(visible[0]?.id ?? id)
        break
      case 'End':
        stop()
        focusNode(visible.at(-1)?.id ?? id)
        break
      case 'ArrowRight':
        stop()
        if (node.type === 'container' && !expanded.has(id))
          send({ type: 'expansion.set', containerId: id, expanded: true })
        else if (node.type === 'container' && node.childIds[0])
          focusNode(node.childIds[0])
        else if (node.type === 'container') focusComposer(id)
        break
      case 'ArrowLeft': {
        stop()
        if (node.type === 'container' && expanded.has(id))
          send({ type: 'expansion.set', containerId: id, expanded: false })
        else {
          const parentId = selectParent(document, id)?.parentId
          if (parentId) focusNode(parentId)
        }
        break
      }
      case ' ':
        if (node.type === 'container') {
          stop()
          send({ type: 'expansion.toggle', containerId: id })
        }
        break
      case 'Enter':
        stop()
        if (node.type === 'primitive') beginEdit(node)
        else {
          if (!expanded.has(id))
            send({ type: 'expansion.set', containerId: id, expanded: true })
          focusComposer(id)
        }
        break
      case 'F2':
        if (node.type === 'container' && id !== document.rootId) {
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
      <div aria-label="Document" className="document-tree" role="tree">
        <TreeItem
          activeId={activeId}
          registerComposer={(id, element) => {
            if (element) composerRefs.current.set(id, element)
            else composerRefs.current.delete(id)
          }}
          document={document}
          edit={edit}
          editError={editError}
          expanded={expanded}
          formattingEnabled={formattingEnabled}
          id={document.rootId}
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
          onFocus={focusNode}
          onEditIdle={idleEdit}
          onNavigate={navigate}
          onSetFormatting={setFormatting}
          onToggle={toggleContainer}
          onUnwrap={(id) => mutate('header.unwrap', id, 'Header unwrapped')}
          hiddenComposers={hiddenComposers}
          onDismissComposer={dismissComposer}
          onWrap={wrap}
          position={1}
          registerRow={(id, element) => {
            if (element) rowRefs.current.set(id, element)
            else rowRefs.current.delete(id)
          }}
          setSize={1}
        />
      </div>
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
  readonly expanded: ReadonlySet<NodeId>
  readonly formattingEnabled: boolean
  readonly edit: ReturnType<typeof selectEditSession>
  readonly editError: string | null
  readonly hiddenComposers: readonly NodeId[]
  readonly registerRow: (id: NodeId, element: HTMLElement | null) => void
  readonly registerComposer: (
    id: NodeId,
    element: HTMLInputElement | null,
  ) => void
  readonly onFocus: (id: NodeId) => void
  readonly onEditIdle: (id: NodeId) => void
  readonly onToggle: (id: NodeId) => void
  readonly onNavigate: (event: KeyboardEvent<HTMLElement>, id: NodeId) => void
  readonly onBeginEdit: (node: UiDocumentNode) => void
  readonly onCommitEdit: (value: string) => void
  readonly onCancelEdit: () => void
  readonly onAddPrimitive: (id: NodeId, draft: string) => string | null
  readonly onAddHeader: (
    id: NodeId,
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
}

function TreeItem(props: TreeItemProps) {
  const node = props.document.nodes[props.id]
  if (!node) return null
  const active = props.activeId === node.id
  const isExpanded = node.type === 'container' && props.expanded.has(node.id)
  const editing = props.edit?.targetId === node.id
  const label =
    node.type === 'container'
      ? node.id === props.document.rootId
        ? 'Blank document'
        : node.caption === null
          ? 'Blank header'
          : node.caption === ''
            ? 'Empty caption header'
            : node.caption
      : `${node.detectedKind} value`
  const errorId = `edit-error-${node.id}`
  const descriptionId = `kind-${node.id}`

  const actions = active ? (
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
      {node.id !== props.document.rootId && (
        <button
          aria-label="Wrap item"
          onClick={(event) => {
            event.stopPropagation()
            props.onWrap(node.id)
          }}
          type="button"
        >
          Wrap
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
  ) : null

  return (
    <div
      aria-describedby={node.type === 'primitive' ? descriptionId : undefined}
      aria-expanded={node.type === 'container' ? isExpanded : undefined}
      aria-label={label}
      aria-level={props.level}
      aria-posinset={props.position}
      aria-selected={active}
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
        className={`tree-row ${node.type === 'container' ? 'header-row' : 'primitive-row'} ${active ? 'is-active' : ''}`}
        onClick={() => {
          props.onFocus(node.id)
          if (node.type === 'container' && !editing) props.onToggle(node.id)
        }}
        onDoubleClick={(event) => {
          if (node.type === 'primitive') {
            event.stopPropagation()
            props.onBeginEdit(node)
          }
        }}
      >
        {node.type === 'container' ? (
          <HeaderContent
            editing={editing}
            error={props.editError}
            errorId={errorId}
            node={node}
            onCancel={props.onCancelEdit}
            onCommit={props.onCommitEdit}
            onIdle={() => props.onEditIdle(node.id)}
            root={node.id === props.document.rootId}
            sourceDraft={props.edit?.sourceDraft ?? ''}
          />
        ) : (
          <PrimitiveContent
            active={active}
            editing={editing}
            error={props.editError}
            errorId={errorId}
            formattingEnabled={props.formattingEnabled}
            node={node}
            onCancel={props.onCancelEdit}
            onCommit={props.onCommitEdit}
            onIdle={() => props.onEditIdle(node.id)}
            onSetFormatting={props.onSetFormatting}
            sourceDraft={props.edit?.sourceDraft ?? ''}
          />
        )}
        {actions}
        {node.type === 'primitive' && (
          <span className="sr-only" id={descriptionId}>
            Type: {node.detectedKind}. Value:{' '}
            {node.sourceInput || 'empty string'}
          </span>
        )}
      </div>
      {node.type === 'container' && isExpanded && (
        <>
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
          {!props.hiddenComposers.includes(node.id) && (
            <Composer
              inputRef={(element) => {
                props.registerComposer(node.id, element)
              }}
              onAddHeader={(draft, touched) =>
                props.onAddHeader(node.id, draft, touched)
              }
              onAddPrimitive={(draft) => props.onAddPrimitive(node.id, draft)}
              onDismiss={(restoreFocus) =>
                props.onDismissComposer(node.id, restoreFocus)
              }
            />
          )}
        </>
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
}

function HeaderContent({
  node,
  root,
  editing,
  ...editable
}: EditableProps & {
  readonly node: UiContainerNode
  readonly root: boolean
  readonly editing: boolean
}) {
  if (editing)
    return <InlineEditor {...editable} ariaLabel="Header caption" singleLine />
  return (
    <span className="header-content">
      <span aria-hidden="true" className="disclosure">
        &gt;
      </span>
      <span className={node.caption === null ? 'blank-caption' : undefined}>
        {root ? '' : node.caption === '' ? '""' : node.caption}
      </span>
      <span className="child-count">{node.childIds.length}</span>
    </span>
  )
}

function PrimitiveContent({
  node,
  active,
  editing,
  formattingEnabled,
  onSetFormatting,
  ...editable
}: EditableProps & {
  readonly node: PrimitiveNode
  readonly active: boolean
  readonly editing: boolean
  readonly formattingEnabled: boolean
  readonly onSetFormatting: (id: NodeId, formatting: FormattingOverride) => void
}) {
  if (editing)
    return (
      <InlineEditor {...editable} ariaLabel="Value source" singleLine={false} />
    )
  const value = active
    ? node.sourceInput
    : formatPrimitive(node, { enabled: formattingEnabled })
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
      {active && (
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
              onClick={() => onSetFormatting(node.id, formatting)}
              type="button"
            >
              {formatting}
            </button>
          ))}
        </span>
      )}
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
}: {
  readonly inputRef: (element: HTMLInputElement | null) => void
  readonly onAddPrimitive: (draft: string) => string | null
  readonly onAddHeader: (draft: string, touched: boolean) => string | null
  readonly onDismiss: (restoreFocus: boolean) => void
}) {
  const [composer, setComposer] = useState(EMPTY_COMPOSER)
  const inputElement = useRef<HTMLInputElement | null>(null)
  const preserveOnNextExit = useRef(false)
  const errorId = `composer-error-${useId()}`
  const commit = (kind: 'primitive' | 'header'): void => {
    const error =
      kind === 'primitive'
        ? onAddPrimitive(composer.draft)
        : onAddHeader(composer.draft, composer.touched)
    if (error) setComposer((current) => ({ ...current, error }))
    else {
      preserveOnNextExit.current = kind === 'header'
      setComposer(EMPTY_COMPOSER)
    }
  }
  return (
    <div className="add-composer">
      <span aria-hidden="true" className="composer-prompt">
        +
      </span>
      <input
        aria-describedby={composer.error ? errorId : undefined}
        aria-invalid={composer.error ? true : undefined}
        aria-label="Add value"
        onBlur={(event) => {
          if (preserveOnNextExit.current) {
            preserveOnNextExit.current = false
            return
          }
          if (
            event.relatedTarget instanceof HTMLElement &&
            event.relatedTarget.classList.contains('add-header-action')
          ) {
            return
          }
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
          if (event.key === 'Escape') {
            event.preventDefault()
            setComposer(EMPTY_COMPOSER)
            onDismiss(true)
          } else if (event.key === 'Enter') {
            event.preventDefault()
            commit(event.altKey ? 'header' : 'primitive')
          }
        }}
        ref={(element) => {
          inputElement.current = element
          inputRef(element)
        }}
        value={composer.draft}
      />
      <button
        aria-label="Add header"
        className="add-header-action"
        onBlur={(event) => {
          if (preserveOnNextExit.current) {
            preserveOnNextExit.current = false
            return
          }
          if (event.relatedTarget === inputElement.current) return
          setComposer(EMPTY_COMPOSER)
          onDismiss(false)
        }}
        onClick={() => commit('header')}
        type="button"
      >
        Header
      </button>
      {composer.error && (
        <span className="inline-error" id={errorId} role="alert">
          {composer.error}
        </span>
      )}
    </div>
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
