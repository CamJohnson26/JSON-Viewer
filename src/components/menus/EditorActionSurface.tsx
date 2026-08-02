import { ContextMenu, Dialog } from '@base-ui/react'
import {
  type FormEvent,
  type ReactNode,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
} from 'react'

import type { NodeId } from '../../domain/document/index.ts'
import { EDITOR_ACTION_CATALOG, type EditorAction } from './action-catalog.ts'

interface EditorActionSurfaceProps {
  readonly children: ReactNode
  readonly run: (
    action: EditorAction,
    values?: Readonly<Record<string, string | boolean>>,
  ) => Promise<string | null>
  readonly disabledReason: (action: EditorAction) => string | null
  readonly onContextTarget: (id: NodeId) => void
}

export function EditorActionSurface({
  children,
  run,
  disabledReason,
  onContextTarget,
}: EditorActionSurfaceProps) {
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [contextQuery, setContextQuery] = useState('')
  const contextSearchRef = useRef<HTMLInputElement>(null)
  const deferredQuery = useDeferredValue(query.trim().toLowerCase())
  const [parameterAction, setParameterAction] = useState<EditorAction | null>(
    null,
  )
  const [parameterError, setParameterError] = useState<string | null>(null)
  const queryTerms = deferredQuery.split(/\s+/).filter(Boolean)
  const filtered = EDITOR_ACTION_CATALOG.filter((action) => {
    return matchesAction(action, queryTerms)
  })
  const contextTerms = contextQuery
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
  const contextActions = EDITOR_ACTION_CATALOG.filter(
    (action) =>
      disabledReason(action) === null && matchesAction(action, contextTerms),
  )

  useEffect(() => {
    const open = (event: KeyboardEvent): void => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === 'p'
      ) {
        event.preventDefault()
        setQuery('')
        setPaletteOpen(true)
      }
    }
    window.addEventListener('keydown', open)
    return () => window.removeEventListener('keydown', open)
  }, [])

  const invoke = (action: EditorAction): void => {
    setPaletteOpen(false)
    if (action.fields?.length) {
      setParameterError(null)
      setParameterAction(action)
    } else void run(action)
  }

  return (
    <>
      <ContextMenu.Root
        onOpenChange={(open) => {
          if (open) setContextQuery('')
        }}
        onOpenChangeComplete={(open) => {
          if (open) contextSearchRef.current?.focus()
        }}
      >
        <ContextMenu.Trigger
          className="context-trigger"
          onContextMenuCapture={(event) => {
            const row = (event.target as HTMLElement).closest<HTMLElement>(
              '[data-node-id]',
            )
            if (row?.dataset.nodeId)
              onContextTarget(row.dataset.nodeId as NodeId)
          }}
        >
          {children}
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Positioner className="menu-positioner">
            <ContextMenu.Popup
              aria-label="Editor actions"
              className="action-menu"
              finalFocus
            >
              <div className="context-menu-search" role="none">
                <input
                  aria-label="Search available actions"
                  onChange={(event) =>
                    setContextQuery(event.currentTarget.value)
                  }
                  onKeyDown={(event) => {
                    if (
                      !event.ctrlKey &&
                      !event.metaKey &&
                      event.key !== 'Escape' &&
                      event.key !== 'ArrowDown' &&
                      event.key !== 'ArrowUp'
                    )
                      event.stopPropagation()
                  }}
                  placeholder="Search actions"
                  ref={contextSearchRef}
                  value={contextQuery}
                />
              </div>
              {contextActions.map((action) => (
                <ContextMenu.Item
                  className="action-menu-item"
                  key={action.id}
                  label={action.label}
                  onClick={() => invoke(action)}
                >
                  {action.label}
                </ContextMenu.Item>
              ))}
              {contextActions.length === 0 && (
                <p className="context-menu-empty" role="status">
                  No matching available actions
                </p>
              )}
            </ContextMenu.Popup>
          </ContextMenu.Positioner>
        </ContextMenu.Portal>
      </ContextMenu.Root>

      <Dialog.Root open={paletteOpen} onOpenChange={setPaletteOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop className="dialog-backdrop" />
          <Dialog.Viewport className="dialog-viewport">
            <Dialog.Popup className="action-dialog">
              <Dialog.Title>Commands</Dialog.Title>
              <Dialog.Description className="sr-only">
                Search and run an editor command
              </Dialog.Description>
              <input
                aria-label="Search commands"
                autoFocus
                onChange={(event) => setQuery(event.currentTarget.value)}
                placeholder="Search"
                value={query}
              />
              <div
                className="palette-results"
                role="listbox"
                aria-label="Command results"
              >
                {filtered.map((action) => {
                  const reason = disabledReason(action)
                  return (
                    <button
                      aria-describedby={
                        reason ? `reason-${action.id}` : undefined
                      }
                      className="palette-action"
                      disabled={reason !== null}
                      key={action.id}
                      onClick={() => invoke(action)}
                      role="option"
                      type="button"
                    >
                      <span>{action.label}</span>
                      {reason && (
                        <small id={`reason-${action.id}`}>{reason}</small>
                      )}
                    </button>
                  )
                })}
                {filtered.length === 0 && <p>No matching commands</p>}
              </div>
              <Dialog.Close>Close</Dialog.Close>
            </Dialog.Popup>
          </Dialog.Viewport>
        </Dialog.Portal>
      </Dialog.Root>

      <ParameterDialog
        action={parameterAction}
        error={parameterError}
        onClose={() => setParameterAction(null)}
        onSubmit={async (values) => {
          if (!parameterAction) return
          const error = await run(parameterAction, values)
          if (error === null) {
            setParameterAction(null)
            setParameterError(null)
          } else setParameterError(error)
        }}
      />
    </>
  )
}

