import {
  compileCommand,
  type CommandContext,
  type CommandResult,
  type DocumentCommand,
} from '../domain/commands/index.ts'
import type { JsonDocument, NodeId } from '../domain/document/index.ts'
import {
  invertTransaction,
  type DomainEvent,
  type EventTransaction,
} from '../domain/events/index.ts'
import { reduceDocument } from '../domain/reducer/index.ts'

export interface HistoryEntry {
  readonly transaction: EventTransaction
  readonly group?: string
}

export interface ReplayCheckpoint {
  readonly revision: number
  readonly document: JsonDocument
}

export type AppliedEventDirection = 'execute' | 'undo' | 'redo'

export interface AppliedEventLogEntry {
  readonly revision: number
  readonly direction: AppliedEventDirection
  readonly event: DomainEvent
}

export interface DocumentStoreSnapshot {
  readonly present: JsonDocument
  readonly past: readonly HistoryEntry[]
  readonly future: readonly HistoryEntry[]
  readonly revision: number
  readonly eventLog: readonly AppliedEventLogEntry[]
  readonly checkpoints: readonly ReplayCheckpoint[]
  readonly urlSavedRevision: number | null
}

export interface DocumentStoreOptions {
  readonly maxEventLog?: number
  readonly checkpointInterval?: number
  readonly maxCheckpoints?: number
  readonly initialRevision?: number
  readonly urlSavedRevision?: number | null
}

export interface ExecuteOptions {
  readonly group?: string
}

export interface DocumentStore {
  readonly getSnapshot: () => DocumentStoreSnapshot
  readonly subscribe: (listener: () => void) => () => void
  readonly execute: (
    command: DocumentCommand,
    options?: ExecuteOptions,
  ) => CommandResult
  readonly undo: () => boolean
  readonly redo: () => boolean
  readonly closeHistoryGroup: (group?: string) => void
  readonly setUrlSavedRevision: (revision: number | null) => void
  readonly replay: (revision?: number) => JsonDocument
}

export function replayDocumentStoreSnapshot(
  snapshot: DocumentStoreSnapshot,
  revision = snapshot.revision,
): JsonDocument {
  const checkpoint = [...snapshot.checkpoints]
    .reverse()
    .find((candidate) => candidate.revision <= revision)
  if (!checkpoint)
    throw new Error(`Revision ${revision} is not available for replay`)
  let document = checkpoint.document
  let nextRevision = checkpoint.revision
  for (const entry of snapshot.eventLog) {
    if (entry.revision <= checkpoint.revision) continue
    if (entry.revision > revision) break
    if (entry.revision !== nextRevision + 1)
      throw new Error(`Revision ${revision} is not available for replay`)
    document = reduceDocument(document, entry.event)
    nextRevision = entry.revision
  }
  if (nextRevision !== revision)
    throw new Error(`Revision ${revision} is not available for replay`)
  return document
}

