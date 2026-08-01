import type {
  FormattingOverride,
  JsonPrimitive,
  NodeId,
  PrimitiveKind,
  PrimitiveNode,
} from './model.ts'

export const PRIMITIVE_INFERENCE_VERSION = 1 as const

export interface PrimitiveDetection {
  readonly version: typeof PRIMITIVE_INFERENCE_VERSION
  readonly kind: PrimitiveKind
  readonly value: JsonPrimitive
  readonly sourceInput: string
}

const JSON_NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const DATETIME =
  /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/

function isDate(source: string): boolean {
  const match = DATE.exec(source)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

export function detectPrimitive(sourceInput: string): PrimitiveDetection {
  if (sourceInput === 'null') return detection('null', null, sourceInput)
  if (sourceInput === 'true') return detection('boolean', true, sourceInput)
  if (sourceInput === 'false') return detection('boolean', false, sourceInput)
  if (JSON_NUMBER.test(sourceInput)) {
    const value = Number(sourceInput)
    if (Number.isFinite(value)) return detection('number', value, sourceInput)
  }
  if (isDate(sourceInput)) return detection('date', sourceInput, sourceInput)
  const datetime = DATETIME.exec(sourceInput)
  if (
    datetime &&
    isDate(datetime[1] as string) &&
    Number(datetime[2]) <= 23 &&
    Number(datetime[3]) <= 59 &&
    Number(datetime[4]) <= 59 &&
    Number(datetime[5] ?? 0) <= 23 &&
    Number(datetime[6] ?? 0) <= 59 &&
    !Number.isNaN(Date.parse(sourceInput))
  ) {
    return detection('datetime', sourceInput, sourceInput)
  }
  return detection('string', sourceInput, sourceInput)
}

function detection(
  kind: PrimitiveKind,
  value: JsonPrimitive,
  sourceInput: string,
): PrimitiveDetection {
  return { version: PRIMITIVE_INFERENCE_VERSION, kind, value, sourceInput }
}

export function createPrimitive(
  id: NodeId,
  sourceInput: string,
  formatting: FormattingOverride = 'inherit',
): PrimitiveNode {
  const detected = detectPrimitive(sourceInput)
  return {
    id,
    type: 'primitive',
    sourceInput,
    value: detected.value,
    detectedKind: detected.kind,
    formatting,
  }
}

export function createImportedPrimitive(
  id: NodeId,
  sourceInput: string,
  value: JsonPrimitive,
): PrimitiveNode {
  const detectedKind =
    typeof value === 'string'
      ? detectPrimitive(value).kind
      : value === null
        ? 'null'
        : (typeof value as 'number' | 'boolean')
  return {
    id,
    type: 'primitive',
    sourceInput,
    value,
    detectedKind,
    formatting: 'inherit',
  }
}

export interface FormattingOptions {
  readonly enabled: boolean
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

export function formatPrimitive(
  node: PrimitiveNode,
  options: FormattingOptions,
): string {
  const formatted =
    node.formatting === 'formatted' ||
    (node.formatting === 'inherit' && options.enabled)
  if (!formatted) return node.sourceInput
  const displayValue = detectPrimitive(node.sourceInput).value

  switch (node.detectedKind) {
    case 'null':
      return 'NULL'
    case 'boolean':
      return displayValue ? 'TRUE' : 'FALSE'
    case 'number':
      return groupNumber(displayValue as number)
    case 'date':
      return formatDate(new Date(`${node.value as string}T00:00:00Z`), false)
    case 'datetime':
      return formatDate(new Date(node.value as string), true)
    case 'string':
      return node.value as string
  }
}

function groupNumber(value: number): string {
  const [integer = '', fraction] = String(value).split('.')
  const sign = integer.startsWith('-') ? '-' : ''
  const digits = sign ? integer.slice(1) : integer
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${sign}${grouped}${fraction === undefined ? '' : `.${fraction}`}`
}

function formatDate(date: Date, includeTime: boolean): string {
  const datePart = `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`
  if (!includeTime) return datePart
  const hours = String(date.getUTCHours()).padStart(2, '0')
  const minutes = String(date.getUTCMinutes()).padStart(2, '0')
  const seconds = String(date.getUTCSeconds()).padStart(2, '0')
  return `${datePart}, ${hours}:${minutes}:${seconds} UTC`
}
