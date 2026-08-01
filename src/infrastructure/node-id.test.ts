import { expect, test } from 'vitest'

import { createNodeId } from './node-id.ts'

test('creates stable UUID node IDs', () => {
  const ids = Array.from({ length: 100 }, createNodeId)

  expect(new Set(ids)).toHaveLength(ids.length)
  for (const id of ids) expect(id).toMatch(/^[0-9a-f-]{36}$/)
})
