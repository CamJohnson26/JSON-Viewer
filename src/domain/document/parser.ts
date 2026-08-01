import type { JsonValue } from './materialize.ts'
import {
  type ContainerKind,
  type ContainerNode,
  type DocumentNode,
  type JsonDocument,
  type NodeId,
  type NodeIdFactory,
} from './model.ts'
import { createNodeTable } from './node-table.ts'
import { createImportedPrimitive } from './primitive.ts'

export interface ParseGuards {
  readonly maxInputLength: number
  readonly maxDepth: number
  readonly maxNodes: number
  readonly maxStringLength: number
}

export const DEFAULT_PARSE_GUARDS: ParseGuards = {
  maxInputLength: 10_000_000,
  maxDepth: 256,
  maxNodes: 1_000_000,
  maxStringLength: 1_000_000,
}

export type ParseErrorCode =
  | 'Syntax'
  | 'DuplicateKey'
  | 'CommentsNotAllowed'
  | 'TrailingComma'
  | 'ResourceLimit'

export interface ParseError {
  readonly code: ParseErrorCode
  readonly message: string
  readonly index: number
  readonly line: number
  readonly column: number
}

export type ParseResult =
  | { readonly ok: true; readonly document: JsonDocument }
  | { readonly ok: false; readonly error: ParseError }

interface ParsedValue {
  readonly value: JsonValue
  readonly source?: string
  readonly properties?: readonly {
    readonly key: string
    readonly value: ParsedValue
  }[]
  readonly items?: readonly ParsedValue[]
}

export function parseJson(
  input: string,
  options: Partial<ParseGuards>,
  createId: NodeIdFactory,
): ParseResult {
  const guards = { ...DEFAULT_PARSE_GUARDS, ...options }
  if (input.length > guards.maxInputLength) {
    return failure(input, 'ResourceLimit', 'Input exceeds maxInputLength', 0)
  }
  try {
    const parser = new StrictParser(input, guards)
    const parsed = parser.parse()
    const builder = new DocumentBuilder(createId, guards.maxNodes)
    return { ok: true, document: builder.build(parsed) }
  } catch (error) {
    if (error instanceof ParserFailure) {
      return failure(input, error.code, error.message, error.index)
    }
    throw error
  }
}

class StrictParser {
  private index = 0
  private valueCount = 0

  constructor(
    private readonly input: string,
    private readonly guards: ParseGuards,
  ) {}

  parse(): ParsedValue {
    this.skipWhitespace()
    const value = this.value(0)
    this.skipWhitespace()
    if (this.index !== this.input.length)
      this.fail('Syntax', 'Unexpected content')
    return value
  }

  private value(depth: number): ParsedValue {
    if (depth > this.guards.maxDepth)
      this.fail('ResourceLimit', 'Input exceeds maxDepth')
    this.skipWhitespace()
    this.valueCount++
    if (this.valueCount > this.guards.maxNodes)
      this.fail('ResourceLimit', 'Input exceeds maxNodes')
    const start = this.index
    const char = this.input[this.index]
    if (char === '{') return this.object(depth)
    if (char === '[') return this.array(depth)
    if (char === '"') {
      const value = this.string()
      return { value, source: this.input.slice(start, this.index) }
    }
    if (char === 't') return this.literal('true', true, start)
    if (char === 'f') return this.literal('false', false, start)
    if (char === 'n') return this.literal('null', null, start)
    if (char === '-' || (char !== undefined && char >= '0' && char <= '9')) {
      return this.number(start)
    }
    if (
      char === '/' &&
      (this.input[this.index + 1] === '/' || this.input[this.index + 1] === '*')
    ) {
      this.fail('CommentsNotAllowed', 'Comments are not valid JSON')
    }
    this.fail('Syntax', 'Expected a JSON value')
  }

