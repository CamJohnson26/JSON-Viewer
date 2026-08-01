# JSON Viewer Implementation Schedule

> **Operating prompt:** Treat this file as the source of truth for project progress. Work from the first `TODO` downward unless a logged dependency requires otherwise. Before starting an item, read all earlier logs and the current item acceptance criteria. Change its status to `DONE` only after implementation and verification satisfy those criteria. Change it to `LOST` only when the work is intentionally abandoned, superseded, or impossible, and append the reason. Keep every log append-only: never edit or delete a prior entry, and add a dated correction instead. Never rewrite a `DONE` or `LOST` item's title, acceptance criteria, or historical log. As development reveals new information, revise, split, add, remove, or reorder only future `TODO` items, preserving dependencies and recording the reason in the nearest active item's log. Keep entries short and factual. Valid statuses are `TODO`, `DONE`, and `LOST`.

The schedule implements `JSON-Viewer-Plan.md`. A task is not `DONE` when code merely exists; its acceptance criteria and relevant automated checks must pass.

1. **[TODO] Specify the container inference contract**
   **Acceptance:** Document and approve the resulting strict JSON, visible layout, focus destination, and inverse event for one primitive, several primitives, named headers, repeated named headers, mixed content, shape conversion, and pasted arrays/objects. Every transition is deterministic and lossless.
   **Log (append-only):**

2. **[TODO] Scaffold the Vite React application**
   **Acceptance:** Create an npm-managed React and TypeScript Vite application that starts locally and produces a production build without SSR or backend code.
   **Log (append-only):**

3. **[TODO] Configure TypeScript and project quality tools**
   **Acceptance:** Enable strict TypeScript settings, linting, formatting, and consistent npm scripts for development, type checking, linting, testing, and building.
   **Log (append-only):**

4. **[TODO] Install the minimal application dependencies**
   **Acceptance:** Add React, Tailwind CSS, Base UI primitives, xState v5, and test tooling. Do not add MobX, WASM, virtualization, or other deferred dependencies.
   **Log (append-only):**

5. **[TODO] Create the domain-driven source hierarchy**
   **Acceptance:** Establish the `app`, `domain/document`, `domain/commands`, `domain/events`, `domain/reducer`, `domain/operations`, `infrastructure`, `state`, `interaction`, `components/tree`, `components/menus`, `components/layout`, `styles`, and `test` boundaries with enforceable dependency direction.
   **Log (append-only):**

6. **[TODO] Establish the visual tokens and minimal application shell**
   **Acceptance:** Define the muted pastel and earthy palette, typography, spacing, focus, selection, and primitive-format tokens in Tailwind. Render a restrained full-viewport editor shell with no banners or explanatory marketing content.
   **Log (append-only):**

7. **[TODO] Establish automated test infrastructure**
   **Acceptance:** Configure unit, property, component, and latest-Chrome browser tests with shared fixtures. Tests run through documented npm scripts.
   **Log (append-only):**

8. **[TODO] Define the normalized document model**
   **Acceptance:** Model stable node IDs, kind-neutral and inferred/imported containers, source primitive input, semantic JSON values, formatting overrides, ordered child IDs, and ordered keyed entries without exposing container kinds to UI components.
   **Log (append-only):**

9. **[TODO] Implement identity, parent lookup, and document invariants**
   **Acceptance:** Generate stable IDs and validate unique IDs, one root, valid parent/child relationships, ordered children, legal scalar/container states, and cycle absence.
   **Log (append-only):**

10. **[TODO] Implement strict JSON import parsing**
    **Acceptance:** Parse valid JSON into normalized nodes while preserving object order. Reject JSON5, comments, trailing commas, malformed input, excessive resource use, and duplicate object keys with typed errors.
    **Log (append-only):**

11. **[TODO] Implement canonical JSON materialization and serialization**
    **Acceptance:** Convert normalized documents to standard JSON and deterministic serialized text without leaking editor metadata. The blank root and provisional one-primitive state follow the approved inference contract.
    **Log (append-only):**

