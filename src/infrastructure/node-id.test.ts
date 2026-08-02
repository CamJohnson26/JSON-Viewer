import { expect, test } from 'vitest'

import {
  createEventMetadata,
  createNodeId,
  createTimestamp,
  createUuid,
} from './node-id.ts'

test('creates stable UUID node IDs', () => {
  const ids = Array.from({ length: 100 }, createNodeId)

  expect(new Set(ids)).toHaveLength(ids.length)
  for (const id of ids) expect(id).toMatch(/^[0-9a-f-]{36}$/)
})

test('creates operation generation values and event metadata', () => {
  expect(createUuid()).toMatch(/^[0-9a-f-]{36}$/)
  expect(Number.isNaN(Date.parse(createTimestamp()))).toBe(false)
  const metadata = createEventMetadata()
  expect(metadata.eventId).toMatch(/^[0-9a-f-]{36}$/)
  expect(metadata.occurredAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
})
