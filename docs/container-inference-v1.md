# Container Inference Contract V1

This contract defines how graphical actions become strict JSON. The UI uses only JSON Headers and values; it never asks users to choose an object or array.

## Terms

- **Header:** A full-width, collapsible container. It may have a caption.
- **Value:** A direct primitive child.
- **Add input:** The ephemeral final input under an expanded header.
- **Neutral:** A new header whose contents have not established a shape.
- **Known kind:** The array or object shape retained when strict JSON is imported or pasted.

Captions are edited directly and are not labeled as keys. Hierarchy is shown through vertical grouping and header boundaries, never indentation.

## Rules

1. A neutral empty header provisionally materializes as `[]`.
2. A header containing only direct values materializes as an ordered array, including when it has one value.
3. A captioned header with one direct value contributes its caption and scalar value to a keyed parent.
4. A captioned header with multiple children contributes its caption and recursively materialized content.
5. A header containing only uniquely captioned child headers materializes as an object in visible order.
6. Mixed direct values, blank headers, and captioned headers materialize as an array in visible order.
7. In mixed content, a captioned header materializes as a singleton object. The wrapper is derived and is not another visible node.
8. A blank nested header contributes its recursively materialized content as one ordered item.
9. Sibling caption collisions are rejected before mutation. Existing data is never overwritten or silently deduplicated.
10. Imported empty arrays and objects retain their known kind internally while remaining visually unlabeled.
11. Inference changes preserve node IDs and visible order. They never discard captions or values.
12. Focus is ephemeral and never enters domain events or undo history.

## Action Sequences

### One Primitive

- **Actions:** Expand the blank root and commit `1`.
- **JSON:** `[1]`
- **Layout:** Blank root header, `1`, focused root add input.
- **Focus:** Fresh add input in the root.
- **Inverse:** Remove the inserted value and restore the neutral root.

### Several Primitives

- **Actions:** Commit `1`, `2`, and `3` under the blank root.
- **JSON:** `[1, 2, 3]`
- **Layout:** Blank root header, values in insertion order, focused root add input.
- **Focus:** Fresh add input in the root after each commit.
- **Inverse:** Remove each transaction's inserted value and restore the prior representation.

### One Captioned Header

- **Actions:** Add a header captioned `a`, then commit `1` inside it.
- **JSON:** `{"a": 1}`
- **Layout:** Blank root header, header `a`, value `1`, child add input, root add input.
- **Focus:** Add input inside `a`.
- **Inverse:** Remove the value, then the created header when undoing the complete action sequence. Undoing only the value restores `{"a": []}`.

### Repeated Captioned Headers

- **Actions:** Add `a` containing `1`, then `b` containing `2`.
- **JSON:** `{"a": 1, "b": 2}`
- **Layout:** Blank root header followed by the expanded `a` and `b` sections in insertion order.
- **Focus:** Add input inside `b`.
- **Inverse:** Remove inserted subtrees in reverse order. Undoing `b` restores `{"a": 1}`.

### Mixed Content

- **Actions:** Add `1`, then add header `a` containing `2`.
- **JSON:** `[1, {"a": 2}]`
- **Layout:** Blank root header, value `1`, expanded header `a`, value `2`, add inputs.
- **Focus:** Add input inside `a`.
- **Inverse:** Remove the inserted subtree and restore `[1]`.

- **Actions:** Add header `a` containing `1`, then add `2` to the root.
- **JSON:** `[{"a": 1}, 2]`
- **Layout:** Blank root header, expanded header `a`, value `1`, root value `2`, add inputs.
- **Focus:** Root add input.
- **Inverse:** Remove `2` and restore `{"a": 1}`.

## Shape Conversion

Shape changes occur through visible wrap and unwrap actions, not a type selector.

### Ordered To Keyed

Starting from `[1, 2]`:

1. Wrap `1` in header `a`. JSON becomes `[{"a": 1}, 2]`; layout becomes header `a` containing `1`, followed by `2`; focus moves to `a`. The inverse unwraps `a` and restores `[1, 2]` with focus on `1`.
2. Wrap `2` in header `b`. JSON becomes `{"a": 1, "b": 2}`; layout becomes headers `a` and `b` in order; focus moves to `b`. The inverse unwraps `b` and restores `[{"a": 1}, 2]` with focus on `2`.

### Keyed To Ordered

Starting from `{"a": 1, "b": 2}`:

1. Unwrap `a`. JSON becomes `[1, {"b": 2}]`; layout becomes `1` followed by header `b`; focus moves to `1`. The inverse rewraps `1` with retained caption `a` and restores the original object.
2. Unwrap `b`. JSON becomes `[1, 2]`; layout becomes `1` followed by `2`; focus moves to `2`. The inverse rewraps `2` with retained caption `b` and restores `[1, {"b": 2}]`.

Every inverse retains the prior caption, position, IDs, and representation metadata.

## Paste

**Paste into** consumes a pasted collection's outer wrapper and inserts its top-level members. **Paste beside** inserts the pasted root as one nested value and preserves its outer wrapper.

### Blank Header

- Pasting `[1, 2]` into the root produces `[1, 2]` and focuses `1`.
- Pasting `{"a": 1, "b": [2]}` produces the same object as captioned headers and focuses `a`.
- Pasting `[]` or `{}` adopts that exact known empty kind and focuses the header.

### Populated Header

- Pasting `[1, 2]` into `[0]` produces `[0, 1, 2]`.
- Pasting `{"b": 1}` into `{"a": 0}` produces `{"a": 0, "b": 1}`.
- Pasting `{"b": 1}` into `[0]` produces `[0, {"b": 1}]`.
- Pasting `[1, 2]` into `{"a": 0}` produces `[{"a": 0}, 1, 2]`.
- Pasting a colliding caption rejects the entire transaction.
- Pasting an empty collection into populated content returns `NothingToInsert`; paste beside remains available.

Paste focuses the first inserted visible item. Its inverse removes all inserted IDs, restores prior representation metadata, and retains removed subtrees for exact redo.

### Paste Beside

Paste beside preserves the pasted root as one nested sibling:

- Beside `0` in `[0]`, pasting `[1, 2]` produces `[0, [1, 2]]`. The nested pasted header is focused. Its inverse removes that header and restores `[0]`.
- Beside `a` in `{"a": 0}`, pasting `{"b": 1}` produces `[{"a": 0}, {"b": 1}]`. Header `b` is focused. Its inverse removes `b` and restores `{"a": 0}`.
- Beside `a` in `{"a": 0}`, pasting `[1, 2]` produces `[{"a": 0}, [1, 2]]`. The nested pasted header is focused. Its inverse removes it and restores `{"a": 0}`.
- Paste beside on a neutral root adopts the pasted value as the root while preserving its known kind. The root remains focused. Its inverse restores the neutral root.

The inserted collection is shown as one nested full-width header. Its children appear vertically when expanded. No additional wrapper row is displayed.

## Required Tests

Tests must cover each action sequence, both insertion orders for mixed content, every conversion step, empty known kinds, caption collisions, paste into, paste beside, exact inverses, focus destinations, stable IDs, and valid strict JSON materialization.
