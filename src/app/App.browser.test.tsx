import { userEvent } from 'vitest/browser'
import { expect, test } from 'vitest'
import { render } from 'vitest-browser-react'

import { materialize, nodeId, parseJson } from '../domain/document/index.ts'
import { createEditorTestStore, editorLabels } from '../test/fixtures/editor'
import { App } from './App'

test('starts with one collapsed blank root and complete tree semantics', async () => {
  const screen = await render(<App store={createEditorTestStore()} />)
  const root = screen.getByRole('treeitem', { name: 'Blank document' })

  await expect
    .element(screen.getByRole('tree', { name: 'Document' }))
    .toBeVisible()
  await expect.element(root).toHaveAttribute('aria-level', '1')
  await expect.element(root).toHaveAttribute('aria-posinset', '1')
  await expect.element(root).toHaveAttribute('aria-setsize', '1')
  await expect.element(root).toHaveAttribute('aria-expanded', 'false')
  await expect.element(root).toHaveAttribute('aria-selected', 'true')
  await expect
    .element(screen.getByRole('textbox', { name: 'Add value' }))
    .not.toBeInTheDocument()
  await expect
    .element(screen.getByRole('contentinfo', { name: editorLabels.status }))
    .toHaveTextContent('Ready')
})

test('expands and adds primitives while retaining a fresh composer', async () => {
  const screen = await render(<App store={createEditorTestStore()} />)
  await screen.getByRole('treeitem', { name: 'Blank document' }).click()
  const composer = screen.getByRole('textbox', { name: 'Add value' })
  await composer.fill('1234')
  await userEvent.keyboard('{Enter}')

  await expect
    .element(screen.getByRole('treeitem', { name: 'number value' }))
    .toBeVisible()
  await expect.element(screen.getByText('1,234', { exact: true })).toBeVisible()
  await expect.element(composer).toHaveValue('')
  await expect.element(composer).toHaveFocus()
})

test('adds an expanded nested header and focuses its composer', async () => {
  const screen = await render(<App store={createEditorTestStore()} />)
  await screen.getByRole('treeitem', { name: 'Blank document' }).click()
  const rootComposer = screen.getByRole('textbox', { name: 'Add value' })
  await rootComposer.fill('details')
  await userEvent.keyboard('{Alt>}{Enter}{/Alt}')

  const header = screen.getByRole('treeitem', { name: 'details' })
  await expect.element(header).toHaveAttribute('aria-level', '2')
  await expect.element(header).toHaveAttribute('aria-expanded', 'true')
  const composers = screen.getByRole('textbox', { name: 'Add value' }).all()
  expect(composers).toHaveLength(2)
  await expect.element(composers[1]!).toHaveFocus()
})

test('edits a primitive on Enter and cancels with Escape', async () => {
  const screen = await render(<App store={createEditorTestStore()} />)
  await screen.getByRole('treeitem', { name: 'Blank document' }).click()
  const composer = screen.getByRole('textbox', { name: 'Add value' })
  await composer.fill('before')
  await userEvent.keyboard('{Enter}')
  const value = screen.getByRole('treeitem', { name: 'string value' })
  value.element().focus()
  await userEvent.keyboard('{Enter}')
  const editor = screen.getByRole('textbox', { name: 'Value source' })
  await editor.fill('after')
  await userEvent.keyboard('{Escape}')

  await expect
    .element(screen.getByText('before', { exact: true }))
    .toBeVisible()
  await expect.element(editor).not.toBeInTheDocument()

  value.element().focus()
  await userEvent.keyboard('{Enter}')
  const changedEditor = screen.getByRole('textbox', { name: 'Value source' })
  await changedEditor.fill('after')
  await screen.getByRole('button', { name: 'Formatting on' }).click()
  await expect.element(screen.getByText('after', { exact: true })).toBeVisible()
  await expect.element(changedEditor).not.toBeInTheDocument()
})

