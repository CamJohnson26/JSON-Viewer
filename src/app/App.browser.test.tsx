import { expect, test } from 'vitest'
import { render } from 'vitest-browser-react'

import { editorLabels } from '../test/fixtures/editor'
import { App } from './App'

test('renders the minimal editor shell', async () => {
  const screen = await render(<App />)

  await expect
    .element(screen.getByRole('main', { name: editorLabels.main }))
    .toBeVisible()
  await expect
    .element(screen.getByRole('contentinfo', { name: editorLabels.status }))
    .toHaveTextContent('Ready')
})