  private object(depth: number): ParsedValue {
    this.index++
    const properties: { key: string; value: ParsedValue }[] = []
    const keys = new Set<string>()
    this.skipWhitespace()
    if (this.consume('}'))
      return {
        value: {},
        properties,
      }
    while (true) {
      this.skipWhitespace()
      if (this.input[this.index] !== '"')
        this.fail('Syntax', 'Expected an object key')
      const keyIndex = this.index
      const key = this.string()
      if (keys.has(key))
        this.fail('DuplicateKey', `Duplicate object key: ${key}`, keyIndex)
      keys.add(key)
      this.skipWhitespace()
      if (!this.consume(':'))
        this.fail('Syntax', 'Expected a colon after object key')
      const value = this.value(depth + 1)
      properties.push({ key, value })
      this.skipWhitespace()
      if (this.consume('}')) break
      if (!this.consume(','))
        this.fail('Syntax', 'Expected a comma or closing brace')
      this.skipWhitespace()
      if (this.input[this.index] === '}')
        this.fail('TrailingComma', 'Trailing commas are not valid JSON')
    }
    const value: { [key: string]: JsonValue } = {}
    for (const property of properties) {
      Object.defineProperty(value, property.key, {
        value: property.value.value,
        enumerable: true,
        configurable: true,
        writable: true,
      })
    }
    return { value, properties }
  }

  private array(depth: number): ParsedValue {
    this.index++
    const items: ParsedValue[] = []
    this.skipWhitespace()
    if (this.consume(']')) return { value: [], items }
    while (true) {
      items.push(this.value(depth + 1))
      this.skipWhitespace()
      if (this.consume(']')) break
      if (!this.consume(','))
        this.fail('Syntax', 'Expected a comma or closing bracket')
      this.skipWhitespace()
      if (this.input[this.index] === ']')
        this.fail('TrailingComma', 'Trailing commas are not valid JSON')
    }
    return {
      value: items.map((item) => item.value),
      items,
    }
  }

  private string(): string {
    this.index++
    let result = ''
    while (this.index < this.input.length) {
      const char = this.input[this.index++] as string
      if (char === '"') {
        if (result.length > this.guards.maxStringLength)
          this.fail('ResourceLimit', 'String exceeds maxStringLength')
        return result
      }
      if (char === '\\') {
        const escape = this.input[this.index++]
        const simple: Record<string, string> = {
          '"': '"',
          '\\': '\\',
          '/': '/',
          b: '\b',
          f: '\f',
          n: '\n',
          r: '\r',
          t: '\t',
        }
        if (escape === 'u') {
          const hex = this.input.slice(this.index, this.index + 4)
          if (!/^[0-9a-fA-F]{4}$/.test(hex))
            this.fail('Syntax', 'Invalid Unicode escape')
          result += String.fromCharCode(Number.parseInt(hex, 16))
          this.index += 4
        } else if (escape !== undefined && simple[escape] !== undefined) {
          result += simple[escape]
        } else {
          this.fail('Syntax', 'Invalid string escape')
        }
      } else {
        if (char.charCodeAt(0) <= 0x1f)
          this.fail('Syntax', 'Unescaped control character in string')
        result += char
      }
      if (result.length > this.guards.maxStringLength)
        this.fail('ResourceLimit', 'String exceeds maxStringLength')
    }
    this.fail('Syntax', 'Unterminated string')
  }

  private number(start: number): ParsedValue {
    const rest = this.input.slice(this.index)
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(rest)
    if (!match) this.fail('Syntax', 'Invalid number')
    this.index += match[0].length
    const next = this.input[this.index]
    if (next !== undefined && !/[\s,\]}]/.test(next))
      this.fail('Syntax', 'Invalid number')
    const value = Number(match[0])
    if (!Number.isFinite(value))
      this.fail(
        'ResourceLimit',
        'Number is outside the finite JSON range',
        start,
      )
    return { value, source: match[0] }
  }

  private literal(
    text: string,
    value: boolean | null,
    start: number,
  ): ParsedValue {
    if (this.input.slice(this.index, this.index + text.length) !== text) {
      this.fail('Syntax', `Expected ${text}`)
    }
    this.index += text.length
    return { value, source: this.input.slice(start, this.index) }
  }

  private skipWhitespace(): void {
    while (
      /\s/.test(this.input[this.index] ?? '') &&
      /[\t\n\r ]/.test(this.input[this.index] ?? '')
    ) {
      this.index++
    }
    if (
      this.input[this.index] === '/' &&
      (this.input[this.index + 1] === '/' || this.input[this.index + 1] === '*')
    ) {
      this.fail('CommentsNotAllowed', 'Comments are not valid JSON')
    }
  }

  private consume(char: string): boolean {
    if (this.input[this.index] !== char) return false
    this.index++
    return true
  }

  private fail(
    code: ParseErrorCode,
    message: string,
    index = this.index,
  ): never {
    throw new ParserFailure(code, message, index)
  }
}

