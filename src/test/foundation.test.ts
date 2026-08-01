import fc from 'fast-check'
import { describe, expect, test } from 'vitest'

describe('strict JSON fixtures', () => {
  test('round-trip generated JSON values', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const serialized = JSON.stringify(value)

        expect(JSON.stringify(JSON.parse(serialized))).toBe(serialized)
      }),
    )
  })
})
