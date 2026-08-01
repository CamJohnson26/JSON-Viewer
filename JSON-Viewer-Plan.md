# JSON Viewer Plan

## Validation Summary

The product direction is sound: a local-first, keyboard-friendly tree editor with a compact visual language is a good fit for a browser-only application. The performance goal is achievable if the editor treats the JSON document as a persistent data model, renders only the visible tree, and makes every mutation a small command rather than reparsing and rerendering the entire document.

Several requested technologies overlap:

- **React + TypeScript + Vite + Tailwind:** keep these.
- **BaseUI:** use its accessible primitives where they add value, especially menus, dialogs, popovers, and tooltips. Do not force every tree row through a heavyweight component abstraction. Tailwind owns visual styling.
- **xState:** use xState v5 for finite UI workflows such as context menus, keyboard navigation modes, drag/drop, import/export, and URL decoding states. It is not the best authoritative document store.
- **MobX and Observables:** do not use MobX initially. MobX adds a second reactive model beside React and makes event replay, serialization, and deterministic testing less direct. A small event-sourced store with `useSyncExternalStore` is a better fit. Revisit MobX only after profiling shows a real need.
- **WebAssembly:** do not add WASM in the first milestone. Parsing, compression, search, and tree edits should remain TypeScript until profiling identifies a hot path. WASM call overhead, memory copies, loading, and packaging can make small operations slower.

## Product Decisions To Lock Down

### JSON Semantics

JSON has only `null`, boolean, number, string, array, and object. It has no native date type. Date detection should therefore be display metadata, not a silent conversion:

- Preserve the underlying value as a JSON string.
- Detect likely ISO dates for formatting and filtering.
- Let the user explicitly convert a string to another representation only when requested.
- Never infer a number, boolean, or date merely because a string looks like one without an explicit conversion action.

This prevents data loss and makes import/export deterministic.

### Tree Editing Model

The current “blank input under each header” concept needs a precise grammar. The recommended model is:

- The root starts as an empty object-or-array choice represented by an empty root header.
- Every container has an explicit add row. It is not a real child until committed.
- Object children have separate key and value editors. Array children have a value editor and an order position.
- A single click focuses a row; `Space` toggles a container; `Enter` edits; `Escape` cancels; `Tab` moves through editable fields.
- Empty committed strings remain valid JSON strings. Empty add rows are discarded on blur or `Escape`.
- Type conversion is explicit through a type picker or context action. Inference may suggest a type but must not unexpectedly change data.
- `null` is rendered distinctly from an empty value and cannot be confused with an empty add row.

This is more predictable than deriving “object versus array” from the number of values under a header.

### Selection and Movement

- Use stable node IDs, not array indexes or object keys, for selection, focus, drag state, and undo targets.
- Support click, `Shift` range selection among visible siblings, and `Ctrl/Cmd` additive selection.
- Dragging must show a clear before/inside/after drop target and reject invalid cycles, such as dropping a parent into its descendant.
- Keyboard movement should have a documented tree model: `ArrowUp/Down` moves visible rows, `ArrowLeft/Right` collapses or enters/leaves containers, `Home/End` moves within the visible tree, and `Space` toggles expansion.

### URL Sharing

Use a URL-safe compressed payload rather than ordinary Base64. The recommended shape is:

`/?v=1&d=<base64url-compressed-json>`

- Include a format version for future migrations.
- Compress the canonical JSON document, not UI state such as expansion and selection.
- Use `history.replaceState` with debouncing so typing does not create a browser-history entry per keystroke.
- Enforce a payload size limit and show a clear error when a document cannot fit in a URL.
- Use Web Crypto or a small audited library only if encryption is later required; compression is not privacy.
- If a URL payload is absent, load the blank root. If it is invalid, preserve the URL and show a recoverable import error.

## Recommended Architecture

Use domain-driven modules with a small dependency direction:

```text
src/
  app/                 Bootstrap, routes, providers, global styles
  domain/document/     JSON tree model, node IDs, invariants
  domain/commands/     User-intent commands and validation
  domain/events/       Versioned events and event metadata
  domain/reducer/      Pure event application and derived selectors
  domain/operations/   Pure JSON transformations and clipboard formats
  infrastructure/      URL codec, clipboard, persistence, WASM boundary
  state/               Event store, undo/redo, replay, subscriptions
  interaction/         xState machines for transient workflows
  components/tree/     Virtualized tree, rows, editors, drag targets
  components/menus/    Context menu and command palette
  components/layout/   Minimal shell and status elements
  styles/              Tailwind theme and editor tokens
  test/                Fixtures, generators, integration helpers
```

The UI dispatches commands. A command validates intent and produces one or more versioned events. The reducer applies events to the immutable document. Selectors derive visible rows and values. No component should mutate the document directly.

### Document Store

Implement a small external store around:

- `present`: current document state
- `past`: grouped event transactions for undo
- `future`: redo transactions
- `revision`: monotonically increasing event revision
- `eventLog`: optionally bounded in memory for replay and diagnostics
- `savedRevision` or dirty state

Expose the store through `useSyncExternalStore`. Group a text edit into one transaction after a short idle boundary or on commit; do not create an undo item for every keypress. Keep the event log append-only within the session and use deterministic event IDs for replay tests.

Avoid serializing full document snapshots into every event. Events should address stable node IDs and contain the minimum before/after data required for inversion. A periodic snapshot can bound replay cost for very large documents.

### Data Structure

Use a normalized document internally:

- Nodes are keyed by stable ID.
- Each node stores its JSON kind and scalar value or ordered child IDs.
- Objects store ordered key/value child entries so visual order is retained.
- Parent IDs and child indexes are derived or maintained by reducer invariants.
- Export recursively materializes standard JSON.

This avoids copying the entire nested tree for a leaf edit and makes moves, selection, and references stable. Keep the normalized model private; the import/export boundary remains standard JSON.

Use structural sharing in reducer updates. Do not use a deep clone, `JSON.stringify` comparison, or full-tree traversal on every keystroke.

## Rendering and Interaction

- Render a flat visible-row projection from expanded nodes, then virtualize only when document size requires it. For small documents, a simple list is faster and easier to debug.
- Add a virtualization threshold based on measured row count rather than enabling virtualization unconditionally.
- Keep row components keyed by stable node ID.
- Subscribe rows to the smallest selector possible so an edit does not rerender unrelated rows.
- Use CSS transitions sparingly. Expansion and editing feedback must remain immediate and respect `prefers-reduced-motion`.
- Make the tree a real keyboard-accessible tree with `role="tree"`, `role="treeitem"`, `aria-expanded`, `aria-level`, `aria-setsize`, and `aria-posinset` where applicable.
- Use roving `tabIndex` or an equivalent active-descendant strategy. Do not make every row a separate tab stop.
- Provide a compact status bar for node type, path, dirty state, errors, and selection count instead of banners or explanatory copy.
- Support a narrow-screen layout without horizontal page overflow. Long strings should wrap or expose an inline overflow treatment.

## Editing and Clipboard

Support both graphical editing and raw JSON workflows:

- Copy selected node(s) as valid JSON. A single node copies its value; multiple sibling selections copy an array unless the user chooses a structured object export.
- Paste valid JSON as a replacement, child insertion, or sibling insertion depending on focused target and chosen command.
- On invalid paste, show an inline parse error and leave the document unchanged.
- Provide a raw JSON editor/import dialog for bulk edits. Parse off the main thread for large payloads if profiling warrants it.
- Define how object keys are copied, pasted, renamed, and deduplicated. Default to rejecting duplicate keys rather than silently overwriting.

## Context Menu and Command Catalogue

The right-click menu should expose commands appropriate to the current selection. Also expose the same commands through a searchable command palette and keyboard shortcuts; context menus alone are not discoverable or accessible.

### Structure

- Add object property
- Add array item
- Add nested object
- Add nested array
- Duplicate
- Rename key
- Convert type
- Wrap selection in object or array
- Unwrap container
- Move up/down
- Move to parent or another container
- Sort object keys
- Reverse array
- Flatten array
- Remove empty values
- Remove selected nodes
- Clear container

### Text and Values

- Uppercase
- Lowercase
- Title case
- Trim whitespace
- Find and replace
- Add or remove a prefix/suffix
- Parse escaped string
- Escape string
- Convert string to number, boolean, null, or date-display metadata
- Format number
- Generate or replace UUID
- Generate timestamp
- Toggle boolean
- Increment/decrement number

### Data Operations

- Sort by key
- Sort by value
- Sort array by a selected property
- Filter array by value or property
- Remove duplicate array items
- Group array items by property
- Merge objects
- Deep merge selected objects
- Diff selected objects
- Extract keys
- Extract values
- Rename a path segment
- Select all matching values
- Validate against JSON Schema, if schema support is added

### I/O and Navigation

- Copy raw JSON
- Paste and replace
- Paste as child
- Import JSON file
- Export JSON file
- Copy share URL
- Focus path
- Expand descendants
- Collapse descendants
- Expand all / collapse all
- Show source path

Operations must be pure functions over a document selection and return either a new document plus an operation summary or a typed validation error. Keep UI notifications outside the domain functions.

## Performance Strategy

Define budgets before optimizing:

- Leaf edit acknowledgement: under one animation frame for normal documents.
- Keyboard navigation: no visible lag at the target document size.
- Initial render and URL decode: measured separately from browser startup.
- Memory and maximum supported document size: established with benchmark fixtures.