test('uses visible preorder keyboard navigation', async () => {
  const screen = await render(<App store={createEditorTestStore()} />)
  const root = screen.getByRole('treeitem', { name: 'Blank document' })
  root.element().focus()
  await userEvent.keyboard('{ArrowRight}')
  const composer = screen.getByRole('textbox', { name: 'Add value' })
  await composer.fill('first')
  await userEvent.keyboard('{Enter}')
  await composer.fill('second')
  await userEvent.keyboard('{Enter}')
  root.element().focus()
  await userEvent.keyboard(' ')
  await expect.element(root).toHaveAttribute('aria-expanded', 'false')
  await userEvent.keyboard(' ')
  await expect.element(root).toHaveAttribute('aria-expanded', 'true')
  await userEvent.keyboard('{End}')

  const items = screen.getByRole('treeitem')
  await expect.element(items.nth(2)).toHaveFocus()
  await userEvent.keyboard('{ArrowLeft}')
  await expect.element(root).toHaveFocus()
  await userEvent.keyboard('{ArrowRight}{ArrowRight}')
  await expect.element(items.nth(1)).toHaveFocus()
  await userEvent.keyboard('{ArrowDown}')
  await expect.element(items.nth(2)).toHaveFocus()
  await userEvent.keyboard('{Home}')
  await expect.element(root).toHaveFocus()
})

test('duplicates, deletes, and restores mutations through undo', async () => {
  const screen = await render(<App store={createEditorTestStore()} />)
  await screen.getByRole('treeitem', { name: 'Blank document' }).click()
  const composer = screen.getByRole('textbox', { name: 'Add value' })
  await composer.fill('kept')
  await userEvent.keyboard('{Enter}')
  const value = screen.getByRole('treeitem', { name: 'string value' })
  value.element().focus()
  await userEvent.keyboard('{Control>}d{/Control}')
  await expect
    .element(screen.getByRole('treeitem', { name: 'string value' }).all()[1]!)
    .toBeVisible()
  await userEvent.keyboard('{Delete}')
  await expect
    .element(screen.getByRole('treeitem', { name: 'string value' }).all()[1]!)
    .not.toBeInTheDocument()
  await userEvent.keyboard('{Control>}z{/Control}')
  await expect
    .element(screen.getByRole('treeitem', { name: 'string value' }).all()[1]!)
    .toBeVisible()
})

test('undoes and redoes a committed add from the pristine composer', async () => {
  const store = createEditorTestStore()
  const screen = await render(<App store={store} />)
  await screen.getByRole('treeitem', { name: 'Blank document' }).click()
  const composer = screen.getByRole('textbox', { name: 'Add value' })
  await composer.fill('undo me')
  await userEvent.keyboard('{Enter}')
  await expect
    .element(screen.getByRole('treeitem', { name: 'string value' }))
    .toBeVisible()
  await expect.element(composer).toHaveFocus()

  await userEvent.keyboard('{Control>}z{/Control}')
  await expect
    .element(screen.getByRole('treeitem', { name: 'string value' }))
    .not.toBeInTheDocument()
  expect(store.getSnapshot().future).toHaveLength(1)

  await userEvent.keyboard('{Control>}{Shift>}z{/Shift}{/Control}')
  await expect
    .element(screen.getByRole('treeitem', { name: 'string value' }))
    .toBeVisible()
})

test('keeps document undo available from non-text controls', async () => {
  const store = createEditorTestStore()
  const screen = await render(<App store={store} />)
  await screen.getByRole('treeitem', { name: 'Blank document' }).click()
  const composer = screen.getByRole('textbox', { name: 'Add value' })
  await composer.fill('undo from toolbar')
  await userEvent.keyboard('{Enter}')
  await screen.getByRole('button', { name: 'Formatting on' }).click()
  await userEvent.keyboard('{Control>}z{/Control}')

  expect(materialize(store.getSnapshot().present)).toEqual([])
})

test('applies global and per-value formatting without losing type markers', async () => {
  const store = createEditorTestStore()
  const screen = await render(<App store={store} />)
  await screen.getByRole('treeitem', { name: 'Blank document' }).click()
  const composer = screen.getByRole('textbox', { name: 'Add value' })
  await composer.fill('2026-08-01')
  await userEvent.keyboard('{Enter}')
  screen.getByRole('treeitem', { name: 'Blank document' }).element().focus()
  await expect.element(screen.getByText('Aug 1, 2026')).toBeVisible()
  await expect
    .element(screen.getByLabelText('date type'))
    .toHaveTextContent('D')
  const historyLength = store.getSnapshot().past.length
  await screen.getByRole('button', { name: 'Formatting on' }).click()
  await expect
    .element(screen.getByText('2026-08-01', { exact: true }))
    .toBeVisible()
  expect(store.getSnapshot().past).toHaveLength(historyLength)
})

