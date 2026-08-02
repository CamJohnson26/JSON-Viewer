import { expect, test } from '@playwright/test'

import { editorLabels } from '../../src/test/fixtures/editor'

test('completes a graphical nested editing workflow', async ({ page }) => {
  await page.goto('/')

  const root = page.getByRole('treeitem', { name: 'Blank document' })
  await root.click()
  await root.focus()
  await page.keyboard.press('Alt+Enter')
  const rootComposer = page.getByRole('textbox', { name: 'Add header caption' })
  await rootComposer.fill('profile')
  await rootComposer.press('Enter')
  const header = page.getByRole('treeitem', { name: 'profile' })
  await expect(header).toHaveAttribute('aria-expanded', 'true')
  await header.focus()
  await page.keyboard.press('Enter')
  const nestedComposer = page.getByRole('textbox', { name: 'Add value' })
  await nestedComposer.fill('42')
  await nestedComposer.press('Enter')
  await expect(
    page.getByRole('treeitem', { name: 'number value' }),
  ).toBeVisible()
  await expect(page.getByText('42', { exact: true })).toBeVisible()
  await expect(
    page.getByRole('contentinfo', { name: editorLabels.status }),
  ).toContainText('Value added')
})

test('remains usable at 240 CSS pixels without horizontal overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 240, height: 640 })
  await page.goto('/')
  const root = page.getByRole('treeitem', { name: 'Blank document' })
  await root.click()
  await root.focus()
  await page.keyboard.press('Enter')
  await page
    .getByRole('textbox', { name: 'Add value' })
    .fill('long '.repeat(80))
  await page.getByRole('textbox', { name: 'Add value' }).press('Enter')

  await expect(
    page.getByRole('main', { name: editorLabels.main }),
  ).toBeVisible()
  const widths = await page.evaluate<{ client: number; scroll: number }>(
    '({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth })',
  )
  expect(widths.scroll).toBe(widths.client)
  const controls = page
    .getByRole('treeitem', { name: 'string value' })
    .locator('.active-controls')
  const controlsBox = await controls.boundingBox()
  expect(controlsBox).not.toBeNull()
  expect((controlsBox?.x ?? 0) + (controlsBox?.width ?? 0)).toBeLessThanOrEqual(
    widths.client,
  )
  for (const button of await controls.getByRole('button').all()) {
    const box = await button.boundingBox()
    expect(box?.width ?? 0).toBeGreaterThan(20)
    expect(
      await button.evaluate(
        (element) =>
          (element as unknown as { readonly scrollHeight: number })
            .scrollHeight,
      ),
    ).toBe(
      await button.evaluate(
        (element) =>
          (element as unknown as { readonly clientHeight: number })
            .clientHeight,
      ),
    )
  }
})

test('completes a selection clipboard menu and palette workflow', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/')
  const root = page.getByRole('treeitem', { name: 'Blank document' })
  await root.click()
  await root.focus()
  for (const value of [' first ', ' second ']) {
    await page.keyboard.press('Enter')
    const composer = page.getByRole('textbox', { name: 'Add value' })
    await composer.fill(value)
    await composer.press('Enter')
  }
  const values = page.getByRole('treeitem', { name: 'string value' })
  await values.nth(0).click()
  await values.nth(1).click({ modifiers: ['Control'] })
  await expect(values.nth(0)).toHaveAttribute('aria-selected', 'true')
  await expect(values.nth(1)).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Control+C')

  await root.focus()
  await page.keyboard.press('Control+V')
  await expect(
    page.getByRole('contentinfo', { name: 'Editor status' }),
  ).toContainText('Pasted JSON')

  await values.nth(0).click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: 'Trim text' })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Control+Shift+P')
  await page.getByRole('textbox', { name: 'Search commands' }).fill('trim')
  await page.getByRole('option', { name: 'Trim text' }).click()
  await expect(page.getByText('first', { exact: true }).first()).toBeVisible()
})

test('undoes a contextual add from the inserted row', async ({ page }) => {
  await page.goto('/')
  const root = page.getByRole('treeitem', { name: 'Blank document' })
  await root.click()
  await root.focus()
  await page.keyboard.press('Enter')
  const composer = page.getByRole('textbox', { name: 'Add value' })
  await composer.fill('undo me')
  await composer.press('Enter')
  await expect(
    page.getByRole('treeitem', { name: 'string value' }),
  ).toBeVisible()
  await expect(
    page.getByRole('treeitem', { name: 'string value' }),
  ).toBeFocused()

  await page.keyboard.press('Control+Z')
  await expect(
    page.getByRole('treeitem', { name: 'string value' }),
  ).not.toBeAttached()
})

