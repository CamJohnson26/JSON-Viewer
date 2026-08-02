# Editor Keyboard Model V1

The document uses one roving tree focus. Expansion, focus, drafts, and formatting preference are transient and do not enter document history.

| Key                           | Result                                                                                        |
| ----------------------------- | --------------------------------------------------------------------------------------------- |
| `ArrowDown`                   | Focus the next visible document item.                                                         |
| `ArrowUp`                     | Focus the previous visible document item.                                                     |
| `ArrowRight`                  | Expand a collapsed header; otherwise focus its first child or open an add session when empty. |
| `ArrowLeft`                   | Collapse an expanded header; otherwise focus its parent.                                      |
| `Home`                        | Focus the root header.                                                                        |
| `End`                         | Focus the last visible document item.                                                         |
| `Space`                       | Toggle the focused header.                                                                    |
| `Enter`                       | Open one value-add session inside a header or beneath a value.                                |
| `Alt+Enter`                   | Open one header-add session inside a header or beneath a value.                               |
| Printable character           | Start direct editing on a value or non-root header.                                           |
| `F2`                          | Edit a value or rename a non-root header.                                                     |
| `Delete`                      | Remove the focused non-root item.                                                             |
| `Ctrl/Cmd+D`                  | Duplicate the focused non-root item.                                                          |
| `Ctrl/Cmd+Z`                  | Undo the latest transaction.                                                                  |
| `Ctrl/Cmd+Shift+Z`            | Redo the latest undone transaction.                                                           |
| `Ctrl/Cmd+Shift+P`            | Open the searchable command palette.                                                          |
| `Ctrl/Cmd+Space`              | Add or remove the focused item from the selection.                                            |
| `Shift+ArrowUp/Down`          | Extend selection across visible siblings.                                                     |
| `Ctrl/Cmd+Shift+ArrowUp/Down` | Move selected siblings earlier or later.                                                      |
| `Ctrl/Cmd+Shift+ArrowRight`   | Move selection into the preceding header.                                                     |
| `Ctrl/Cmd+Shift+ArrowLeft`    | Move selection out to the containing header's parent.                                         |
| `Escape`                      | Cancel editing, or clear and close a composer while restoring header focus.                   |

Inline editors commit with `Enter` or changed blur and cancel with `Escape`. An add session has a fixed value or header mode, commits with `Enter`, and cancels without mutation on blur or `Escape`. Expanded headers do not render add controls until a keyboard or menu command requests one.

After mutation, focus follows the command hint. Undo and redo retain the active item when it survives; otherwise they choose an unwrapped child, the item at the prior visible position, or the root in that order.