test('labels imported anonymous items without changing their JSON', async () => {
  let sequence = 0
  const parsed = parseJson('[{"a":1},{"b":2}]', {}, () =>
    nodeId(`import-${sequence++}`),
  )
  if (!parsed.ok) throw new Error(parsed.error.message)
  const store = createEditorTestStore(parsed.document)
  const screen = await render(<App store={store} />)
  await screen.getByRole('treeitem', { name: 'Blank document' }).click()

  const first = screen.getByRole('treeitem', { name: 'Item 1' })
  const second = screen.getByRole('treeitem', { name: 'Item 2' })
  await expect.element(first).toHaveTextContent('Item 1')
  await expect.element(second).toHaveTextContent('Item 2')
  await expect.element(first).toHaveAttribute('aria-level', '2')
  await expect.element(second).toHaveAttribute('aria-posinset', '2')
  expect(materialize(store.getSnapshot().present)).toEqual([{ a: 1 }, { b: 2 }])
})

test('single-click selection preserves boolean presentation and row geometry', async () => {
  const store = createEditorTestStore()
  const screen = await render(<App store={store} />)
  await screen.getByRole('treeitem', { name: 'Blank document' }).click()
  const composer = screen.getByRole('textbox', { name: 'Add value' })
  for (const value of ['true', 'other']) {
    await composer.fill(value)
    await userEvent.keyboard('{Enter}')
  }
  const values = screen.getByRole('treeitem').all().slice(1)
  const rows = values.map((value) =>
    value.element().querySelector<HTMLElement>(':scope > .tree-row'),
  )
  if (rows.some((row) => row === null)) throw new Error('Missing tree row')
  const before = rows.map((row) => (row as HTMLElement).getBoundingClientRect())
  const snapshot = store.getSnapshot()

  await values[0]!.click()

  await expect.element(screen.getByText('TRUE', { exact: true })).toBeVisible()
  await expect
    .element(screen.getByRole('textbox', { name: 'Value source' }))
    .not.toBeInTheDocument()
  expect(store.getSnapshot().present).toBe(snapshot.present)
  expect(store.getSnapshot().revision).toBe(snapshot.revision)
  const after = rows.map((row) => (row as HTMLElement).getBoundingClientRect())
  after.forEach((rect, index) => {
    expect(rect.top).toBeCloseTo(before[index]!.top, 3)
    expect(rect.height).toBeCloseTo(before[index]!.height, 3)
  })

  values[0]!
    .element()
    .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, button: 2 }))
  await screen.getByRole('menuitem', { name: 'Toggle boolean' }).click()
  await expect.element(screen.getByText('FALSE', { exact: true })).toBeVisible()
  values[0]!.element().focus()
  await userEvent.keyboard('{Control>}z{/Control}')
  await expect.element(screen.getByText('TRUE', { exact: true })).toBeVisible()
})

test('clears uncommitted drafts without hiding composers', async () => {
  const store = createEditorTestStore()
  const screen = await render(<App store={store} />)
  const root = screen.getByRole('treeitem', { name: 'Blank document' })
  await root.click()
  let composer = screen.getByRole('textbox', { name: 'Add value' })
  await composer.fill('discard me')
  const formatting = screen.getByRole('button', { name: 'Formatting on' })
  const formattingElement = formatting.element()
  await formatting.click()

  await expect.element(composer).toBeInTheDocument()
  await expect.element(composer).toHaveValue('')
  expect(globalThis.document.activeElement).toBe(formattingElement)
  expect(materialize(store.getSnapshot().present)).toEqual([])

  root.element().focus()
  await userEvent.keyboard('{Enter}')
  composer = screen.getByRole('textbox', { name: 'Add value' })
  await composer.fill('discard again')
  await userEvent.keyboard('{Escape}')
  await expect.element(composer).toBeInTheDocument()
  await expect.element(composer).toHaveValue('')
  await expect.element(root).toHaveFocus()
  expect(materialize(store.getSnapshot().present)).toEqual([])
})

