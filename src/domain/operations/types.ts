import type {
  FormattingOverride,
  JsonDocument,
  JsonPrimitive,
  NodeId,
  NodeIdFactory,
} from '../document/index.ts'

export const JSON_OPERATION_VERSION = 1 as const

interface OperationBase {
  readonly version: typeof JSON_OPERATION_VERSION
}

export type SortKey =
  | { readonly by: 'caption' }
  | { readonly by: 'value' }
  | { readonly by: 'path'; readonly path: readonly string[] }

export type JsonQuery =
  | { readonly type: 'all' }
  | {
      readonly type: 'kind'
      readonly kind:
        'string' | 'number' | 'boolean' | 'null' | 'array' | 'object'
    }
  | {
      readonly type: 'compare'
      readonly path?: readonly string[]
      readonly operator:
        | 'eq'
        | 'ne'
        | 'gt'
        | 'gte'
        | 'lt'
        | 'lte'
        | 'contains'
        | 'startsWith'
        | 'endsWith'
      readonly value: JsonPrimitive
    }
  | { readonly type: 'exists'; readonly path: readonly string[] }
  | { readonly type: 'not'; readonly query: JsonQuery }
  | { readonly type: 'and' | 'or'; readonly queries: readonly JsonQuery[] }

export type JsonOperation =
  | (OperationBase & {
      readonly type: 'structure.move'
      readonly direction: 'up' | 'down'
    })
  | (OperationBase & {
      readonly type: 'structure.move-to'
      readonly containerId: NodeId
      readonly index: number
    })
  | (OperationBase & { readonly type: 'structure.reverse' })
  | (OperationBase & { readonly type: 'structure.flatten' })
  | (OperationBase & { readonly type: 'structure.remove-empty' })
  | (OperationBase & { readonly type: 'structure.remove' })
  | (OperationBase & {
      readonly type: 'caption.case'
      readonly mode: 'snake' | 'camel' | 'words'
    })
  | (OperationBase & {
      readonly type: 'text.case'
      readonly mode: 'upper' | 'lower' | 'title'
    })
  | (OperationBase & { readonly type: 'text.trim' })
  | (OperationBase & {
      readonly type: 'text.replace'
      readonly find: string
      readonly replacement: string
      readonly all?: boolean
      readonly caseSensitive?: boolean
    })
  | (OperationBase & {
      readonly type: 'text.affix'
      readonly position: 'prefix' | 'suffix'
      readonly value: string
    })
  | (OperationBase & { readonly type: 'text.parse-escaped' | 'text.escape' })
  | (OperationBase & {
      readonly type: 'primitive.convert'
      readonly to: 'string' | 'number' | 'boolean' | 'null'
    })
  | (OperationBase & {
      readonly type: 'primitive.date-format'
      readonly formatting: FormattingOverride
    })
  | (OperationBase & {
      readonly type: 'primitive.number-format'
      readonly formatting: FormattingOverride
    })
  | (OperationBase & {
      readonly type: 'primitive.generate'
      readonly value: 'uuid' | 'timestamp'
    })
  | (OperationBase & { readonly type: 'primitive.toggle' })
  | (OperationBase & {
      readonly type: 'primitive.adjust'
      readonly amount: number
    })
  | (OperationBase & {
      readonly type: 'collection.sort'
      readonly key: SortKey
      readonly direction: 'asc' | 'desc'
    })
  | (OperationBase & {
      readonly type: 'collection.filter'
      readonly query: JsonQuery
    })
  | (OperationBase & { readonly type: 'collection.deduplicate' })
  | (OperationBase & {
      readonly type: 'collection.group'
      readonly path: readonly string[]
    })
  | (OperationBase & {
      readonly type: 'collection.reorder'
      readonly childIds: readonly NodeId[]
    })
  | (OperationBase & {
      readonly type: 'data.merge'
      readonly depth: 'shallow' | 'deep'
    })
  | (OperationBase & { readonly type: 'data.diff' })
  | (OperationBase & {
      readonly type: 'data.extract'
      readonly part: 'keys' | 'values'
    })
  | (OperationBase & {
      readonly type: 'data.rename-path'
      readonly path: readonly string[]
      readonly replacement: string
    })

export type JsonOperationInput = JsonOperation extends infer Operation
  ? Operation extends { readonly version: typeof JSON_OPERATION_VERSION }
    ? Omit<Operation, 'version'>
    : never
  : never

export type OperationErrorCode =
  | 'UnsupportedVersion'
  | 'InvalidOperation'
  | 'EmptySelection'
  | 'UnknownSelection'
  | 'OverlappingSelection'
  | 'InvalidTarget'
  | 'IncompatibleSelection'
  | 'DuplicateCaption'
  | 'Cycle'
  | 'IdCollision'
  | 'InvalidEscape'
  | 'InvalidConversion'
  | 'InvalidPath'
  | 'ResourceLimit'
  | 'InvariantViolation'

export interface OperationError {
  readonly code: OperationErrorCode
  readonly message: string
  readonly nodeId?: NodeId
}

export interface OperationSummary {
  readonly type: JsonOperation['type']
  readonly affectedIds: readonly NodeId[]
  readonly generatedIds: readonly NodeId[]
}

export type OperationResult =
  | {
      readonly ok: true
      readonly document: JsonDocument
      readonly selectedIds: readonly NodeId[]
      readonly summary: OperationSummary
    }
  | { readonly ok: false; readonly error: OperationError }

export interface OperationDependencies {
  readonly createId: NodeIdFactory
  readonly createUuid: () => string
  readonly createTimestamp: () => string
}

export interface FindMatchingOptions {
  /** Continue below a matching container. The safe default returns non-overlapping roots. */
  readonly includeDescendantsOfMatches?: boolean
}

export interface OperationDescriptor {
  readonly id: string
  readonly label: string
  readonly implementation: 'operation' | 'command'
}