12. **[TODO] Implement primitive type detection**
    **Acceptance:** Pure, versioned functions detect strings, numbers, booleans, `null`, and approved unambiguous date-like strings while preserving source input and treating ambiguous input as a string.
    **Log (append-only):**

13. **[TODO] Implement additive primitive formatting**
    **Acceptance:** Pure formatters produce spreadsheet-inspired string, number, boolean, null, and date presentations. Formatting never alters source input and supports global and per-value overrides.
    **Log (append-only):**

14. **[TODO] Implement container inference transitions**
    **Acceptance:** Encode the approved action-sequence table as pure transitions for blank, provisional, ordered, and keyed shapes. Conflicting actions convert losslessly or return a typed error.
    **Log (append-only):**

15. **[TODO] Define versioned commands and domain events**
    **Acceptance:** Define serializable user-intent commands, minimal versioned mutation events, deterministic metadata for tests, and typed validation failures. Ephemeral UI signals remain outside the domain log.
    **Log (append-only):**

16. **[TODO] Implement the structurally shared document reducer**
    **Acceptance:** Apply every domain event as a pure function, update only affected normalized records, preserve invariants, and avoid deep cloning, serialization comparisons, or whole-document traversal for leaf edits.
    **Log (append-only):**

17. **[TODO] Implement command validation and event production**
    **Acceptance:** Commands validate targets and current revision, then emit complete event transactions without mutating state or containing UI notifications.
    **Log (append-only):**

18. **[TODO] Implement event inversion, transactions, and replay**
    **Acceptance:** Every document mutation can be undone and redone exactly. Text edits group at commit or an idle boundary, event replay reproduces state, and periodic snapshots can bound long replay histories.
    **Log (append-only):**

19. **[TODO] Implement the external document store**
    **Acceptance:** Provide `present`, `past`, `future`, `revision`, bounded event-log support, and URL-saved revision through a small store compatible with `useSyncExternalStore`.
    **Log (append-only):**

20. **[TODO] Implement focused document selectors**
    **Acceptance:** Provide stable selectors for individual nodes, paths, children, formatting, selection targets, and the flat visible-item projection without forcing unrelated component updates.
    **Log (append-only):**

21. **[TODO] Verify the document core**
    **Acceptance:** Unit and property tests cover parsing, materialization, primitive detection, formatting, all inference sequences, invariants, structural sharing, inversion, replay equivalence, and invalid commands.
    **Log (append-only):**

22. **[TODO] Define transient interaction machines**
    **Acceptance:** Use xState only where finite workflows clarify editing, context menus, import/export, and URL decoding. Focus, hover, and other ephemeral state do not enter document undo history.
    **Log (append-only):**

23. **[TODO] Render the blank root JSON Header**
    **Acceptance:** Initial load displays one collapsed, selectable, full-width blank header with no visible child content and no object/array terminology.
    **Log (append-only):**

24. **[TODO] Implement header expansion and ephemeral add input**
    **Acceptance:** Click and `Space` expand or collapse immediately. Expanded headers expose one blank input that becomes document data only on commit and disappears on cancellation or uncommitted blur.
    **Log (append-only):**

25. **[TODO] Implement graphical primitive editing**
    **Acceptance:** Users can add and edit strings, numbers, booleans, null, empty strings, and date-like strings. Focus reveals source input; commit applies inferred semantics as one undo transaction; `Escape` restores the prior value.
    **Log (append-only):**

26. **[TODO] Implement nested JSON Header editing**
    **Acceptance:** Users can add, name, edit, expand, collapse, and remove nested full-width headers. Their contents drive kind inference without presenting an object/array choice.
    **Log (append-only):**

27. **[TODO] Implement core node mutations**
    **Acceptance:** Rename, duplicate, delete, clear, wrap, and unwrap work through commands and remain lossless, undoable, replayable, and invariant-safe.
    **Log (append-only):**

28. **[TODO] Implement primitive presentation and formatting controls**
    **Acceptance:** Values have distinct but accessible presentations for strings, numbers, booleans, null, and date-like strings. Users can disable inferred formatting globally or per value without changing exported JSON.
    **Log (append-only):**

