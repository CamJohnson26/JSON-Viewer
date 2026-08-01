import { expect, test } from '@playwright/test'

import { editorLabels } from '../../src/test/fixtures/editor'

test('loads the editor shell', async ({ page }) => {
  await page.goto('/')

  await expect(
    page.getByRole('main', { name: editorLabels.main }),
  ).toBeVisible()
  await expect(
    page.getByRole('contentinfo', { name: editorLabels.status }),
  ).toContainText('Ready')
})
