import {
  type MouseEvent,
  type PointerEvent,
  useEffect,
  useRef,
  useState,
} from 'react'

import type { JsonDocument, NodeId } from '../../domain/document/index.ts'
import {
  dropPositionFromPoint,
  resolveDropIntent,
  type DropIntent,
  type DropPosition,
  type DropResolution,
} from '../../interaction/index.ts'
import { selectValidRoots } from '../../state/selectors.ts'

const DRAG_THRESHOLD = 5
const REVEAL_DELAY = 500
const SCROLL_EDGE = 56
const MAX_SCROLL_STEP = 18

export interface PointerDragView {
  readonly sourceIds: readonly NodeId[]
  readonly sourceIdSet: ReadonlySet<NodeId>
  readonly targetId: NodeId | null
  readonly position: DropPosition | null
  readonly valid: boolean
}

interface DragSession {
  readonly pointerId: number
  readonly capture: HTMLElement
  readonly sourceDocument: JsonDocument
  readonly sourceIds: readonly NodeId[]
  readonly sourceIdSet: ReadonlySet<NodeId>
  readonly revealedIds: Set<NodeId>
  startX: number
  startY: number
  clientX: number
  clientY: number
  dragging: boolean
  drop: DropResolution | null
  dropTargetId: NodeId | null
  dropPosition: DropPosition | null
  revealId: NodeId | null
  revealTimer: number | null
  scrollFrame: number | null
}

interface PointerDragOptions {
  readonly document: JsonDocument
  readonly selectedIds: readonly NodeId[]
  readonly expanded: ReadonlySet<NodeId>
  readonly enabled: boolean
  readonly onSelectSources: (ids: readonly NodeId[], focusId: NodeId) => void
  readonly onSetExpanded: (id: NodeId, expanded: boolean) => void
  readonly onCommit: (
    sourceIds: readonly NodeId[],
    intent: DropIntent,
  ) => boolean
  readonly onStatus: (message: string) => void
}