29. **[TODO] Implement base keyboard focus behavior**
    **Acceptance:** Roving focus supports `Enter`, `Escape`, `Tab`, and visible focus indicators without making every item a page tab stop.
    **Log (append-only):**

30. **[TODO] Implement hierarchical keyboard navigation**
    **Acceptance:** `ArrowUp/Down`, `ArrowLeft/Right`, `Home`, `End`, and `Space` navigate the visible hierarchy, enter/leave sections, and expand/collapse according to a documented model.
    **Log (append-only):**

31. **[TODO] Implement accessible hierarchy semantics**
    **Acceptance:** Tested tree or grouped-list semantics expose level, expansion, position, selection, editing, and error state to assistive technology despite the non-indented visual layout.
    **Log (append-only):**

32. **[TODO] Complete responsive editor styling**
    **Acceptance:** Headers remain full width, recursion remains vertically legible without indentation, long values have a usable overflow treatment, and the page has no horizontal viewport overflow at narrow widths.
    **Log (append-only):**

33. **[TODO] Implement single and multiple selection**
    **Acceptance:** Click selects, `Shift` selects a visible sibling range, and `Ctrl/Cmd` toggles additive selection. Selection survives unrelated edits through stable IDs and reports a count.
    **Log (append-only):**

34. **[TODO] Define and implement contextual clipboard serialization**
    **Acceptance:** A single node copies its value, keyed sibling selections copy a valid object fragment, and ordered or mixed selections copy a valid array. The context table is isolated and unit-tested.
    **Log (append-only):**

35. **[TODO] Implement contextual JSON paste**
    **Acceptance:** Ordinary paste intuitively inserts into or beside the focused target; active primitive editing and explicit commands support replacement. Invalid or duplicate-key input leaves the document unchanged and shows an inline typed error.
    **Log (append-only):**

36. **[TODO] Implement the accessible context menu**
    **Acceptance:** Base UI primitives render only commands valid for the current selection, support right click and keyboard opening, restore focus correctly, and dispatch domain commands rather than mutating state.
    **Log (append-only):**

37. **[TODO] Implement structural utility operations**
    **Acceptance:** Add value, add nested header, duplicate, rename, convert, wrap, unwrap, move up/down, move to another container, reverse children, flatten nested values, remove empty values, remove selection, and clear container are pure, undoable operations with typed failures.
    **Log (append-only):**

38. **[TODO] Implement text utility operations**
    **Acceptance:** Uppercase, lowercase, title case, trim, find/replace, prefix/suffix, parse escaped string, and escape string operate predictably over valid selections and preserve unaffected data.
    **Log (append-only):**

39. **[TODO] Implement primitive conversion and generation operations**
    **Acceptance:** String-to-number/boolean/null, date recognition override, number formatting, UUID generation, timestamp generation, boolean toggle, and number increment/decrement are pure and undoable.
    **Log (append-only):**

40. **[TODO] Implement sorting and collection operations**
    **Acceptance:** Sort by header/value/nested value, filter, deduplicate, group, and persistent reorder preserve deterministic ordering and produce one undoable transaction per invocation.
    **Log (append-only):**

41. **[TODO] Implement merge, diff, and extraction operations**
    **Acceptance:** Shallow merge, deep merge, diff, extract keys, extract values, rename path segments, and select matching values define conflict behavior and return deterministic results or typed errors.
    **Log (append-only):**

42. **[TODO] Implement the command palette and shortcuts**
    **Acceptance:** Every applicable context-menu operation is discoverable through a searchable keyboard-accessible palette, with conflict-free shortcuts and correct enablement for current selection.
    **Log (append-only):**

43. **[TODO] Implement keyboard-only node movement**
    **Acceptance:** Users can reorder and reparent selected values and headers without pointer or touch dragging. Invalid cycles and illegal targets are rejected without mutation.
    **Log (append-only):**

44. **[TODO] Implement navigation utility commands**
    **Acceptance:** Focus path, show source path, expand descendants, collapse descendants, expand all, and collapse all work with virtualized and non-virtualized projections.
    **Log (append-only):**

45. **[TODO] Implement graphical JSON file import and export**
    **Acceptance:** Strict JSON files can populate the graphical editor, and current canonical JSON can download as a file. There is no raw JSON editing surface; errors never replace the current document.
    **Log (append-only):**

