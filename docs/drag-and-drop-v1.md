# Drag-and-Drop Model V1

Drag-and-drop is a desktop pointer alternative to the existing keyboard movement commands. It changes document structure only when a valid drop completes.

## Sources

- Values and non-root headers can be dragged.
- Dragging a selected row moves the current selection roots in document order. Dragging an unselected row moves only that row.
- Ancestor-selected descendants are omitted. Mixed-parent roots are allowed and become one ordered block.
- The root cannot move. Stable node IDs, complete subtrees, captions, source values, and formatting metadata move together.

## Destinations

- The upper edge of a row inserts the block before it.
- The lower edge inserts the block after it.
- The middle of a collection header inserts the block at the end of that header.
- The root is an inside-only destination. Single-value headers cannot contain another child.
- An inside drop on a collapsed header reveals it. Hovering there briefly also reveals it without changing the document.

Before and after indexes are measured against the document before source removal. The domain move operation compensates for selected siblings before the requested index.

## Validation

- A source, its descendants, and a source row used as its own before/after target are invalid destinations.
- Object-shaped destinations accept only uniquely captioned headers. Existing unselected captions and captions within the moved block cannot collide.
- Empty neutral headers infer their shape from the moved block.
- Invalid targets and cancelled gestures never mutate the document or create undo history.

## Completion

- A drop is one `structure.move-to` operation and one undoable transaction.
- The moved roots remain selected in document order, and focus follows the first moved root.
- `Escape`, pointer cancellation, window blur, or source-document changes cancel the gesture.
- Moving near the viewport edge scrolls the page. Click, double-click editing, menus, text controls, and keyboard movement retain their existing behavior.

Touch drag behavior is not part of this contract. Keyboard commands remain the accessible movement path.
