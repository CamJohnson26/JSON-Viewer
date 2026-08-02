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
  const nestedComposer = page.getByRole('textbox', { name: 'Add value' }).nth(0)
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