46. **[TODO] Implement the versioned URL codec**
    **Acceptance:** Canonical JSON round-trips through a compressed Base64URL payload shaped as `?v=1&d=...`, with typed version, corruption, and decompression errors and no server dependency.
    **Log (append-only):**

47. **[TODO] Load and recover URL document state**
    **Acceptance:** A missing payload loads the blank root, a valid payload loads its document, and an invalid payload preserves the URL while presenting a recoverable error without executing imported content.
    **Log (append-only):**

48. **[TODO] Persist revisions to the URL**
    **Acceptance:** Debounced `history.replaceState` writes do not create per-keystroke history entries. Success updates `urlSavedRevision`; oversized payloads or API failures preserve in-memory edits and visibly mark them unsaved.
    **Log (append-only):**

49. **[TODO] Implement share URL and reset actions**
    **Acceptance:** Copy share URL reflects the latest URL-saved revision. New/reset requests confirmation only when the current revision is not represented in the URL.
    **Log (append-only):**

50. **[TODO] Implement the compact editor status surface**
    **Acceptance:** A non-banner status area reports current path, selection count, inline errors, and URL persistence state without exposing inferred object/array kinds.
    **Log (append-only):**

51. **[TODO] Add input and resource-exhaustion guards**
    **Acceptance:** URL, clipboard, and file inputs are treated as untrusted. Decompression and recursive operations fail safely before blocking the client, without imposing an arbitrary normal-document product limit.
    **Log (append-only):**

52. **[TODO] Add a cancellable Web Worker boundary**
    **Acceptance:** Expensive non-interactive parsing, compression, diffing, or bulk work can use a versioned, cancellation-aware worker protocol, and stale results cannot overwrite newer revisions. Only measured tasks are moved into it.
    **Log (append-only):**

53. **[TODO] Add threshold-based visible-item virtualization**
    **Acceptance:** Local profiling establishes a row-count threshold. Documents below it use direct rendering; larger visible projections virtualize while preserving focus, selection, expansion, accessibility, and navigation commands.
    **Log (append-only):**

54. **[TODO] Complete domain and operation test coverage**
    **Acceptance:** Every pure operation, typed failure, event inverse, replay path, strict JSON boundary, URL codec case, copy/paste context, and resource guard has focused automated coverage.
    **Log (append-only):**

55. **[TODO] Complete browser interaction tests**
    **Acceptance:** Latest-Chrome tests cover the blank start, editing and inference sequences, undo/redo, keyboard navigation and movement, selection, clipboard behavior, menus, palette, file I/O, URL persistence, and recovery.
    **Log (append-only):**

56. **[TODO] Complete the accessibility audit**
    **Acceptance:** Automated and manual checks cover semantics, focus order and restoration, full keyboard operation, contrast, non-color state indicators, errors, and `prefers-reduced-motion`; critical findings are fixed.
    **Log (append-only):**

57. **[TODO] Profile and tune production performance**
    **Acceptance:** Repeatable local fixtures measure small, medium, and large documents in a production build. Leaf edits meet the one-frame target for normal documents, navigation has no visible lag, and memory growth tracks document plus retained history.
    **Log (append-only):**

58. **[TODO] Decide whether any measured hot path requires WASM**
    **Acceptance:** Record profiling evidence and either keep TypeScript/Workers or add a narrow WASM boundary that demonstrably improves a critical operation after transfer and loading costs. Unjustified WASM work is marked `LOST`, not implemented speculatively.
    **Log (append-only):**

59. **[TODO] Validate the latest stable Chrome release target**
    **Acceptance:** The production build passes all supported workflows in the latest stable Chrome, uses standards-based browser APIs where available, and has no backend, SSR, analytics, local storage, or IndexedDB dependency.
    **Log (append-only):**

60. **[TODO] Prepare the V1 release**
    **Acceptance:** Type checking, linting, automated tests, and production build pass; release behavior matches the resolved V1 scope; deferred features remain absent; known limitations and any `LOST` schedule items are recorded without rewriting history.
    **Log (append-only):**
