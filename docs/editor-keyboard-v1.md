# Editor Keyboard Model V1

The document uses one roving tree focus. Expansion, focus, drafts, and formatting preference are transient and do not enter document history.

| Key                | Result                                                                      |
| ------------------ | --------------------------------------------------------------------------- |
| `ArrowDown`        | Focus the next visible document item.                                       |
| `ArrowUp`          | Focus the previous visible document item.                                   |
| `ArrowRight`       | Expand a collapsed header; otherwise focus its first child or composer.     |
| `ArrowLeft`        | Collapse an expanded header; otherwise focus its parent.                    |
| `Home`             | Focus the root header.                                                      |
| `End`              | Focus the last visible document item.                                       |
| `Space`            | Toggle the focused header.                                                  |
| `Enter`            | Edit a value or open/focus a header composer.                               |
| `F2`               | Rename a non-root header.                                                   |
| `Delete`           | Remove the focused non-root item.                                           |
| `Ctrl/Cmd+D`       | Duplicate the focused non-root item.                                        |
| `Ctrl/Cmd+Z`       | Undo the latest transaction.                                                |
| `Ctrl/Cmd+Shift+Z` | Redo the latest undone transaction.                                         |
| `Escape`           | Cancel editing, or clear and close a composer while restoring header focus. |

Inline editors commit with `Enter` or changed blur and cancel with `Escape`. Composer `Enter` adds a value, including an empty string; `Alt+Enter` adds a JSON Header. Tabbing reaches visible controls using native browser order, then returns to the single active tree item on the next tree entry.

After mutation, focus follows the command hint. Undo and redo retain the active item when it survives; otherwise they choose an unwrapped child, the item at the prior visible position, or the root in that order.
