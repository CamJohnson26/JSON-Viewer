import { expect, test } from 'vitest'

import { nodeId, parseJson, type NodeId } from '../document/index.ts'
import { createPatchEvent, invertEvent } from '../events/index.ts'
import { reduceDocument, replayEvents } from './index.ts'

test('reducer structurally shares untouched records and replay matches sequential reduction', () => {
  let sequence = 0
  const parsed = parseJson('[1,2]', {}, () => nodeId(`id-${sequence++}`))
  if (!parsed.ok) throw new Error(parsed.error.message)
  const before = parsed.document
  const targetId = Object.values(before.nodes).find(
    (node) => node.type === 'primitive' && node.value === 1,
  )?.id as NodeId
  const target = before.nodes[targetId]
  if (target?.type !== 'primitive') throw new Error('Missing primitive')
  const after = {
    ...before,
    nodes: {
      ...before.nodes,
      [targetId]: { ...target, sourceInput: '10', value: 10 },
    },
  }
  const event = createPatchEvent(before, after, {
    eventId: 'event',
    occurredAt: '2026-08-01T00:00:00.000Z',
  })
  const reduced = reduceDocument(before, event)

  expect(event.records).toHaveLength(1)
  for (const id of Object.keys(before.nodes) as NodeId[]) {
    if (id !== targetId) expect(reduced.nodes[id]).toBe(before.nodes[id])
  }
  expect(reduceDocument(reduced, invertEvent(event))).toEqual(before)
  expect(replayEvents(before, [event, invertEvent(event)])).toEqual(before)
  expect(() => reduceDocument(reduced, event)).toThrow(
    'Event record does not match current node',
  )

  expect(() =>
    reduceDocument(before, {
      ...event,
      version: 99 as 1,
    }),
  ).toThrow('Unsupported domain event')

  expect(() =>
    reduceDocument(before, {
      ...event,
      records: [
        event.records[0] as (typeof event.records)[number],
        event.records[0] as (typeof event.records)[number],
      ],
    }),
  ).toThrow('patches a node more than once')

  expect(() =>
    reduceDocument(before, {
      ...event,
      records: [
        {
          ...(event.records[0] as (typeof event.records)[number]),
          after: {
            ...(event.records[0]?.after as NonNullable<
              (typeof event.records)[number]['after']
            >),
            id: nodeId('wrong-id'),
          },
        },
      ],
    }),
  ).toThrow('Event after record has the wrong ID')

  expect(() =>
    reduceDocument(before, {
      ...event,
      records: [
        {
          id: nodeId('orphan'),
          before: null,
          after: {
            id: nodeId('orphan'),
            type: 'primitive',
            sourceInput: '1',
            value: 1,
            detectedKind: 'number',
            formatting: 'inherit',
          },
        },
      ],
    }),
  ).toThrow('Node is not reachable from the root')

  const malformedPrimitive = {
    ...event,
    records: [
      {
        ...(event.records[0] as (typeof event.records)[number]),
        after: {
          ...(event.records[0]?.after as NonNullable<
            (typeof event.records)[number]['after']
          >),
          formatting: 'invalid' as 'inherit',
        },
      },
    ],
  }
  expect(() => reduceDocument(before, malformedPrimitive)).toThrow(
    'invalid primitive metadata',
  )
  expect(() => JSON.stringify(reduceDocument(before, event))).not.toThrow()
  expect(() =>
    reduceDocument(before, {
      ...event,
      metadata: {
        ...event.metadata,
        eventId: 1n as unknown as string,
      },
    }),
  ).toThrow('metadata is incomplete')
})
