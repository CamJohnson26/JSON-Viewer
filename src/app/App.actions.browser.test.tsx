import { expect, test } from 'vitest'
import { userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'

import {
  materialize,
  nodeId,
  parseJson,
  type JsonDocument,
} from '../domain/document/index.ts'
import { createEditorTestStore } from '../test/fixtures/editor.ts'
import { App } from './App.tsx'

async function editorWithValues(values: readonly string[]) {
  const store = createEditorTestStore()
  const screen = await render(<App store={store} />)
  const root = screen.getByRole('treeitem', { name: 'Blank document' })
  await root.click()
  root.element().focus()
  for (const value of values) {
    await userEvent.keyboard('{Enter}')
    const composer = screen.getByRole('textbox', { name: 'Add value' })
    await composer.fill(value)
    await userEvent.keyboard('{Enter}')
  }
  return { screen, store }
}

test('selects additive and sibling ranges while arrows preserve selection', async () => {
  const { screen } = await editorWithValues(['one', 'two', 'three'])
  const items = screen.getByRole('treeitem').all()
  await items[1]!.click()
  clickWith(items[2]!.element(), { ctrlKey: true })

  await expect.element(items[1]!).toHaveAttribute('aria-selected', 'true')
  await expect.element(items[2]!).toHaveAttribute('aria-selected', 'true')
  await expect
    .element(screen.getByRole('contentinfo', { name: 'Editor status' }))
    .toHaveTextContent('2 selected')

  items[2]!.element().focus()
  await userEvent.keyboard('{ArrowDown}')
  await expect.element(items[3]!).toHaveFocus()
  await expect.element(items[1]!).toHaveAttribute('aria-selected', 'true')
  await expect.element(items[2]!).toHaveAttribute('aria-selected', 'true')

  clickWith(items[3]!.element(), { shiftKey: true })
  await expect.element(items[2]!).toHaveAttribute('aria-selected', 'true')
  await expect.element(items[3]!).toHaveAttribute('aria-selected', 'true')
})

test('copies contextual selection and pastes JSON without intercepting text entry', async () => {
  const { screen, store } = await editorWithValues(['one', 'two'])
  const values = screen.getByRole('treeitem', { name: 'string value' }).all()
  await values[0]!.click()
  clickWith(values[1]!.element(), { ctrlKey: true })
  await expect.element(values[1]!).toHaveAttribute('aria-selected', 'true')
  const transfer = new DataTransfer()
  values[1]!
    .element()
    .dispatchEvent(
      new ClipboardEvent('copy', { bubbles: true, clipboardData: transfer }),
    )
  expect(transfer.getData('text/plain')).toBe('[\n  "one",\n  "two"\n]')

  const root = screen.getByRole('treeitem', { name: 'Blank document' })
  root.element().focus()
  const paste = new DataTransfer()
  paste.setData('text/plain', '3')
  root
    .element()
    .dispatchEvent(
      new ClipboardEvent('paste', { bubbles: true, clipboardData: paste }),
    )
  expect(materialize(store.getSnapshot().present)).toEqual(['one', 'two', 3])
})

test('opens the shared menu from the keyboard and restores row focus', async () => {
  const { screen } = await editorWithValues(['menu'])
  const value = screen.getByRole('treeitem', { name: 'string value' })
  value.element().focus()
  await userEvent.keyboard('{Shift>}{F10}{/Shift}')
  await expect.element(screen.getByRole('menu')).toBeVisible()
  await expect
    .element(screen.getByRole('menuitem', { name: 'Trim text' }))
    .toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.element(value).toHaveFocus()
})

test('filters applicable context-menu actions and restores row focus', async () => {
  const { screen } = await editorWithValues(['  menu  '])
  const value = screen.getByRole('treeitem', { name: 'string value' })
  value.element().focus()
  await userEvent.keyboard('{Shift>}{F10}{/Shift}')
  const search = screen.getByRole('textbox', {
    name: 'Search available actions',
  })
  await expect.element(search).toHaveFocus()
  await search.fill('trim')
  await expect
    .element(screen.getByRole('menuitem', { name: 'Trim text' }))
    .toBeVisible()
  await expect
    .element(screen.getByRole('menuitem', { name: 'Delete' }))
    .not.toBeInTheDocument()
  await userEvent.keyboard('{Escape}')
  await expect.element(value).toHaveFocus()
})

test('opens a contextual add row from the menu beneath a value', async () => {
  const { screen, store } = await editorWithValues(['first', 'third'])
  const values = screen.getByRole('treeitem', { name: 'string value' }).all()
  values[0]!
    .element()
    .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, button: 2 }))
  await screen.getByRole('menuitem', { name: 'Add row' }).click()
  const composer = screen.getByRole('textbox', { name: 'Add value' })
  await composer.fill('second')
  await userEvent.keyboard('{Enter}')

  expect(materialize(store.getSnapshot().present)).toEqual([
    'first',
    'second',
    'third',
  ])
})