class DocumentBuilder {
  private readonly nodes: Record<NodeId, DocumentNode> = Object.create(
    null,
  ) as Record<NodeId, DocumentNode>
  private count = 0
  private readonly allocatedIds = new Set<NodeId>()

  constructor(
    private readonly createId: NodeIdFactory,
    private readonly maxNodes: number,
  ) {}

  build(parsed: ParsedValue): JsonDocument {
    const rootId = this.addValue(parsed, null, true)
    const root = this.nodes[rootId]
    if (root?.type === 'primitive') {
      const wrapperId = this.id()
      this.nodes[wrapperId] = container(
        wrapperId,
        null,
        'scalar',
        [rootId],
        [],
        'imported',
      )
      return { rootId: wrapperId, nodes: createNodeTable(this.nodes) }
    }
    return { rootId, nodes: createNodeTable(this.nodes) }
  }

  private addValue(
    parsed: ParsedValue,
    caption: string | null,
    isRoot = false,
  ): NodeId {
    if (parsed.items) return this.addCollection('array', parsed.items, caption)
    if (parsed.properties) return this.addObject(parsed.properties, caption)
    const primitiveId = this.id()
    const sourceInput =
      typeof parsed.value === 'string'
        ? parsed.value
        : (parsed.source as string)
    this.nodes[primitiveId] = createImportedPrimitive(
      primitiveId,
      sourceInput,
      parsed.value as string | number | boolean | null,
    )
    if (caption === null || isRoot) return primitiveId
    const headerId = this.id()
    this.nodes[headerId] = container(
      headerId,
      caption,
      'array',
      [primitiveId],
      [],
      'inferred',
    )
    return headerId
  }

  private addCollection(
    kind: ContainerKind,
    items: readonly ParsedValue[],
    caption: string | null,
  ): NodeId {
    const id = this.id()
    const children = items.map((item) => this.addValue(item, null))
    this.nodes[id] = container(id, caption, kind, children, [], 'imported')
    return id
  }

  private addObject(
    properties: readonly {
      readonly key: string
      readonly value: ParsedValue
    }[],
    caption: string | null,
  ): NodeId {
    const id = this.id()
    const children = properties.map((property) =>
      this.addValue(property.value, property.key),
    )
    const entries = properties.map((property, index) => ({
      key: property.key,
      nodeId: children[index] as NodeId,
    }))
    this.nodes[id] = container(
      id,
      caption,
      'object',
      children,
      entries,
      'imported',
    )
    return id
  }

  private id(): NodeId {
    this.count++
    if (this.count > this.maxNodes)
      throw new ParserFailure('ResourceLimit', 'Input exceeds maxNodes', 0)
    const id = this.createId()
    if (this.allocatedIds.has(id))
      throw new ParserFailure(
        'ResourceLimit',
        'ID factory produced a duplicate ID',
        0,
      )
    this.allocatedIds.add(id)
    return id
  }
}

function container(
  id: NodeId,
  caption: string | null,
  kind: ContainerKind,
  childIds: readonly NodeId[],
  entries: ContainerNode['entries'],
  kindOrigin: ContainerNode['kindOrigin'],
): ContainerNode {
  return { id, type: 'container', caption, kind, kindOrigin, childIds, entries }
}

class ParserFailure extends Error {
  constructor(
    readonly code: ParseErrorCode,
    message: string,
    readonly index: number,
  ) {
    super(message)
  }
}

function failure(
  input: string,
  code: ParseErrorCode,
  message: string,
  index: number,
): ParseResult {
  const before = input.slice(0, index)
  const lines = before.split('\n')
  return {
    ok: false,
    error: {
      code,
      message,
      index,
      line: lines.length,
      column: (lines.at(-1)?.length ?? 0) + 1,
    },
  }
}
