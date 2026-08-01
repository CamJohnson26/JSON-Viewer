import {
  buildParentLookup,
  createPrimitive,
  getContainer,
  inferContainer,
  parseJson,
  patchNodeTable,
  pasteBeside,
  pasteInto,
  unwrapHeader,
  wrapNode,
  type ContainerNode,
  type DocumentNode,
  type JsonDocument,
  type NodeId,
  type NodeIdFactory,
  type ParseError,
  type TransitionResult,
} from '../document/index.ts'
import {
  DOMAIN_EVENT_VERSION,
  createPatchEvent,
  type EventMetadata,
  type EventTransaction,
  type NodeRecordPatch,
} from '../events/index.ts'

export const COMMAND_VERSION = 1 as const

interface CommandBase {
  readonly version: typeof COMMAND_VERSION
  readonly expectedRevision: number
}

export type DocumentCommand =
  | (CommandBase & {
      readonly type: 'primitive.add'
      readonly parentId: NodeId
      readonly sourceInput: string
    })
  | (CommandBase & {
      readonly type: 'header.add'
      readonly parentId: NodeId
      readonly caption: string | null
    })
  | (CommandBase & {
      readonly type: 'primitive.update'
      readonly targetId: NodeId
      readonly sourceInput: string
    })
  | (CommandBase & {
      readonly type: 'header.rename'
      readonly targetId: NodeId
      readonly caption: string | null
    })
  | (CommandBase & {
      readonly type: 'subtree.remove'
      readonly targetId: NodeId
    })
  | (CommandBase & {
      readonly type: 'node.wrap'
      readonly targetId: NodeId
      readonly caption: string
    })
  | (CommandBase & {
      readonly type: 'header.unwrap'
      readonly targetId: NodeId
    })
  | (CommandBase & { readonly type: 'json.replace'; readonly source: string })
  | (CommandBase & {
      readonly type: 'json.pasteInto'
      readonly targetId: NodeId
      readonly source: string
    })
  | (CommandBase & {
      readonly type: 'json.pasteBeside'
      readonly targetId: NodeId
      readonly source: string
    })

export type CommandFailureCode =
  | 'UnsupportedVersion'
  | 'InvalidPayload'
  | 'RevisionMismatch'
  | 'UnknownTarget'
  | 'InvalidTarget'
  | 'DuplicateCaption'
  | 'Cycle'
  | 'NothingToInsert'
  | 'IdCollision'
  | 'InvalidJson'

export interface CommandFailure {
  readonly code: CommandFailureCode
  readonly message: string
  readonly parseError?: ParseError
}

export type CommandResult =
  | {
      readonly ok: true
      readonly status: 'applied'
      readonly transaction: EventTransaction
    }
  | { readonly ok: true; readonly status: 'noop'; readonly transaction: null }
  | { readonly ok: false; readonly error: CommandFailure }

export interface CommandContext {
  readonly createId: NodeIdFactory
  readonly createEventMetadata: () => EventMetadata
}