test('adds an untouched composer as a neutral blank header', async () => {
  const neutralStore = createEditorTestStore()
  const neutral = await render(<App store={neutralStore} />)
  await neutral.getByRole('treeitem', { name: 'Blank document' }).click()
  await neutral.getByRole('button', { name: 'Add header' }).click()
  await expect
    .element(neutral.getByRole('treeitem', { name: 'Blank header' }))
    .toBeVisible()
  expect(materialize(neutralStore.getSnapshot().present)).toEqual([[]])
})

test('renders an intentionally empty caption distinctly', async () => {
  const emptyStore = createEditorTestStore()
  const empty = await render(<App store={emptyStore} />)
  await empty.getByRole('treeitem', { name: 'Blank document' }).click()
  const composer = empty.getByRole('textbox', { name: 'Add value' })
  await composer.fill('x')
  await composer.fill('')
  await empty.getByRole('button', { name: 'Add header' }).click()
  await expect
    .element(empty.getByRole('treeitem', { name: 'Empty caption header' }))
    .toHaveTextContent('""')
  expect(materialize(emptyStore.getSnapshot().present)).toEqual({ '': [] })
})

test('clears a draft after tabbing through the Header action', async () => {
  const store = createEditorTestStore()
  const screen = await render(<App store={store} />)
  await screen.getByRole('treeitem', { name: 'Blank document' }).click()
  const composer = screen.getByRole('textbox', { name: 'Add value' })
  await composer.fill('uncommitted')
  await userEvent.keyboard('{Tab}')
  await expect
    .element(screen.getByRole('button', { name: 'Add header' }))
    .toHaveFocus()
  await userEvent.keyboard('{Tab}')

  await expect.element(composer).toBeInTheDocument()
  await expect.element(composer).toHaveValue('')
  expect(materialize(store.getSnapshot().present)).toEqual([])
})

test('keeps root and nested composers attached to their owning headers', async () => {
  const store = createEditorTestStore()
  const screen = await render(<App store={store} />)
  const root = screen.getByRole('treeitem', { name: 'Blank document' })
  await root.click()
  const rootComposer = directComposer(root.element())

  await userEvent.fill(rootComposer, 'first')
  await userEvent.keyboard('{Alt>}{Enter}{/Alt}')
  await userEvent.fill(rootComposer, 'second')
  await userEvent.keyboard('{Alt>}{Enter}{/Alt}')

  const first = screen.getByRole('treeitem', { name: 'first', exact: true })
  const second = screen.getByRole('treeitem', { name: 'second', exact: true })
  expect(root.element().children[1]).toHaveClass('add-composer')
  expect(first.element().children[1]).toHaveClass('add-composer')
  expect(second.element().children[1]).toHaveClass('add-composer')

  const firstComposer = directComposer(first.element())
  await userEvent.fill(firstComposer, 'discard nested draft')
  await screen.getByRole('button', { name: 'Formatting on' }).click()
  await expect.element(firstComposer).toBeInTheDocument()
  await expect.element(firstComposer).toHaveValue('')

  await userEvent.fill(firstComposer, 'one')
  await userEvent.keyboard('{Enter}')
  await userEvent.fill(directComposer(second.element()), 'two')
  await userEvent.keyboard('{Enter}')

  expect(materialize(store.getSnapshot().present)).toEqual({
    first: 'one',
    second: 'two',
  })
})

test('reports duplicate caption errors without changing the document', async () => {
  const store = createEditorTestStore()
  const screen = await render(<App store={store} />)
  const root = screen.getByRole('treeitem', { name: 'Blank document' })
  await root.click()
  const rootComposer = root
    .element()
    .querySelector<HTMLInputElement>(':scope > .add-composer input')
  if (!rootComposer) throw new Error('Missing root composer')
  await userEvent.fill(rootComposer, 'a')
  await userEvent.keyboard('{Alt>}{Enter}{/Alt}')
  await userEvent.fill(rootComposer, 'b')
  await userEvent.keyboard('{Alt>}{Enter}{/Alt}')
  const b = screen.getByRole('treeitem', { name: 'b', exact: true })
  b.element().focus()
  await userEvent.keyboard('{F2}')
  const editor = screen.getByRole('textbox', { name: 'Header caption' })
  await editor.fill('a')
  await userEvent.keyboard('{Enter}')

  await expect.element(editor).toHaveAttribute('aria-invalid', 'true')
  await expect
    .element(screen.getByRole('alert'))
    .toHaveTextContent('Duplicate caption')
  expect(materialize(store.getSnapshot().present)).toEqual({ a: [], b: [] })
})

