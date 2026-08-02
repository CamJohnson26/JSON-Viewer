import type { JsonPrimitive } from '../document/index.ts'
import {
  JSON_OPERATION_VERSION,
  type JsonOperation,
  type OperationDependencies,
  type OperationError,
} from './types.ts'

export const MAX_OPERATION_DEPTH = 256
const MAX_QUERY_DEPTH = 64

export function validateOperationPayload(
  value: unknown,
): OperationError | null {
  if (!record(value)) return invalid('Operation must be an object')
  if (value.version !== JSON_OPERATION_VERSION) {
    return {
      code: 'UnsupportedVersion',
      message: `Unsupported operation version: ${String(value.version)}`,
    }
  }
  if (typeof value.type !== 'string')
    return invalid('Operation type must be a string')
  const enumField = (
    field: string,
    values: readonly string[],
  ): OperationError | null =>
    typeof value[field] === 'string' && values.includes(value[field])
      ? null
      : invalid(`${field} must be one of: ${values.join(', ')}`)
  switch (value.type) {
    case 'structure.move':
      return enumField('direction', ['up', 'down'])
    case 'structure.move-to':
      return validId(value.containerId) && safeIndex(value.index)
        ? null
        : invalid(
            'Move target requires a non-empty containerId and non-negative safe integer index',
          )
    case 'structure.reverse':
    case 'structure.flatten':
    case 'structure.remove-empty':
    case 'structure.remove':
    case 'text.trim':
    case 'text.parse-escaped':
    case 'text.escape':
    case 'primitive.toggle':
    case 'collection.deduplicate':
    case 'data.diff':
      return null
    case 'text.case':
      return enumField('mode', ['upper', 'lower', 'title'])
    case 'caption.case':
      return enumField('mode', ['snake', 'camel', 'words'])
    case 'text.replace':
      return typeof value.find === 'string' &&
        typeof value.replacement === 'string' &&
        optionalBoolean(value.all) &&
        optionalBoolean(value.caseSensitive)
        ? null
        : invalid('Text replacement fields are invalid')
    case 'text.affix':
      return typeof value.value === 'string'
        ? enumField('position', ['prefix', 'suffix'])
        : invalid('Text affix value must be a string')
    case 'primitive.convert':
      return enumField('to', ['string', 'number', 'boolean', 'null'])
    case 'primitive.date-format':
    case 'primitive.number-format':
      return enumField('formatting', ['inherit', 'formatted', 'source'])
    case 'primitive.generate':
      return enumField('value', ['uuid', 'timestamp'])
    case 'primitive.adjust':
      return typeof value.amount === 'number' && Number.isFinite(value.amount)
        ? null
        : invalid('Adjustment amount must be finite')
    case 'collection.sort': {
      const direction = enumField('direction', ['asc', 'desc'])
      if (direction) return direction
      if (!record(value.key)) return invalid('Sort key must be an object')
      if (value.key.by === 'caption' || value.key.by === 'value') return null
      if (value.key.by !== 'path') return invalid('Sort key is invalid')
      return pathError(value.key.path, true, 'Sort path')
    }
    case 'collection.filter':
      return validateQueryPayload(value.query)
    case 'collection.group':
      return pathError(value.path, true, 'Group path')
    case 'collection.reorder':
      return Array.isArray(value.childIds) && value.childIds.every(validId)
        ? null
        : invalid('Reorder childIds must be non-empty node ID strings')
    case 'data.merge':
      return enumField('depth', ['shallow', 'deep'])
    case 'data.extract':
      return enumField('part', ['keys', 'values'])
    case 'data.rename-path':
      if (typeof value.replacement !== 'string')
        return invalid('Rename replacement must be a string')
      return pathError(value.path, false, 'Rename path')
    default:
      return invalid(`Unknown operation type: ${value.type}`)
  }
}

export function validateQueryPayload(
  value: unknown,
  depth = 0,
): OperationError | null {
  if (depth > MAX_QUERY_DEPTH)
    return {
      code: 'ResourceLimit',
      message: 'Query exceeds maximum nesting depth',
    }
  if (!record(value) || typeof value.type !== 'string')
    return invalid('Query must be a discriminated object')
  switch (value.type) {
    case 'all':
      return null
    case 'kind':
      return [
        'string',
        'number',
        'boolean',
        'null',
        'array',
        'object',
      ].includes(String(value.kind))
        ? null
        : invalid('Query kind is invalid')
    case 'compare': {
      if (value.path !== undefined) {
        const error = pathError(value.path, true, 'Comparison path')
        if (error) return error
      }
      return [
        'eq',
        'ne',
        'gt',
        'gte',
        'lt',
        'lte',
        'contains',
        'startsWith',
        'endsWith',
      ].includes(String(value.operator)) && jsonPrimitive(value.value)
        ? null
        : invalid('Comparison query is invalid')
    }
    case 'exists':
      return pathError(value.path, true, 'Exists path')
    case 'not':
      return validateQueryPayload(value.query, depth + 1)
    case 'and':
    case 'or':
      if (!Array.isArray(value.queries))
        return invalid('Compound query requires a query array')
      for (const query of value.queries) {
        const error = validateQueryPayload(query, depth + 1)
        if (error) return error
      }
      return null
    default:
      return invalid(`Unknown query type: ${value.type}`)
  }
}

export function validateDependencies(value: unknown): OperationError | null {
  if (
    !record(value) ||
    typeof value.createId !== 'function' ||
    typeof value.createUuid !== 'function' ||
    typeof value.createTimestamp !== 'function'
  ) {
    return invalid(
      'Operation dependencies must provide ID, UUID, and timestamp factories',
    )
  }
  return null
}

export function asValidatedOperation(value: unknown): JsonOperation {
  return value as JsonOperation
}

export function asValidatedDependencies(value: unknown): OperationDependencies {
  return value as OperationDependencies
}

function validPath(
  value: unknown,
  allowEmpty = true,
): value is readonly string[] {
  return (
    Array.isArray(value) &&
    (allowEmpty || value.length > 0) &&
    value.length <= MAX_OPERATION_DEPTH &&
    value.every((segment) => typeof segment === 'string')
  )
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function pathError(
  value: unknown,
  allowEmpty: boolean,
  name: string,
): OperationError | null {
  if (Array.isArray(value) && value.length > MAX_OPERATION_DEPTH)
    return { code: 'ResourceLimit', message: `${name} exceeds maximum depth` }
  return validPath(value, allowEmpty)
    ? null
    : invalid(`${name} must be an array of string segments`)
}

function safeIndex(value: unknown): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function optionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === 'boolean'
}

function jsonPrimitive(value: unknown): value is JsonPrimitive {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  )
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalid(message: string): OperationError {
  return { code: 'InvalidOperation', message }
}