test('keeps row geometry stable when selection moves at narrow width', async ({
  page,
}) => {
  await page.setViewportSize({ width: 240, height: 640 })
  await page.goto('/')
  const root = page.getByRole('treeitem', { name: 'Blank document' })
  await root.click()
  await root.focus()
  for (const value of ['first', 'second']) {
    await page.keyboard.press('Enter')
    const composer = page.getByRole('textbox', { name: 'Add value' })
    await composer.fill(value)
    await composer.press('Enter')
  }
  const values = page.getByRole('treeitem', { name: 'string value' })
  const before = await Promise.all([
    values.nth(0).locator(':scope > .tree-row').boundingBox(),
    values.nth(1).locator(':scope > .tree-row').boundingBox(),
  ])

  await values.nth(0).click()

  const after = await Promise.all([
    values.nth(0).locator(':scope > .tree-row').boundingBox(),
    values.nth(1).locator(':scope > .tree-row').boundingBox(),
  ])
  expect(after).toEqual(before)
})

test('drags selected values as one undoable block and cancels without mutation', async ({
  page,
}) => {
  await page.goto('/')
  const root = page.getByRole('treeitem', { name: 'Blank document' })
  await root.click()
  await root.focus()
  for (const value of ['one', 'two', 'three', 'four']) {
    await page.keyboard.press('Enter')
    const composer = page.getByRole('textbox', { name: 'Add value' })
    await composer.fill(value)
    await composer.press('Enter')
  }
  const values = page.getByRole('treeitem', { name: 'string value' })
  const text = page.getByText('one', { exact: true })
  const textBox = await text.boundingBox()
  if (!textBox) throw new Error('Missing selectable text geometry')
  await page.mouse.move(textBox.x + 1, textBox.y + textBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(
    textBox.x + textBox.width - 1,
    textBox.y + textBox.height / 2,
  )
  await page.mouse.up()
  expect(
    await page.evaluate<string>('window.getSelection()?.toString() ?? ""'),
  ).toContain('one')
  await values.nth(0).click()
  await values.nth(1).click({ modifiers: ['Control'] })
  await expect(values.nth(0)).toHaveAttribute('aria-selected', 'true')
  await expect(values.nth(1)).toHaveAttribute('aria-selected', 'true')
  await dragRow(page, values.nth(0), values.nth(3), 0.9)
  await expect(values.nth(0)).toContainText('three')
  await expect(values.nth(1)).toContainText('four')
  await expect(values.nth(2)).toContainText('one')
  await expect(values.nth(3)).toContainText('two')
  await expect(values.nth(2)).toHaveAttribute('aria-selected', 'true')
  await expect(values.nth(3)).toHaveAttribute('aria-selected', 'true')
  await expect(values.nth(2)).toBeFocused()

  await page.keyboard.press('Control+Z')
  await expect(values.nth(0)).toContainText('one')
  await expect(values.nth(1)).toContainText('two')
  await expect(values.nth(2)).toContainText('three')
  await expect(values.nth(3)).toContainText('four')
  await page.keyboard.press('Control+Shift+Z')
  await expect(values.nth(0)).toContainText('three')
  await expect(values.nth(1)).toContainText('four')
  await expect(values.nth(2)).toContainText('one')
  await expect(values.nth(3)).toContainText('two')
  await page.keyboard.press('Control+Z')
  await expect(values.nth(0)).toContainText('one')

  const source = await values
    .nth(0)
    .locator(':scope > .tree-row > .row-reference')
    .boundingBox()
  const target = await values.nth(2).locator(':scope > .tree-row').boundingBox()
  if (!source || !target) throw new Error('Missing drag row geometry')
  await page.mouse.move(
    source.x + source.width / 2,
    source.y + source.height / 2,
  )
  await page.mouse.down()
  await page.mouse.move(
    target.x + target.width / 2,
    target.y + target.height * 0.9,
    { steps: 4 },
  )
  await expect(
    page.getByRole('contentinfo', { name: 'Editor status' }),
  ).toContainText('Drop after')
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await expect(values.nth(0)).toContainText('one')
  await expect(values.nth(1)).toContainText('two')
  await expect(values.nth(2)).toContainText('three')
  await expect(values.nth(3)).toContainText('four')
  await values.nth(2).click()
  await expect(values.nth(2)).toHaveAttribute('aria-selected', 'true')

  const cancelSource = await values
    .nth(2)
    .locator(':scope > .tree-row > .row-reference')
    .boundingBox()
  const cancelTarget = await values
    .nth(3)
    .locator(':scope > .tree-row')
    .boundingBox()
  if (!cancelSource || !cancelTarget)
    throw new Error('Missing pointer cancellation geometry')
  await page.mouse.move(
    cancelSource.x + cancelSource.width / 2,
    cancelSource.y + cancelSource.height / 2,
  )
  await page.mouse.down()
  await page.mouse.move(
    cancelTarget.x + cancelTarget.width / 2,
    cancelTarget.y + cancelTarget.height * 0.9,
  )
  await page
    .getByRole('tree', { name: 'Document' })
    .dispatchEvent('pointercancel', { pointerId: 1 })
  await page.mouse.up()
  await values.nth(0).click()
  await expect(values.nth(0)).toHaveAttribute('aria-selected', 'true')
})

test('reveals collapsed drop targets and rejects descendant cycles', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  const root = page.getByRole('treeitem', { name: 'Blank document' })
  await root.click()
  await root.focus()
  await page.keyboard.press('Enter')
  await page.getByRole('textbox', { name: 'Add value' }).fill('move me')
  await page.keyboard.press('Enter')
  await root.focus()
  await page.keyboard.press('Alt+Enter')
  await page.getByRole('textbox', { name: 'Add header caption' }).fill('target')
  await page.keyboard.press('Enter')
  const value = page.getByRole('treeitem', { name: 'string value' })
  const target = page.getByRole('treeitem', { name: 'target' })
  await target.click()
  await expect(target).toHaveAttribute('aria-expanded', 'false')

  const valueBox = await value
    .locator(':scope > .tree-row > .row-reference')
    .boundingBox()
  const targetBox = await target.locator(':scope > .tree-row').boundingBox()
  if (!valueBox || !targetBox) throw new Error('Missing drag row geometry')
  await page.mouse.move(
    valueBox.x + valueBox.width / 2,
    valueBox.y + valueBox.height / 2,
  )
  await page.mouse.down()
  await page.mouse.move(
    targetBox.x + targetBox.width / 2,
    targetBox.y + targetBox.height / 2,
    { steps: 5 },
  )
  await expect(target).toHaveAttribute('aria-expanded', 'true', {
    timeout: 1500,
  })
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await expect(target).toHaveAttribute('aria-expanded', 'false')
  await expect(value).toBeVisible()

  await dragRow(page, value, target, 0.5)
  await expect(target).toHaveAttribute('aria-expanded', 'true')
  await expect(value).toBeVisible()
  const targetId = await target.getAttribute('data-node-id')
  expect(targetId).not.toBeNull()
  await expect(
    value.locator(`xpath=ancestor::div[@data-node-id="${targetId}"]`),
  ).toHaveCount(1)

  await dragRow(page, target, value, 0.9)
  await expect(
    page.getByRole('contentinfo', { name: 'Editor status' }),
  ).toContainText('own descendant')
  await expect(
    value.locator(`xpath=ancestor::div[@data-node-id="${targetId}"]`),
  ).toHaveCount(1)
})