export function compileCommand(
  document: JsonDocument,
  revision: number,
  command: DocumentCommand,
  context: CommandContext,
): CommandResult {
  if (command.version !== COMMAND_VERSION) {
    return failure('UnsupportedVersion', 'Unsupported command version')
  }
  if (
    !Number.isSafeInteger(command.expectedRevision) ||
    command.expectedRevision < 0
  ) {
    return failure('InvalidPayload', 'Expected revision must be non-negative')
  }
  if (command.expectedRevision !== revision) {
    return failure(
      'RevisionMismatch',
      `Expected revision ${command.expectedRevision}, received ${revision}`,
    )
  }

  switch (command.type) {
    case 'primitive.update':
      return updatePrimitive(document, command, context)
    case 'primitive.add': {
      if (
        !validNodeId(command.parentId) ||
        typeof command.sourceInput !== 'string'
      ) {
        return failure('InvalidPayload', 'Primitive add payload is invalid')
      }
      const target = document.nodes[command.parentId]
      if (!target)
        return failure('UnknownTarget', `Unknown parent: ${command.parentId}`)
      if (target.type !== 'container')
        return failure('InvalidTarget', 'Children require a container target')
      const added = createPrimitive(context.createId(), command.sourceInput)
      return addNode(document, target, added, context)
    }
    case 'header.add': {
      if (!validNodeId(command.parentId) || !validCaption(command.caption)) {
        return failure('InvalidPayload', 'Header add payload is invalid')
      }
      const target = document.nodes[command.parentId]
      if (!target)
        return failure('UnknownTarget', `Unknown parent: ${command.parentId}`)
      if (target.type !== 'container')
        return failure('InvalidTarget', 'Children require a container target')
      const added = emptyHeader(context.createId(), command.caption)
      return addNode(document, target, added, context)
    }
    case 'header.rename':
      if (!validNodeId(command.targetId) || !validCaption(command.caption))
        return failure('InvalidPayload', 'Header rename payload is invalid')
      return renameHeader(document, command.targetId, command.caption, context)
    case 'subtree.remove':
      if (!validNodeId(command.targetId))
        return failure('InvalidPayload', 'Remove payload is invalid')
      return removeSubtree(document, command.targetId, context)
    case 'node.wrap': {
      if (
        !validNodeId(command.targetId) ||
        typeof command.caption !== 'string'
      ) {
        return failure('InvalidPayload', 'Wrap payload is invalid')
      }
      const target = document.nodes[command.targetId]
      if (!target)
        return failure('UnknownTarget', `Unknown target: ${command.targetId}`)
      return transitionResult(
        document,
        wrapNode(
          document,
          command.targetId,
          emptyHeader(context.createId(), command.caption),
        ),
        context,
      )
    }
    case 'header.unwrap':
      if (!validNodeId(command.targetId))
        return failure('InvalidPayload', 'Unwrap payload is invalid')
      return transitionResult(
        document,
        unwrapHeader(document, command.targetId),
        context,
      )
    case 'json.replace': {
      if (typeof command.source !== 'string')
        return failure('InvalidPayload', 'JSON source must be a string')
      const parsed = parseJson(command.source, {}, context.createId)
      if (!parsed.ok) return parseFailure(parsed.error)
      return applied(document, parsed.document, context)
    }
    case 'json.pasteInto':
    case 'json.pasteBeside': {
      if (
        !validNodeId(command.targetId) ||
        typeof command.source !== 'string'
      ) {
        return failure('InvalidPayload', 'JSON paste payload is invalid')
      }
      if (!document.nodes[command.targetId])
        return failure('UnknownTarget', `Unknown target: ${command.targetId}`)
      const parsed = parseJson(command.source, {}, context.createId)
      if (!parsed.ok) return parseFailure(parsed.error)
      const result =
        command.type === 'json.pasteInto'
          ? pasteInto(document, command.targetId, parsed.document)
          : pasteBeside(document, command.targetId, parsed.document)
      return transitionResult(document, result, context)
    }
    default:
      return failure('InvalidTarget', 'Unsupported command type')
  }
}

function updatePrimitive(
  document: JsonDocument,
  command: Extract<DocumentCommand, { type: 'primitive.update' }>,
  context: CommandContext,
): CommandResult {
  if (
    !validNodeId(command.targetId) ||
    typeof command.sourceInput !== 'string'
  ) {
    return failure('InvalidPayload', 'Primitive update payload is invalid')
  }
  const target = document.nodes[command.targetId]
  if (!target)
    return failure('UnknownTarget', `Unknown target: ${command.targetId}`)
  if (target.type !== 'primitive')
    return failure(
      'InvalidTarget',
      'Primitive update requires a primitive target',
    )
  if (target.sourceInput === command.sourceInput) return noop()
  const after = createPrimitive(
    target.id,
    command.sourceInput,
    target.formatting,
  )
  return eventResult({
    version: DOMAIN_EVENT_VERSION,
    type: 'document.patch',
    metadata: context.createEventMetadata(),
    rootId: { before: document.rootId, after: document.rootId },
    records: [{ id: target.id, before: target, after }],
  })
}

function addNode(
  document: JsonDocument,
  parent: ContainerNode,
  added: DocumentNode,
  context: CommandContext,
): CommandResult {
  if (document.nodes[added.id])
    return failure('IdCollision', `Node ID already exists: ${added.id}`)
  const draftParent = {
    ...parent,
    childIds: [...parent.childIds, added.id],
  }
  const draft: JsonDocument = {
    rootId: document.rootId,
    nodes: patchNodeTable(document.nodes, [
      { id: parent.id, after: draftParent },
      { id: added.id, after: added },
    ]),
  }
  const inferred = inferContainer(draft, draftParent)
  if ('code' in inferred)
    return inferenceFailure(inferred.code, inferred.message)
  const records: readonly NodeRecordPatch[] = [
    { id: parent.id, before: parent, after: inferred },
    { id: added.id, before: null, after: added },
  ]
  return eventResult({
    version: DOMAIN_EVENT_VERSION,
    type: 'document.patch',
    metadata: context.createEventMetadata(),
    rootId: { before: document.rootId, after: document.rootId },
    records,
  })
}

