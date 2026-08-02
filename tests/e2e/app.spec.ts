import { expect, test } from '@playwright/test'

import { editorLabels } from '../../src/test/fixtures/editor'

test('completes a graphical nested editing workflow', async ({ page }) => {
  await page.goto('/')

  const root = page.getByRole('treeitem', { name: 'Blank document' })
  await root.click()
  const rootComposer = page.getByRole('textbox', { name: 'Add value' })
  await rootComposer.fill('profile')
  await rootComposer.press('Alt+Enter')
  const header = page.getByRole('treeitem', { name: 'profile' })
  await expect(header).toHaveAttribute('aria-expanded', 'true')
  const nestedComposer = page.getByRole('textbox', { name: 'Add value' }).nth(1)
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
  await page.getByRole('treeitem', { name: 'Blank document' }).click()
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
})

test('completes a selection clipboard menu and palette workflow', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/')
  const root = page.getByRole('treeitem', { name: 'Blank document' })
  await root.click()
  const composer = page.getByRole('textbox', { name: 'Add value' })
  for (const value of [' first ', ' second ']) {
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

test('undoes an add while the empty composer retains focus', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('treeitem', { name: 'Blank document' }).click()
  const composer = page.getByRole('textbox', { name: 'Add value' })
  await composer.fill('undo me')
  await composer.press('Enter')
  await expect(
    page.getByRole('treeitem', { name: 'string value' }),
  ).toBeVisible()
  await expect(composer).toBeFocused()

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
  await page.getByRole('treeitem', { name: 'Blank document' }).click()
  const composer = page.getByRole('textbox', { name: 'Add value' })
  for (const value of ['first', 'second']) {
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
