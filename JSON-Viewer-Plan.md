# JSON Viewer Plan

## Validation Summary

The product direction is sound: a local-first, keyboard-friendly tree editor with a compact visual language is a good fit for a browser-only application. The performance goal is achievable if the editor treats the JSON document as a persistent data model, renders only the visible tree, and makes every mutation a small command rather than reparsing and rerendering the entire document.

Several requested technologies overlap:

- **React + TypeScript + Vite + Tailwind:** keep these.
- **BaseUI:** use its accessible primitives where they add value, especially menus, dialogs, popovers, and tooltips. Do not force every tree row through a heavyweight component abstraction. Tailwind owns visual styling.
- **xState:** use xState v5 for finite UI workflows such as context menus, keyboard navigation modes, import/export, and URL decoding states. It is not the best authoritative document store.
- **MobX and Observables:** do not use MobX initially. MobX adds a second reactive model beside React and makes event replay, serialization, and deterministic testing less direct. A small event-sourced store with `useSyncExternalStore` is a better fit. Revisit MobX only after profiling shows a real need.
- **WebAssembly:** do not add WASM in the first milestone. Parsing, compression, search, and tree edits should remain TypeScript until profiling identifies a hot path. WASM call overhead, memory copies, loading, and packaging can make small operations slower.

## Product Decisions

### JSON Semantics

JSON has only `null`, boolean, number, string, array, and object. It has no native date type. Primitive detection and formatting will follow spreadsheet-style behavior: infer a useful presentation while preserving exactly what the user entered.

- Keep the source input as the authoritative representation needed to reproduce and edit the value.
- Derive detected type and display format as additive metadata, separate from source input; store only user formatting overrides.
- Detect strings, numbers, booleans, `null`, and common unambiguous date forms for presentation.
- Format detected values for readability without replacing the source input. A formatted date may display in a friendly form while focus/editing reveals the original text.
- Let users disable formatting globally or per value. Disabling it immediately shows the source representation.
- Export valid JSON according to the inferred JSON primitive type. Date-like input remains a JSON string.
- Ambiguous input remains a string. Explicit conversion commands override inference.

Inference must be a pure, versioned domain function. Tests will lock down every accepted pattern and make later heuristic changes deliberate.

### Tree Editing Model

The editor deliberately hides object-versus-array terminology. Internally, every JSON Header is a container with an inferred JSON kind; externally, users interact only with headers and values.

- Initial load shows one blank, full-width root JSON Header and no children.
- Expanding a header reveals one blank input immediately below its existing content. The blank input is ephemeral until committed.
- Entering multiple primitive children infers an array.
- Giving a header its own value and one child establishes a key/value association; repeated keyed headers infer an object.
- Adding a nested JSON Header creates a structural child without asking the user to choose “object” or “array.” Its eventual contents determine its kind.
- A single primitive child remains visually undecided until another action disambiguates it. For strict JSON persistence and export it is provisionally represented as a one-element array, which can convert losslessly if later actions establish a keyed shape.
- If a new action conflicts with the current inferred shape, a deterministic conversion rule preserves all existing values. It must never silently discard or overwrite data.
- Imported strict JSON supplies known kinds, but the UI still does not label or require users to manage them.
- A single click focuses a row; `Space` toggles a container; `Enter` edits; `Escape` cancels; `Tab` moves through editable fields.
- Empty committed strings remain valid JSON strings. Empty add rows are discarded on blur or `Escape`.
- Primitive formatting is inferred and optional; explicit conversion remains available through context actions.
- `null` is rendered distinctly from an empty value and cannot be confused with an empty add row.

The inference table is part of the domain specification and will be unit-tested before UI implementation. UX tests will cover sequences of actions, not only final documents, because action order provides inference context.

### Selection and Movement

- Use stable node IDs, not array indexes or object keys, for selection, focus, movement, and undo targets.
- Support click, `Shift` range selection among visible siblings, and `Ctrl/Cmd` additive selection.
- Keyboard movement should have a documented tree model: `ArrowUp/Down` moves visible rows, `ArrowLeft/Right` collapses or enters/leaves containers, `Home/End` moves within the visible tree, and `Space` toggles expansion.
- V1 supports movement through keyboard commands only. Pointer and touch drag/drop are deferred.

### URL Sharing

Use a URL-safe compressed payload rather than ordinary Base64. The recommended shape is:

`/?v=1&d=<base64url-compressed-json>`

- Include a format version for future migrations.
- Compress the canonical JSON document, not UI state such as expansion and selection.
- Use `history.replaceState` with debouncing so typing does not create a browser-history entry per keystroke.
- Attempt to save every document to the URL. If the encoded URL exceeds a conservative browser-safe threshold or `replaceState` fails, stop URL persistence, keep the in-memory document intact, and show a compact “not saved to URL” status.
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
  components/tree/     Headers, values, editors, visible projection
  components/menus/    Context menu and command palette
  components/layout/   Minimal shell and status elements
  styles/              Tailwind theme and editor tokens
  test/                Fixtures, generators, integration helpers