function renameHeader(
  document: JsonDocument,
  targetId: NodeId,
  caption: string | null,
  context: CommandContext,
): CommandResult {
  const target = document.nodes[targetId]
  if (!target) return failure('UnknownTarget', `Unknown target: ${targetId}`)
  if (target.type !== 'container' || targetId === document.rootId)
    return failure('InvalidTarget', 'Rename requires a non-root header')
  if (target.caption === caption) return noop()
  const parent = buildParentLookup(document).get(targetId)
  if (!parent) return failure('InvalidTarget', 'Header has no parent')
  const renamed = { ...target, caption }
  const draft: JsonDocument = {
    ...document,
    nodes: { ...document.nodes, [targetId]: renamed },
  }
  const parentNode = getContainer(draft, parent.parentId)
  const inferred = inferContainer(draft, parentNode)
  if ('code' in inferred)
    return inferenceFailure(inferred.code, inferred.message)
  const next = {
    ...draft,
    nodes: { ...draft.nodes, [parent.parentId]: inferred },
  }
  return applied(document, next, context)
}

function removeSubtree(
  document: JsonDocument,
  targetId: NodeId,
  context: CommandContext,
): CommandResult {
  const target = document.nodes[targetId]
  if (!target) return failure('UnknownTarget', `Unknown target: ${targetId}`)
  if (targetId === document.rootId)
    return failure('InvalidTarget', 'The document root cannot be removed')
  const location = buildParentLookup(document).get(targetId)
  if (!location) return failure('InvalidTarget', 'Target has no parent')
  const removed = new Set<NodeId>()
  const visit = (id: NodeId): void => {
    removed.add(id)
    const node = document.nodes[id]
    if (node?.type === 'container') node.childIds.forEach(visit)
  }
  visit(targetId)
  const parent = getContainer(document, location.parentId)
  const nodes = { ...document.nodes }
  for (const id of removed) delete nodes[id]
  const childIds = parent.childIds.filter((id) => id !== targetId)
  const draft: JsonDocument = {
    rootId: document.rootId,
    nodes: { ...nodes, [parent.id]: { ...parent, childIds } },
  }
  const inferred = inferContainer(draft, getContainer(draft, parent.id))
  if ('code' in inferred)
    return inferenceFailure(inferred.code, inferred.message)
  return applied(
    document,
    { ...draft, nodes: { ...draft.nodes, [parent.id]: inferred } },
    context,
  )
}

function transitionResult(
  before: JsonDocument,
  result: TransitionResult,
  context: CommandContext,
): CommandResult {
  if (!result.ok)
    return inferenceFailure(result.error.code, result.error.message)
  return applied(before, result.document, context)
}

function applied(
  before: JsonDocument,
  after: JsonDocument,
  context: CommandContext,
): CommandResult {
  const event = createPatchEvent(before, after, context.createEventMetadata())
  if (event.records.length === 0 && event.rootId.before === event.rootId.after)
    return noop()
  return eventResult(event)
}

function eventResult(event: EventTransaction['events'][number]): CommandResult {
  return {
    ok: true,
    status: 'applied',
    transaction: { version: DOMAIN_EVENT_VERSION, events: [event] },
  }
}

function emptyHeader(id: NodeId, caption: string | null): ContainerNode {
  return {
    id,
    type: 'container',
    caption,
    kind: 'neutral',
    kindOrigin: 'neutral',
    childIds: [],
    entries: [],
  }
}

function noop(): CommandResult {
  return { ok: true, status: 'noop', transaction: null }
}

function parseFailure(error: ParseError): CommandResult {
  return {
    ok: false,
    error: { code: 'InvalidJson', message: error.message, parseError: error },
  }
}

function inferenceFailure(code: string, message: string): CommandResult {
  const mapped: CommandFailureCode =
    code === 'UnknownNode'
      ? 'UnknownTarget'
      : code === 'DuplicateCaption'
        ? 'DuplicateCaption'
        : code === 'NothingToInsert'
          ? 'NothingToInsert'
          : code === 'IdCollision'
            ? 'IdCollision'
            : code === 'Cycle'
              ? 'Cycle'
              : 'InvalidTarget'
  return failure(mapped, message)
}

function failure(code: CommandFailureCode, message: string): CommandResult {
  return { ok: false, error: { code, message } }
}

function validNodeId(value: NodeId): boolean {
  return typeof value === 'string' && value.length > 0
}

function validCaption(value: string | null): boolean {
  return value === null || typeof value === 'string'
}
