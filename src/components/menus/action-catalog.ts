import {
  JSON_OPERATION_CATALOG,
  type JsonOperationInput,
} from '../../domain/operations/index.ts'

export type EditorActionKind =
  'command' | 'operation' | 'clipboard' | 'navigation'

export interface ActionField {
  readonly name: string
  readonly label: string
  readonly type?: 'text' | 'number' | 'checkbox' | 'select'
  readonly options?: readonly {
    readonly value: string
    readonly label: string
  }[]
  readonly initial?: string | boolean
}

export interface EditorAction {
  readonly id: string
  readonly label: string
  readonly keywords: string
  readonly kind: EditorActionKind
  readonly fields?: readonly ActionField[]
  readonly operation?: (
    values: Readonly<Record<string, string | boolean>>,
  ) => JsonOperationInput
}

const select = (
  name: string,
  label: string,
  options: readonly string[],
): ActionField => {
  const initial = options[0]
  return {
    name,
    label,
    type: 'select',
    options: options.map((optionValue) => ({
      value: optionValue,
      label: optionValue,
    })),
    ...(initial === undefined ? {} : { initial }),
  }
}
const text = (name: string, label: string, initial = ''): ActionField => ({
  name,
  label,
  type: 'text',
  initial,
})
const number = (name: string, label: string, initial: string): ActionField => ({
  name,
  label,
  type: 'number',
  initial,
})
const path = (value: string): readonly string[] =>
  value === '' ? [] : value.split('/').filter(Boolean)
const bool = (fieldValue: string | boolean | undefined): boolean =>
  fieldValue === true
const value = (
  values: Readonly<Record<string, string | boolean>>,
  name: string,
) => String(values[name] ?? '')
const operation = (
  id: string,
  label: string,
  keywords: string,
  build: NonNullable<EditorAction['operation']>,
  fields?: readonly ActionField[],
): EditorAction => ({
  id,
  label,
  keywords,
  kind: 'operation',
  operation: build,
  ...(fields === undefined ? {} : { fields }),
})

const simpleOperations: readonly EditorAction[] = [
  operation(
    'structure.reverse',
    'Reverse children',
    'order structural',
    () => ({ type: 'structure.reverse' }),
  ),
  operation('structure.flatten', 'Flatten nested values', 'structural', () => ({
    type: 'structure.flatten',
  })),
  operation(
    'structure.remove-empty',
    'Remove empty values',
    'clean structural',
    () => ({ type: 'structure.remove-empty' }),
  ),
  operation(
    'structure.remove',
    'Remove selection',
    'delete structural',
    () => ({ type: 'structure.remove' }),
  ),
  operation('text.trim', 'Trim text', 'space string', () => ({
    type: 'text.trim',
  })),
  operation(
    'text.parse-escaped',
    'Parse escaped text',
    'unescape string',
    () => ({ type: 'text.parse-escaped' }),
  ),
  operation('text.escape', 'Escape text', 'string', () => ({
    type: 'text.escape',
  })),
  operation('primitive.toggle', 'Toggle boolean', 'true false', () => ({
    type: 'primitive.toggle',
  })),
  operation(
    'collection.deduplicate',
    'Remove duplicate children',
    'unique',
    () => ({ type: 'collection.deduplicate' }),
  ),
  operation('data.diff', 'Compare selections', 'difference', () => ({
    type: 'data.diff',
  })),
]