function matchesAction(
  action: EditorAction,
  terms: readonly string[],
): boolean {
  const searchable = `${action.label} ${action.keywords}`.toLowerCase()
  return terms.every((term) => searchable.includes(term))
}

function ParameterDialog({
  action,
  error,
  onClose,
  onSubmit,
}: {
  readonly action: EditorAction | null
  readonly error: string | null
  readonly onClose: () => void
  readonly onSubmit: (
    values: Readonly<Record<string, string | boolean>>,
  ) => Promise<void>
}) {
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const values: Record<string, string | boolean> = {}
    for (const field of action?.fields ?? []) {
      const fieldValue = data.get(field.name)
      values[field.name] =
        field.type === 'checkbox'
          ? data.has(field.name)
          : typeof fieldValue === 'string'
            ? fieldValue
            : ''
    }
    void onSubmit(values)
  }
  return (
    <Dialog.Root
      open={action !== null}
      onOpenChange={(open) => !open && onClose()}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="dialog-backdrop" />
        <Dialog.Viewport className="dialog-viewport">
          <Dialog.Popup className="action-dialog">
            <Dialog.Title>{action?.label}</Dialog.Title>
            <Dialog.Description>Enter action parameters</Dialog.Description>
            <form className="parameter-form" onSubmit={submit}>
              {action?.fields?.map((field, index) => (
                <label key={field.name}>
                  <span>{field.label}</span>
                  {field.type === 'select' ? (
                    <select
                      autoFocus={index === 0}
                      defaultValue={String(field.initial ?? '')}
                      name={field.name}
                    >
                      {field.options?.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  ) : field.type === 'checkbox' ? (
                    <input
                      autoFocus={index === 0}
                      defaultChecked={field.initial === true}
                      name={field.name}
                      type="checkbox"
                    />
                  ) : (
                    <input
                      autoFocus={index === 0}
                      defaultValue={String(field.initial ?? '')}
                      name={field.name}
                      type={field.type ?? 'text'}
                    />
                  )}
                </label>
              ))}
              {error && (
                <p className="inline-error" role="alert">
                  {error}
                </p>
              )}
              <div className="dialog-actions">
                <Dialog.Close>Cancel</Dialog.Close>
                <button type="submit">Apply</button>
              </div>
            </form>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