Benchmark representative small, medium, and large documents in production builds. Profile before introducing WASM. Candidate future WASM work includes very large JSON parsing, compression, diffing, or bulk transformations, but only if a worker-based TypeScript implementation is insufficient.

Use a Web Worker for expensive, non-interactive work before WASM. Keep the worker protocol versioned and cancellation-aware so stale results cannot overwrite newer edits.

## Error, Safety, and Recovery

- Never execute imported strings or evaluate JSON as code.
- Treat URL contents and clipboard contents as untrusted input.
- Bound nesting depth, string length, node count, and decompression output to prevent accidental or malicious resource exhaustion.
- Surface parse, validation, and operation errors without losing the current document.
- Add an optional local autosave after the core editor is stable. If added, make it opt-in or clearly removable and document that browser storage is not cross-device sharing.
- Provide a reset/new-document action with confirmation only when there are unsaved changes.

## Testing Strategy

- Unit test JSON parsing, date display detection, normalization, materialization, selectors, and every pure operation.
- Property-test reducer invariants: parent/child consistency, unique IDs, valid JSON export, and replay equivalence.
- Test event inversion: applying an operation and its inverse returns the exact prior document.
- Test command replay from an empty document to produce the same state as direct interaction.
- Test URL codec round trips, version errors, malformed payloads, and size limits.
- Test keyboard navigation, context-menu enablement, copy/paste, drag rejection, and undo grouping with browser-level tests.
- Add performance benchmarks to CI or a separate benchmark command; avoid making latency claims without measurements.
- Add accessibility checks for tree roles, focus visibility, keyboard operation, contrast, and reduced motion.

## Delivery Sequence

1. **Foundation:** scaffold Vite, TypeScript, React, Tailwind, BaseUI primitives, linting, formatting, test runner, and the domain folder structure.
2. **Document core:** implement normalized nodes, JSON import/export, commands, events, reducer, invariant checks, undo/redo, and replay tests.
3. **Minimal editor:** render the blank root header, add/edit/delete object properties and array items, explicit type handling, and keyboard focus.
4. **Interaction:** expansion, selection, multi-selection, clipboard, accessible tree semantics, and context menu commands.
5. **Sharing:** versioned URL-safe compression, debounced URL updates, import errors, and share-link copy.
6. **Movement and bulk tools:** drag/drop, command palette, pure transformations, raw JSON import/export, and worker offloading where measured.
7. **Hardening:** virtualization threshold, performance benchmarks, accessibility audit, browser compatibility, limits, recovery UX, and release packaging.

Each milestone should remain usable and should add tests before the next performance-sensitive feature. Do not implement every context-menu operation before the core document invariants and undo behavior are reliable.

## Suggested Initial Dependencies

Keep the initial dependency surface small:

- React, React DOM, TypeScript, Vite
- Tailwind CSS and the selected BaseUI package/primitives
- xState v5 for transient workflows only
- A small URL-safe compression library, selected after measuring payload size and browser support
- A test runner and browser test tool compatible with Vite
- Optional virtualization library only after the threshold is established

Do not add MobX, a general-purpose immutable-state framework, a full editor framework, or a WASM toolchain until a measured requirement justifies it.

## Open Questions

These decisions affect the data model and should be answered before implementation:

1. Should the root default to an object, an array, or a chooser that stays blank until the first insertion?
2. Should object property order be preserved exactly, or may sort operations become the default representation?
3. For multi-selection copy, should the default be a JSON array, newline-delimited JSON, or a context-dependent object fragment?
4. Should paste replace the focused node by default, or insert beside it? Is there a modifier or menu choice for the alternative?
5. Are dates only visual string detection, or should the app support an explicit non-standard date metadata type?
6. What maximum node count, nesting depth, and URL payload size should be supported?
7. Is drag/drop required on touch devices, or is keyboard movement sufficient for the first release?
8. Is JSON Schema validation in scope, and if so, which draft and authoring workflow should be supported?
9. Should the app support only strict JSON, or also JSON5, comments, trailing commas, and duplicate-key diagnostics on import?
10. Is local autosave desired, and what privacy/retention behavior is acceptable?
11. Which browsers and minimum mobile operating systems are release targets?
12. Is a share URL expected to work with no server-side redirect or analytics, including when the compressed payload exceeds common URL limits?

## Recommended Defaults If No Further Direction Is Given

- Start with an empty object root, with an immediate object/array toggle on the root header.
- Preserve object order; sorting is an explicit operation.
- Copy multiple selections as a JSON array.
- Replace on paste by default, with “paste as child” and “paste beside” explicit commands.
- Treat dates as display-only detection of ISO-like strings.
- Support strict JSON first; add JSON5 only as a separate import mode.
- Use a conservative node/depth/payload limit and make the limit visible on failure.
- Defer touch drag/drop, JSON Schema, autosave, and WASM until their requirements are confirmed or measured.