test('searches the palette, applies a parameterized operation, and avoids model jargon', async () => {
  const { screen, store } = await editorWithValues(['  before  '])
  const value = screen.getByRole('treeitem', { name: 'string value' })
  await value.click()
  await userEvent.keyboard('{Control>}{Shift>}p{/Shift}{/Control}')
  const search = screen.getByRole('textbox', { name: 'Search commands' })
  await search.fill('find replace')
  await screen.getByRole('option', { name: 'Find and replace' }).click()
  await screen.getByRole('textbox', { name: 'Find' }).fill('before')
  await screen.getByRole('textbox', { name: 'Replacement' }).fill('after')
  await screen.getByRole('button', { name: 'Apply' }).click()
  expect(materialize(store.getSnapshot().present)).toEqual(['  after  '])

  const visibleText = document.body.innerText.toLowerCase()
  expect(visibleText).not.toMatch(/\b(container|collection|key)\b/)
})

test('keeps parameter dialogs open with an inline error', async () => {
  const { screen, store } = await editorWithValues(['before'])
  clickWith(
    screen.getByRole('treeitem', { name: 'Blank document' }).element(),
    {},
  )
  await userEvent.keyboard('{Control>}{Shift>}p{/Shift}{/Control}')
  await screen.getByRole('textbox', { name: 'Search commands' }).fill('filter')
  await screen.getByRole('option', { name: 'Filter children' }).click()
  await screen.getByRole('textbox', { name: 'Query JSON' }).fill('{')
  await screen.getByRole('button', { name: 'Apply' }).click()

  await expect.element(screen.getByRole('alert')).toBeVisible()
  await expect
    .element(screen.getByRole('textbox', { name: 'Query JSON' }))
    .toBeVisible()
  expect(materialize(store.getSnapshot().present)).toEqual(['before'])
})

test('converts selected captions in one undoable action', async () => {
  const store = createEditorTestStore(
    parsed('{"First Name":{},"account-status":{}}'),
  )
  const screen = await render(<App store={store} />)
  const root = screen.getByRole('treeitem', { name: 'Blank document' })
  root.element().focus()
  await userEvent.keyboard('{ArrowRight}')
  const first = screen.getByRole('treeitem', { name: 'First Name' })
  const second = screen.getByRole('treeitem', { name: 'account-status' })
  await first.click()
  clickWith(second.element(), { ctrlKey: true })
  await userEvent.keyboard('{Control>}{Shift>}p{/Shift}{/Control}')
  await screen
    .getByRole('textbox', { name: 'Search commands' })
    .fill('caption style')
  await screen.getByRole('option', { name: 'Change caption style' }).click()
  await screen.getByRole('combobox', { name: 'Style' }).selectOptions('camel')
  await screen.getByRole('button', { name: 'Apply' }).click()

  expect(materialize(store.getSnapshot().present)).toEqual({
    firstName: {},
    accountStatus: {},
  })
  await userEvent.keyboard('{Control>}z{/Control}')
  expect(materialize(store.getSnapshot().present)).toEqual({
    'First Name': {},
    'account-status': {},
  })
})