function directComposer(treeItem: Element): HTMLInputElement {
  const composer = treeItem.querySelector<HTMLInputElement>(
    ':scope > .add-composer input',
  )
  if (!composer) throw new Error('Missing direct composer')
  return composer
}

test('renders and edits the complete primitive presentation set', async () => {
  const screen = await render(<App store={createEditorTestStore()} />)
  await screen.getByRole('treeitem', { name: 'Blank document' }).click()
  const composer = screen.getByRole('textbox', { name: 'Add value' })
  for (const value of ['true', 'null', '', '2026-08-01T12:30:00Z']) {
    await composer.fill(value)
    await userEvent.keyboard('{Enter}')
  }

  await expect
    .element(screen.getByRole('treeitem', { name: 'boolean value' }))
    .toBeVisible()
  await expect
    .element(screen.getByRole('treeitem', { name: 'null value' }))
    .toBeVisible()
  await expect
    .element(screen.getByRole('treeitem', { name: 'string value' }))
    .toBeVisible()
  await expect
    .element(screen.getByRole('treeitem', { name: 'datetime value' }))
    .toBeVisible()
  await expect
    .element(screen.getByText('empty string', { exact: true }))
    .toBeVisible()
})

test('exposes value descriptions and keyboard-operable formatting controls', async () => {
  const store = createEditorTestStore()
  const screen = await render(<App store={store} />)
  await screen.getByRole('treeitem', { name: 'Blank document' }).click()
  const composer = screen.getByRole('textbox', { name: 'Add value' })
  await composer.fill('2026-08-01')
  await userEvent.keyboard('{Enter}')
  const value = screen.getByRole('treeitem', { name: 'date value' })
  const descriptionId = value.element().getAttribute('aria-describedby')
  expect(descriptionId).toBeTruthy()
  await expect
    .element(screen.getByText('Type: date. Value: 2026-08-01'))
    .toBeInTheDocument()

  value.element().focus()
  const source = screen.getByRole('button', { name: 'source' })
  expect(source.element().tabIndex).toBe(0)
  await source.click()
  expect(
    Object.values(store.getSnapshot().present.nodes).find(
      (node) => node.type === 'primitive',
    ),
  ).toMatchObject({ formatting: 'source' })
})

test('restores the wrapped value focus when undo removes its wrapper', async () => {
  const store = createEditorTestStore()
  const screen = await render(<App store={store} />)
  await screen.getByRole('treeitem', { name: 'Blank document' }).click()
  const composer = screen.getByRole('textbox', { name: 'Add value' })
  await composer.fill('1')
  await userEvent.keyboard('{Enter}')
  const value = screen.getByRole('treeitem', { name: 'number value' })
  value.element().focus()
  await screen.getByRole('button', { name: 'Wrap item' }).click()
  await expect
    .element(screen.getByRole('textbox', { name: 'Header caption' }))
    .toHaveValue('new')
  await userEvent.keyboard('{Escape}')
  const wrapper = screen.getByRole('treeitem', { name: 'new' })
  await expect.element(wrapper).toHaveFocus()
  await userEvent.keyboard('{Control>}z{/Control}')
  await expect.element(value).toHaveFocus()
  await userEvent.keyboard('{Control>}{Shift>}z{/Shift}{/Control}')
  await expect.element(wrapper).toHaveFocus()
  await screen.getByRole('button', { name: 'Clear header' }).click()
  expect(materialize(store.getSnapshot().present)).toEqual({ new: [] })
  wrapper.element().focus()
  await userEvent.keyboard('{Control>}z{/Control}')
  expect(materialize(store.getSnapshot().present)).toEqual({ new: 1 })
  await screen.getByRole('button', { name: 'Unwrap header' }).click()
  expect(materialize(store.getSnapshot().present)).toEqual([1])
  await expect.element(value).toHaveFocus()
})