test('auto-scrolls a narrow document during pointer movement', async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 240, height: 320 })
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/')
  const source = JSON.stringify(
    Array.from({ length: 30 }, (_, index) => `value ${index + 1}`),
  )
  await page.evaluate(
    `navigator.clipboard.writeText(${JSON.stringify(source)})`,
  )
  const root = page.getByRole('treeitem', { name: 'Blank document' })
  await root.click()
  await root.focus()
  await page.keyboard.press('Control+V')
  const first = page.getByRole('treeitem', { name: 'string value' }).first()
  const box = await first
    .locator(':scope > .tree-row > .row-reference')
    .boundingBox()
  if (!box) throw new Error('Missing drag source geometry')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2, 318, { steps: 6 })
  await expect(
    page.getByRole('contentinfo', { name: 'Editor status' }),
  ).toContainText('Drop')
  expect(
    await page.evaluate<number>('document.documentElement.scrollHeight'),
  ).toBeGreaterThan(320)
  await expect
    .poll(() => page.evaluate<number>('window.scrollY'))
    .toBeGreaterThan(0)
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await expect(
    page.getByRole('treeitem', { name: 'string value' }),
  ).toHaveCount(30)
})

async function dragRow(
  page: import('@playwright/test').Page,
  source: import('@playwright/test').Locator,
  target: import('@playwright/test').Locator,
  targetRatio: number,
): Promise<void> {
  const sourceBox = await source
    .locator(':scope > .tree-row > .row-reference')
    .boundingBox()
  const targetBox = await target.locator(':scope > .tree-row').boundingBox()
  if (!sourceBox || !targetBox) throw new Error('Missing drag row geometry')
  await page.mouse.move(
    sourceBox.x + sourceBox.width / 2,
    sourceBox.y + sourceBox.height / 2,
  )
  await page.mouse.down()
  await page.mouse.move(
    targetBox.x + targetBox.width / 2,
    targetBox.y + targetBox.height * targetRatio,
    { steps: 6 },
  )
  await page.mouse.up()
}