test('expands and collapses a header with all descendants using Alt', async () => {
  const screen = await render(
    <App store={createEditorTestStore(parsed('{"outer":{"inner":[]}}'))} />,
  )
  const root = screen.getByRole('treeitem', { name: 'Blank document' })
  root.element().focus()
  await userEvent.keyboard('{ArrowRight}')
  const outer = screen.getByRole('treeitem', { name: 'outer' })
  outer.element().focus()
  await userEvent.keyboard('{Alt>}{ArrowRight}{/Alt}')
  const inner = screen.getByRole('treeitem', { name: 'inner' })
  await expect.element(outer).toHaveAttribute('aria-expanded', 'true')
  await expect.element(inner).toHaveAttribute('aria-expanded', 'true')

  outer.element().focus()
  await userEvent.keyboard('{Alt>}{ArrowLeft}{/Alt}')
  await expect.element(outer).toHaveAttribute('aria-expanded', 'false')
  await expect.element(inner).not.toBeInTheDocument()
  await expect.element(outer).toHaveFocus()

  clickWith(outer.element(), { altKey: true })
  await expect
    .element(screen.getByRole('treeitem', { name: 'inner' }))
    .toHaveAttribute('aria-expanded', 'true')
})

test('runs add-header as a header workflow', async () => {
  const { screen, store } = await editorWithValues([])
  await userEvent.keyboard('{Control>}{Shift>}p{/Shift}{/Control}')
  await screen
    .getByRole('textbox', { name: 'Search commands' })
    .fill('nested header')
  await screen.getByRole('option', { name: 'Add header' }).click()
  const composer = screen.getByRole('textbox', { name: 'Add header caption' })
  await composer.fill('details')
  await userEvent.keyboard('{Enter}')

  await expect
    .element(screen.getByRole('treeitem', { name: 'details' }))
    .toBeVisible()
  expect(materialize(store.getSnapshot().present)).toEqual({ details: [] })
})

test('replaces an actively edited value from JSON paste and shows invalid paste inline', async () => {
  const { screen, store } = await editorWithValues(['before'])
  const value = screen.getByRole('treeitem', { name: 'string value' })
  value.element().focus()
  await userEvent.keyboard('{F2}')
  const editor = screen.getByRole('textbox', { name: 'Value source' })
  const invalid = new DataTransfer()
  invalid.setData('text/plain', '{')
  editor
    .element()
    .dispatchEvent(
      new ClipboardEvent('paste', { bubbles: true, clipboardData: invalid }),
    )
  await expect.element(screen.getByRole('alert')).toBeVisible()
  expect(materialize(store.getSnapshot().present)).toEqual(['before'])

  const replacement = new DataTransfer()
  replacement.setData('text/plain', '{"x":1}')
  editor.element().dispatchEvent(
    new ClipboardEvent('paste', {
      bubbles: true,
      clipboardData: replacement,
    }),
  )
  expect(materialize(store.getSnapshot().present)).toEqual([{ x: 1 }])
})

test('keeps roving focus visible when collapsing all headers', async () => {
  const { screen } = await editorWithValues([])
  await userEvent.keyboard('{Control>}{Shift>}p{/Shift}{/Control}')
  await screen
    .getByRole('textbox', { name: 'Search commands' })
    .fill('nested header')
  await screen.getByRole('option', { name: 'Add header' }).click()
  await screen
    .getByRole('textbox', { name: 'Add header caption' })
    .fill('details')
  await userEvent.keyboard('{Enter}')
  const header = screen.getByRole('treeitem', { name: 'details' })
  header.element().focus()
  await userEvent.keyboard('{Enter}')
  const childComposer = screen.getByRole('textbox', { name: 'Add value' })
  await childComposer.fill('inside')
  await userEvent.keyboard('{Enter}')
  const child = screen.getByRole('treeitem', { name: 'string value' })
  child.element().focus()

  await userEvent.keyboard('{Control>}{Shift>}p{/Shift}{/Control}')
  await screen
    .getByRole('textbox', { name: 'Search commands' })
    .fill('collapse all')
  await screen.getByRole('option', { name: 'Collapse all' }).click()

  await expect
    .element(screen.getByRole('treeitem', { name: 'Blank document' }))
    .toHaveFocus()
})

function clickWith(
  element: Element,
  modifiers: {
    readonly altKey?: boolean
    readonly ctrlKey?: boolean
    readonly shiftKey?: boolean
  },
): void {
  element
    .querySelector<HTMLElement>('.tree-row')
    ?.dispatchEvent(new MouseEvent('click', { bubbles: true, ...modifiers }))
}

function parsed(source: string): JsonDocument {
  let id = 0
  const result = parseJson(source, {}, () => nodeId(`fixture-${id++}`))
  if (!result.ok) throw new Error(result.error.message)
  return result.document
}
