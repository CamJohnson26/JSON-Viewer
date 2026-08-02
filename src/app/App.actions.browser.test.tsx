import { expect, test } from 'vitest'
import { userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'

import { materialize } from '../domain/document/index.ts'
import { createEditorTestStore } from '../test/fixtures/editor.ts'
import { App } from './App.tsx'

async function editorWithValues(values: readonly string[]) {
  const store = createEditorTestStore()
  const screen = await render(<App store={store} />)
  await screen.getByRole('treeitem', { name: 'Blank document' }).click()
  const composer = screen.getByRole('textbox', { name: 'Add value' })
  for (const value of values) {
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
  expect(visibleText).not.toMatch(/\b(object|array|container|collection|key)\b/)
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

test('runs add-header as a header workflow', async () => {
  const { screen, store } = await editorWithValues([])
  await userEvent.keyboard('{Control>}{Shift>}p{/Shift}{/Control}')
  await screen
    .getByRole('textbox', { name: 'Search commands' })
    .fill('nested header')
  await screen.getByRole('option', { name: 'Add nested header' }).click()
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
  await userEvent.keyboard('{Enter}')
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
  await screen.getByRole('option', { name: 'Add nested header' }).click()
  await screen
    .getByRole('textbox', { name: 'Add header caption' })
    .fill('details')
  await userEvent.keyboard('{Enter}')
  const childComposer = screen
    .getByRole('textbox', { name: 'Add value' })
    .all()
    .at(-1)!
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
  modifiers: { readonly ctrlKey?: boolean; readonly shiftKey?: boolean },
): void {
  element
    .querySelector<HTMLElement>('.tree-row')
    ?.dispatchEvent(new MouseEvent('click', { bubbles: true, ...modifiers }))
}