export function createDocumentStore(
  initial: JsonDocument,
  context: CommandContext,
  options: DocumentStoreOptions = {},
): DocumentStore {
  const listeners = new Set<() => void>()
  const maxEventLog = Math.max(0, options.maxEventLog ?? 1_000)
  const checkpointInterval = Math.max(0, options.checkpointInterval ?? 100)
  const maxCheckpoints = Math.max(1, options.maxCheckpoints ?? 100)
  const initialRevision = options.initialRevision ?? 0
  let snapshot: DocumentStoreSnapshot = {
    present: initial,
    past: [],
    future: [],
    revision: initialRevision,
    eventLog: [],
    checkpoints: [{ revision: initialRevision, document: initial }],
    urlSavedRevision: options.urlSavedRevision ?? null,
  }
  let openHistoryGroup:
    { readonly group: string; readonly primitiveTarget?: NodeId } | undefined
  let replayBase: ReplayCheckpoint = {
    revision: initialRevision,
    document: initial,
  }

  const publish = (next: DocumentStoreSnapshot): void => {
    snapshot = next
    for (const listener of [...listeners]) {
      try {
        listener()
      } catch {
        // A subscriber cannot prevent other subscribers observing committed state.
      }
    }
  }

  const applyEvents = (
    present: JsonDocument,
    revision: number,
    eventLog: readonly AppliedEventLogEntry[],
    checkpoints: readonly ReplayCheckpoint[],
    events: readonly DomainEvent[],
    direction: AppliedEventDirection,
  ): Pick<
    DocumentStoreSnapshot,
    'present' | 'revision' | 'eventLog' | 'checkpoints'
  > => {
    let nextPresent = present
    let nextRevision = revision
    const nextLog = [...eventLog]
    let nextCheckpoints = [...checkpoints]
    for (const event of events) {
      nextPresent = reduceDocument(nextPresent, event)
      nextRevision++
      nextLog.push({ revision: nextRevision, direction, event })
      while (nextLog.length > maxEventLog) {
        const removed = nextLog.shift()
        if (!removed) break
        replayBase = {
          revision: removed.revision,
          document: reduceDocument(replayBase.document, removed.event),
        }
      }
      if (checkpointInterval > 0 && nextRevision % checkpointInterval === 0) {
        nextCheckpoints.push({ revision: nextRevision, document: nextPresent })
      }
    }
    nextCheckpoints = nextCheckpoints.filter(
      ({ revision: checkpointRevision }) =>
        checkpointRevision >= replayBase.revision &&
        checkpointRevision <= nextRevision,
    )
    const baseIndex = nextCheckpoints.findIndex(
      ({ revision: checkpointRevision }) =>
        checkpointRevision === replayBase.revision,
    )
    if (baseIndex === -1) nextCheckpoints.unshift(replayBase)
    else nextCheckpoints[baseIndex] = replayBase
    if (nextCheckpoints.length > maxCheckpoints) {
      nextCheckpoints =
        maxCheckpoints === 1
          ? [replayBase]
          : [
              replayBase,
              ...nextCheckpoints.slice(-(maxCheckpoints - 1)),
            ].filter(
              (checkpoint, index, values) =>
                index === 0 || checkpoint.revision !== values[0]?.revision,
            )
    }
    return {
      present: nextPresent,
      revision: nextRevision,
      eventLog: nextLog,
      checkpoints: nextCheckpoints,
    }
  }

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    execute: (command, executeOptions = {}) => {
      const result = compileCommand(
        snapshot.present,
        snapshot.revision,
        command,
        context,
      )
      if (!result.ok || result.status === 'noop') return result
      const applied = applyEvents(
        snapshot.present,
        snapshot.revision,
        snapshot.eventLog,
        snapshot.checkpoints,
        result.transaction.events,
        'execute',
      )
      const previous = snapshot.past.at(-1)
      const primitiveTarget =
        command.type === 'primitive.update' ? command.targetId : undefined
      const canGroup =
        executeOptions.group !== undefined && primitiveTarget !== undefined
      const grouped =
        canGroup &&
        openHistoryGroup?.group === executeOptions.group &&
        previous?.group === executeOptions.group &&
        openHistoryGroup.primitiveTarget === primitiveTarget
      const entry: HistoryEntry = grouped
        ? {
            group: executeOptions.group,
            transaction: {
              version: previous.transaction.version,
              events: [
                ...previous.transaction.events,
                ...result.transaction.events,
              ],
            },
          }
        : !canGroup
          ? { transaction: result.transaction }
          : { transaction: result.transaction, group: executeOptions.group }
      publish({
        ...snapshot,
        ...applied,
        past: grouped
          ? [...snapshot.past.slice(0, -1), entry]
          : [...snapshot.past, entry],
        future: [],
      })
      openHistoryGroup = !canGroup
        ? undefined
        : { group: executeOptions.group, primitiveTarget }
      return result
    },
    undo: () => {
      const entry = snapshot.past.at(-1)
      if (!entry) return false
      openHistoryGroup = undefined
      const inverse = invertTransaction(entry.transaction)
      const applied = applyEvents(
        snapshot.present,
        snapshot.revision,
        snapshot.eventLog,
        snapshot.checkpoints,
        inverse.events,
        'undo',
      )
      publish({
        ...snapshot,
        ...applied,
        past: snapshot.past.slice(0, -1),
        future: [...snapshot.future, entry],
      })
      return true
    },
    redo: () => {
      const entry = snapshot.future.at(-1)
      if (!entry) return false
      openHistoryGroup = undefined
      const applied = applyEvents(
        snapshot.present,
        snapshot.revision,
        snapshot.eventLog,
        snapshot.checkpoints,
        entry.transaction.events,
        'redo',
      )
      publish({
        ...snapshot,
        ...applied,
        past: [...snapshot.past, entry],
        future: snapshot.future.slice(0, -1),
      })
      return true
    },
    closeHistoryGroup: (group) => {
      if (group === undefined || group === openHistoryGroup?.group) {
        openHistoryGroup = undefined
      }
    },
    setUrlSavedRevision: (revision) => {
      if (snapshot.urlSavedRevision === revision) return
      publish({ ...snapshot, urlSavedRevision: revision })
    },
    replay: (revision) => replayDocumentStoreSnapshot(snapshot, revision),
  }
}