export function usePointerDrag(options: PointerDragOptions) {
  const optionsRef = useRef(options)
  optionsRef.current = options
  const session = useRef<DragSession | null>(null)
  const suppressClick = useRef(false)
  const [view, setView] = useState<PointerDragView | null>(null)

  const clearRevealTimer = (current: DragSession): void => {
    if (current.revealTimer !== null) window.clearTimeout(current.revealTimer)
    current.revealTimer = null
    current.revealId = null
  }

  const stopScroll = (current: DragSession): void => {
    if (current.scrollFrame !== null) cancelAnimationFrame(current.scrollFrame)
    current.scrollFrame = null
  }

  const finish = (completed: boolean): void => {
    const current = session.current
    if (!current) return
    session.current = null
    clearRevealTimer(current)
    stopScroll(current)
    for (const id of current.revealedIds)
      if (!(
        completed &&
        current.drop?.ok &&
        current.drop.intent.containerId === id
      ))
        optionsRef.current.onSetExpanded(id, false)
    if (current.capture.hasPointerCapture(current.pointerId))
      current.capture.releasePointerCapture(current.pointerId)
    setView(null)
  }

  const suppressCompatibilityClick = (pointerId: number): void => {
    suppressClick.current = true
    const clear = (event: globalThis.PointerEvent): void => {
      if (event.pointerId !== pointerId) return
      window.removeEventListener('pointerup', clear)
      window.setTimeout(() => {
        suppressClick.current = false
      })
    }
    window.addEventListener('pointerup', clear)
    window.setTimeout(() => {
      window.removeEventListener('pointerup', clear)
      suppressClick.current = false
    }, 1000)
  }

  const cancel = (message = 'Move cancelled', suppress = false): void => {
    const pointerId = session.current?.pointerId
    const dragging = session.current?.dragging === true
    if (dragging && suppress && pointerId !== undefined)
      suppressCompatibilityClick(pointerId)
    finish(false)
    if (dragging) optionsRef.current.onStatus(message)
  }
  const finishRef = useRef(finish)
  const cancelRef = useRef(cancel)
  finishRef.current = finish
  cancelRef.current = cancel

  const scheduleReveal = (
    current: DragSession,
    resolution: DropResolution,
  ): void => {
    const revealId =
      resolution.ok &&
      resolution.intent.position === 'inside' &&
      !optionsRef.current.expanded.has(resolution.intent.containerId)
        ? resolution.intent.containerId
        : null
    if (current.revealId === revealId) return
    clearRevealTimer(current)
    if (revealId === null) return
    current.revealId = revealId
    current.revealTimer = window.setTimeout(() => {
      if (session.current !== current || current.revealId !== revealId) return
      current.revealTimer = null
      current.revealedIds.add(revealId)
      optionsRef.current.onSetExpanded(revealId, true)
    }, REVEAL_DELAY)
  }

  const resolveAtPoint = (current: DragSession): void => {
    const hit = globalThis.document.elementFromPoint(
      current.clientX,
      current.clientY,
    )
    const branch = hit?.closest<HTMLElement>('[data-node-id]')
    const row = branch?.querySelector<HTMLElement>(':scope > .tree-row')
    const targetId = branch?.dataset.nodeId as NodeId | undefined
    if (!row || !targetId) {
      clearRevealTimer(current)
      if (current.drop === null && current.dropTargetId === null) return
      current.drop = null
      current.dropTargetId = null
      current.dropPosition = null
      setView({
        sourceIds: current.sourceIds,
        sourceIdSet: current.sourceIdSet,
        targetId: null,
        position: null,
        valid: false,
      })
      return
    }
    const target = optionsRef.current.document.nodes[targetId]
    const position = dropPositionFromPoint(
      row.getBoundingClientRect(),
      current.clientY,
      target?.type === 'container' && target.kind !== 'scalar',
    )
    if (
      current.drop !== null &&
      current.dropTargetId === targetId &&
      current.dropPosition === position
    )
      return
    const resolution = resolveDropIntent(
      optionsRef.current.document,
      current.sourceIds,
      targetId,
      position,
    )
    current.drop = resolution
    current.dropTargetId = targetId
    current.dropPosition = position
    scheduleReveal(current, resolution)
    const label = targetLabel(optionsRef.current.document, targetId)
    optionsRef.current.onStatus(
      resolution.ok
        ? `Drop ${position} ${label}`
        : `Cannot drop here: ${resolution.reason}`,
    )
    setView({
      sourceIds: current.sourceIds,
      sourceIdSet: current.sourceIdSet,
      targetId,
      position,
      valid: resolution.ok,
    })
  }

  function scroll(): void {
    const current = session.current
    if (!current?.dragging) return
    const distance =
      current.clientY < SCROLL_EDGE
        ? current.clientY - SCROLL_EDGE
        : current.clientY > window.innerHeight - SCROLL_EDGE
          ? current.clientY - (window.innerHeight - SCROLL_EDGE)
          : 0
    if (distance !== 0) {
      const step =
        Math.sign(distance) *
        Math.min(MAX_SCROLL_STEP, Math.ceil(Math.abs(distance) / 3))
      window.scrollBy(0, step)
      resolveAtPoint(current)
    }
    current.scrollFrame = requestAnimationFrame(scroll)
  }

  const onPointerDown = (event: PointerEvent<HTMLElement>): void => {
    if (
      !options.enabled ||
      event.button !== 0 ||
      !event.isPrimary ||
      session.current !== null
    )
      return
    const target = event.target
    if (
      !(target instanceof Element) ||
      !target.closest('.row-reference') ||
      target.closest(
        'input, textarea, select, button, [contenteditable="true"]',
      )
    )
      return
    const branch = target.closest<HTMLElement>('[data-node-id]')
    const handle = target.closest<HTMLElement>('.row-reference')
    const sourceId = branch?.dataset.nodeId as NodeId | undefined
    if (!sourceId || !handle || sourceId === options.document.rootId) return
    const sourceIds = selectValidRoots(
      options.document,
      options.selectedIds.includes(sourceId) ? options.selectedIds : [sourceId],
    )
    if (sourceIds.length === 0) return
    handle.setPointerCapture(event.pointerId)
    session.current = {
      pointerId: event.pointerId,
      capture: handle,
      sourceDocument: options.document,
      sourceIds,
      sourceIdSet: new Set(sourceIds),
      revealedIds: new Set(),
      startX: event.clientX,
      startY: event.clientY,
      clientX: event.clientX,
      clientY: event.clientY,
      dragging: false,
      drop: null,
      dropTargetId: null,
      dropPosition: null,
      revealId: null,
      revealTimer: null,
      scrollFrame: null,
    }
  }

  const onPointerMove = (event: PointerEvent<HTMLElement>): void => {
    const current = session.current
    if (!current || event.pointerId !== current.pointerId) return
    current.clientX = event.clientX
    current.clientY = event.clientY
    if (!current.dragging) {
      if (
        Math.hypot(
          event.clientX - current.startX,
          event.clientY - current.startY,
        ) < DRAG_THRESHOLD
      )
        return
      current.dragging = true
      options.onSelectSources(current.sourceIds, current.sourceIds[0] as NodeId)
      options.onStatus(
        current.sourceIds.length === 1
          ? 'Moving 1 item'
          : `Moving ${current.sourceIds.length} items`,
      )
      setView({
        sourceIds: current.sourceIds,
        sourceIdSet: current.sourceIdSet,
        targetId: null,
        position: null,
        valid: false,
      })
      current.scrollFrame = requestAnimationFrame(scroll)
    }
    event.preventDefault()
    resolveAtPoint(current)
  }

  const onPointerUp = (event: PointerEvent<HTMLElement>): void => {
    const current = session.current
    if (!current || event.pointerId !== current.pointerId) return
    if (!current.dragging) {
      finish(false)
      return
    }
    event.preventDefault()
    suppressCompatibilityClick(current.pointerId)
    if (current.sourceDocument !== optionsRef.current.document) {
      finish(false)
      optionsRef.current.onStatus('Move cancelled because the document changed')
      return
    }
    const resolution = current.drop
    if (!resolution?.ok) {
      const reason = resolution?.reason ?? 'Choose a valid drop location'
      finish(false)
      optionsRef.current.onStatus(reason)
      return
    }
    if (resolution.intent.position === 'inside')
      optionsRef.current.onSetExpanded(resolution.intent.containerId, true)
    const completed = optionsRef.current.onCommit(
      resolution.sourceIds,
      resolution.intent,
    )
    finish(completed)
  }

  const onClickCapture = (event: MouseEvent<HTMLElement>): void => {
    if (!suppressClick.current) return
    suppressClick.current = false
    event.preventDefault()
    event.stopPropagation()
  }

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape' || !session.current?.dragging) return
      event.preventDefault()
      cancelRef.current('Move cancelled', true)
    }
    const onVisibility = (): void => {
      if (globalThis.document.hidden) cancelRef.current()
    }
    window.addEventListener('keydown', onKeyDown)
    const onBlur = (): void => cancelRef.current()
    window.addEventListener('blur', onBlur)
    globalThis.document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('blur', onBlur)
      globalThis.document.removeEventListener('visibilitychange', onVisibility)
      finishRef.current(false)
    }
  }, [])

  useEffect(() => {
    const current = session.current
    if (current && current.sourceDocument !== options.document)
      cancelRef.current('Move cancelled because the document changed')
  }, [options.document])

  return {
    view,
    dragging: view !== null,
    onClickCapture,
    onLostPointerCapture: () => cancel(),
    onPointerCancel: () => cancel(),
    onPointerDown,
    onPointerMove,
    onPointerUp,
  }
}

function targetLabel(document: JsonDocument, id: NodeId): string {
  if (id === document.rootId) return 'the root header'
  const node = document.nodes[id]
  if (node?.type === 'container')
    return node.caption === null || node.caption === ''
      ? 'this header'
      : `header ${node.caption}`
  return 'this value'
}