```

The UI dispatches commands. A command validates intent and produces one or more versioned events. The reducer applies events to the immutable document. Selectors derive visible rows and values. No component should mutate the document directly.

Every document mutation is an undoable and replayable domain event. Ephemeral UI signals such as hover, focus, menu opening, and URL-write completion are not document events and do not enter undo history.

### Document Store

Implement a small external store around:

- `present`: current document state
- `past`: grouped event transactions for undo
- `future`: redo transactions
- `revision`: monotonically increasing event revision
- `eventLog`: optionally bounded in memory for replay and diagnostics
- `urlSavedRevision` or URL persistence state

Expose the store through `useSyncExternalStore`. Group a text edit into one transaction after a short idle boundary or on commit; do not create an undo item for every keypress. Keep the event log append-only within the session and use deterministic event IDs for replay tests.

Avoid serializing full document snapshots into every event. Events should address stable node IDs and contain the minimum before/after data required for inversion. A periodic snapshot can bound replay cost for very large documents.

### Data Structure

Use a normalized document internally:

- Nodes are keyed by stable ID.
- Each node stores its inferred or imported JSON kind, source primitive input, display metadata, and scalar value or ordered child IDs.
- Objects store ordered key/value child entries so visual order is retained.
- Parent IDs and child indexes are derived or maintained by reducer invariants.
- Export recursively materializes standard JSON.

This avoids copying the entire nested tree for a leaf edit and makes moves, selection, and references stable. Keep the normalized model private; the import/export boundary remains standard JSON.

Use structural sharing in reducer updates. Do not use a deep clone, `JSON.stringify` comparison, or full-tree traversal on every keystroke.

## Rendering and Interaction

- Render recursion as vertically stacked, collapsible sections. Every JSON Header spans the available horizontal width; hierarchy is communicated by header boundaries, sequence, color, and expansion rather than indentation.
- Render a flat visible-item projection from expanded headers, then virtualize only when document size requires it. For small documents, a simple list is faster and easier to debug.
- Add a virtualization threshold based on measured row count rather than enabling virtualization unconditionally.
- Keep row components keyed by stable node ID.
- Subscribe rows to the smallest selector possible so an edit does not rerender unrelated rows.
- Use CSS transitions sparingly. Expansion and editing feedback must remain immediate and respect `prefers-reduced-motion`.
- Preserve hierarchy for assistive technology even though it is not visually indented. Use appropriate tree or grouped-list semantics after testing the actual interaction model, including `aria-expanded` and hierarchy metadata where applicable.
- Use roving `tabIndex` or an equivalent active-descendant strategy. Do not make every row a separate tab stop.
- Provide a compact status bar for path, URL persistence, errors, and selection count instead of banners or explanatory copy. Do not expose inferred container kinds as required UI concepts.
- Support a narrow-screen layout without horizontal page overflow. Long strings should wrap or expose an inline overflow treatment.
- Use muted pastel and earthy type colors with a restrained Sublime Text-like editor surface. Color cannot be the only indicator of value formatting or selection.

## Editing and Clipboard

V1 is a graphical editor only. Raw JSON remains an interchange format for clipboard, files, and URLs, but there is no raw JSON editing surface.

- Copy selected node(s) as valid, context-dependent JSON. Keyed siblings copy as an object fragment; ordered or mixed selections copy as an array; a single node copies its value.
- Paste normally inserts into or beside the focused location. Replace is chosen when the focused primitive is actively being edited or when the user invokes “paste and replace.” Explicit insert, child, and replace commands remain available.
- On invalid paste, show an inline parse error and leave the document unchanged.
- Define how object keys are copied, pasted, renamed, and deduplicated. Default to rejecting duplicate keys rather than silently overwriting.
- Unit-test the copy/paste context table independently so its defaults can change without changing clipboard serialization code.

## Context Menu and Command Catalogue

The right-click menu should expose commands appropriate to the current selection. Also expose the same commands through a searchable command palette and keyboard shortcuts; context menus alone are not discoverable or accessible.

### Structure

- Add value
- Add nested JSON Header
- Duplicate
- Rename header value
- Convert type
- Wrap selection in a JSON Header
- Unwrap container
- Move up/down
- Move to parent or another container
- Sort header values
- Reverse children
- Flatten nested values
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
- Convert string to number, boolean, or null
- Recognize or ignore date-like formatting
- Format number
- Generate or replace UUID
- Generate timestamp
- Toggle boolean
- Increment/decrement number
- Enable/disable inferred formatting

### Data Operations

- Sort by header value
- Sort by value
- Sort children by a selected nested value
- Filter children by value or nested value
- Remove duplicate children
- Group children by a nested value
- Merge selected headers
- Deep merge selected headers
- Diff selected headers
- Extract keys
- Extract values
- Rename a path segment
- Select all matching values

### I/O and Navigation

- Copy raw JSON
- Paste and replace
- Paste as child
- Paste beside
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
- Memory growth should remain proportional to document and undo-history size.

Profile representative small, medium, and large documents locally in production builds before introducing WASM. Performance benchmarks are development tools, not a CI requirement. Candidate future WASM work includes very large JSON parsing, compression, diffing, or bulk transformations, but only if a worker-based TypeScript implementation is insufficient.

Use a Web Worker for expensive, non-interactive work before WASM. Keep the worker protocol versioned and cancellation-aware so stale results cannot overwrite newer edits.

Do not impose an arbitrary product-level node or nesting limit. Use progressive rendering and worker offloading so practical capacity is determined by the client device. Resource-exhaustion guards may still reject pathological decompression or recursion before the application becomes unresponsive.

## Error, Safety, and Recovery

- Never execute imported strings or evaluate JSON as code.
- Treat URL contents and clipboard contents as untrusted input.
- Guard decompression output and recursive operations against accidental or malicious resource exhaustion without defining a normal-document product cap.
- Surface parse, validation, and operation errors without losing the current document.
- The URL is the only persistence mechanism in V1. Do not use local storage, IndexedDB, a backend, or autosave elsewhere.
- If URL persistence is unavailable because the payload is too large, keep editing functional and visibly mark the current revision as not URL-saved.
- Provide a reset/new-document action with confirmation when the current revision is not represented in the URL.
- Parse strict JSON only. Reject JSON5, comments, trailing commas, and duplicate object keys with a useful error.
- Target the latest stable Chrome in V1 while avoiding browser-specific APIs where a standards-based option exists.

## Testing Strategy

- Unit test JSON parsing, date display detection, normalization, materialization, selectors, and every pure operation.
- Property-test reducer invariants: parent/child consistency, unique IDs, valid JSON export, and replay equivalence.
- Test event inversion: applying an operation and its inverse returns the exact prior document.
- Test command replay from an empty document to produce the same state as direct interaction.
- Test URL codec round trips, version errors, malformed payloads, and size limits.
- Test keyboard navigation, context-menu enablement, contextual copy/paste, formatting toggles, and undo grouping with browser-level tests.
- Keep local performance fixtures and a repeatable benchmark command for profiling; do not make benchmarks a CI gate.
- Add accessibility checks for tree roles, focus visibility, keyboard operation, contrast, and reduced motion.

## Delivery Sequence

1. **Foundation:** scaffold Vite, TypeScript, React, Tailwind, BaseUI primitives, linting, formatting, test runner, and the domain folder structure.
2. **Document core:** implement normalized nodes, JSON import/export, commands, events, reducer, invariant checks, undo/redo, and replay tests.
3. **Minimal editor:** render the blank full-width root header, implement action-driven container inference, add/edit/delete headers and values, additive primitive formatting, and keyboard focus.
4. **Interaction:** expansion, selection, multi-selection, clipboard, accessible tree semantics, and context menu commands.
5. **Sharing:** versioned URL-safe compression, debounced URL updates, import errors, and share-link copy.
6. **Movement and bulk tools:** keyboard movement, command palette, pure transformations, graphical file import/export, and worker offloading where measured.
7. **Hardening:** virtualization threshold, local performance profiling, accessibility audit, latest-Chrome validation, resource guards, recovery UX, and release packaging.

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

## Resolved V1 Scope

- Start with a blank, kind-neutral root header. Infer its JSON representation from user actions.
- Preserve the user's ordering. Sort and reorder operations mutate the document persistently and are undoable.
- Serialize multi-selection according to context, with keyed siblings becoming an object fragment and ordered or mixed values becoming an array.
- Prefer insertion for ordinary paste. Use replacement in an active primitive editor or through an explicit replace command.
- Preserve date-like source strings and apply optional, additive display formatting.
- Support no practical document-size ceiling, subject to client resources and safety guards.
- Support keyboard movement only in V1; defer pointer and touch drag/drop.
- Do not support JSON Schema in V1.
- Accept strict JSON only.
- Persist only through the URL. If it is too large, keep the document in memory and report that it is not saved.
- Target the latest stable Chrome while preferring portable web APIs.
- Require no server logic, redirects, analytics, or SSR. Share links are self-contained when the payload fits.
- Defer raw JSON editing, JSON5, local autosave, schema support, drag/drop, and WASM.

## Inference Contract To Prototype

The remaining design work is not a product-scope question but an interaction prototype. Before building the complete editor, implement and user-test the smallest header/value flow for these action sequences:

- One primitive under a blank header
- Several primitives under a blank header
- One named header with one primitive child
- Several named headers with primitive children
- Mixed primitive and nested-header insertion
- Converting an inferred shape after content already exists
- Pasting known arrays and objects into an undecided or populated header

For each sequence, specify the resulting strict JSON, visible layout, focus destination, and inverse event. No inference rule may lose data. Once accepted, encode the table as domain tests so behavior stays easy to revise.