const ACTIONS: readonly EditorAction[] = [
  { id: 'copy', label: 'Copy', keywords: 'clipboard', kind: 'clipboard' },
  {
    id: 'paste',
    label: 'Paste',
    keywords: 'clipboard automatic',
    kind: 'clipboard',
  },
  {
    id: 'paste.into',
    label: 'Paste into',
    keywords: 'clipboard insert child',
    kind: 'clipboard',
  },
  {
    id: 'paste.beside',
    label: 'Paste beside',
    keywords: 'clipboard insert sibling',
    kind: 'clipboard',
  },
  {
    id: 'paste.replace',
    label: 'Paste replacing selection',
    keywords: 'clipboard overwrite',
    kind: 'clipboard',
  },
  { id: 'add.value', label: 'Add value', keywords: 'new', kind: 'command' },
  {
    id: 'add.header',
    label: 'Add nested header',
    keywords: 'new section',
    kind: 'command',
  },
  {
    id: 'duplicate',
    label: 'Duplicate',
    keywords: 'copy clone',
    kind: 'command',
  },
  { id: 'rename', label: 'Rename', keywords: 'caption', kind: 'command' },
  { id: 'wrap', label: 'Wrap', keywords: 'nest', kind: 'command' },
  { id: 'unwrap', label: 'Unwrap', keywords: 'unnest', kind: 'command' },
  { id: 'clear', label: 'Clear children', keywords: 'empty', kind: 'command' },
  { id: 'delete', label: 'Delete', keywords: 'remove', kind: 'command' },
  ...simpleOperations,
  operation(
    'structure.move-to',
    'Move to',
    'reparent path position',
    () => ({ type: 'structure.move-to', containerId: '' as never, index: 0 }),
    [text('path', 'Destination path'), number('index', 'Position', '0')],
  ),
  operation(
    'text.case',
    'Change text case',
    'upper lower title',
    (v) => ({ type: 'text.case', mode: value(v, 'mode') as 'upper' }),
    [select('mode', 'Case', ['upper', 'lower', 'title'])],
  ),
  operation(
    'text.replace',
    'Find and replace',
    'text string',
    (v) => ({
      type: 'text.replace',
      find: value(v, 'find'),
      replacement: value(v, 'replacement'),
      all: bool(v.all),
      caseSensitive: bool(v.caseSensitive),
    }),
    [
      text('find', 'Find'),
      text('replacement', 'Replacement'),
      { name: 'all', label: 'Replace all', type: 'checkbox', initial: true },
      {
        name: 'caseSensitive',
        label: 'Match case',
        type: 'checkbox',
        initial: true,
      },
    ],
  ),
  operation(
    'text.affix',
    'Add prefix or suffix',
    'text string',
    (v) => ({
      type: 'text.affix',
      position: value(v, 'position') as 'prefix',
      value: value(v, 'value'),
    }),
    [
      select('position', 'Position', ['prefix', 'suffix']),
      text('value', 'Text'),
    ],
  ),
  operation(
    'primitive.convert',
    'Convert value',
    'string number boolean null',
    (v) => ({ type: 'primitive.convert', to: value(v, 'to') as 'string' }),
    [select('to', 'Result type', ['string', 'number', 'boolean', 'null'])],
  ),
  operation(
    'primitive.date-format',
    'Set date display',
    'format source inferred',
    (v) => ({
      type: 'primitive.date-format',
      formatting: value(v, 'formatting') as 'inherit',
    }),
    [select('formatting', 'Display', ['inherit', 'formatted', 'source'])],
  ),
  operation(
    'primitive.number-format',
    'Set number display',
    'format source inferred',
    (v) => ({
      type: 'primitive.number-format',
      formatting: value(v, 'formatting') as 'inherit',
    }),
    [select('formatting', 'Display', ['inherit', 'formatted', 'source'])],
  ),
  operation(
    'primitive.generate',
    'Generate value',
    'uuid timestamp',
    (v) => ({ type: 'primitive.generate', value: value(v, 'value') as 'uuid' }),
    [select('value', 'Generate', ['uuid', 'timestamp'])],
  ),
  operation(
    'primitive.adjust',
    'Adjust number',
    'increment decrement add',
    (v) => ({ type: 'primitive.adjust', amount: Number(value(v, 'amount')) }),
    [number('amount', 'Amount', '1')],
  ),
  operation(
    'collection.sort',
    'Sort children',
    'caption value path direction',
    (v) => ({
      type: 'collection.sort',
      key:
        value(v, 'by') === 'path'
          ? { by: 'path', path: path(value(v, 'path')) }
          : { by: value(v, 'by') as 'caption' },
      direction: value(v, 'direction') as 'asc',
    }),
    [
      select('by', 'Sort by', ['caption', 'value', 'path']),
      text('path', 'Nested path'),
      select('direction', 'Direction', ['asc', 'desc']),
    ],
  ),
  operation(
    'collection.filter',
    'Filter children',
    'query matching',
    (v) => ({
      type: 'collection.filter',
      query: JSON.parse(value(v, 'query')) as never,
    }),
    [text('query', 'Query JSON', '{"type":"all"}')],
  ),
  operation(
    'collection.group',
    'Group by path',
    'group nested',
    (v) => ({ type: 'collection.group', path: path(value(v, 'path')) }),
    [text('path', 'Path')],
  ),
  operation(
    'collection.reorder',
    'Set child order',
    'persistent positions',
    () => ({ type: 'collection.reorder', childIds: [] }),
    [text('positions', 'Positions in order', '1, 2, 3')],
  ),
  operation(
    'data.merge',
    'Merge selections',
    'shallow deep combine',
    (v) => ({ type: 'data.merge', depth: value(v, 'depth') as 'shallow' }),
    [select('depth', 'Depth', ['shallow', 'deep'])],
  ),
  operation(
    'data.extract',
    'Extract parts',
    'captions values',
    (v) => ({
      type: 'data.extract',
      part: value(v, 'part') === 'captions' ? 'keys' : 'values',
    }),
    [select('part', 'Extract', ['captions', 'values'])],
  ),
  operation(
    'data.rename-path',
    'Rename path segment',
    'nested caption',
    (v) => ({
      type: 'data.rename-path',
      path: path(value(v, 'path')),
      replacement: value(v, 'replacement'),
    }),
    [text('path', 'Path'), text('replacement', 'New name')],
  ),
  {
    id: 'move.up',
    label: 'Move up',
    keywords: 'reorder',
    kind: 'operation',
    operation: () => ({ type: 'structure.move', direction: 'up' }),
  },
  {
    id: 'move.down',
    label: 'Move down',
    keywords: 'reorder',
    kind: 'operation',
    operation: () => ({ type: 'structure.move', direction: 'down' }),
  },
  {
    id: 'select.matches',
    label: 'Select matching values',
    keywords: 'query find filter',
    kind: 'navigation',
    fields: [text('query', 'Query JSON', '{"type":"all"}')],
  },
  {
    id: 'focus.path',
    label: 'Focus path',
    keywords: 'navigate pointer',
    kind: 'navigation',
    fields: [text('path', 'Source path')],
  },
  {
    id: 'show.path',
    label: 'Show source path',
    keywords: 'navigate pointer',
    kind: 'navigation',
  },
  {
    id: 'copy.path',
    label: 'Copy source path',
    keywords: 'navigate pointer clipboard',
    kind: 'navigation',
  },
  {
    id: 'expand.descendants',
    label: 'Expand descendants',
    keywords: 'navigation reveal',
    kind: 'navigation',
  },
  {
    id: 'collapse.descendants',
    label: 'Collapse descendants',
    keywords: 'navigation hide',
    kind: 'navigation',
  },
  {
    id: 'expand.all',
    label: 'Expand all',
    keywords: 'navigation reveal',
    kind: 'navigation',
  },
  {
    id: 'collapse.all',
    label: 'Collapse all',
    keywords: 'navigation hide',
    kind: 'navigation',
  },
]

const operationIds = new Set(
  JSON_OPERATION_CATALOG.filter(
    ({ implementation }) => implementation === 'operation',
  ).map(({ id }) => id),
)

export const EDITOR_ACTION_CATALOG: readonly EditorAction[] = ACTIONS.filter(
  (action) =>
    action.kind !== 'operation' ||
    operationIds.has(
      action.id === 'move.up' || action.id === 'move.down'
        ? 'structure.move'
        : action.id,
    ),
)
