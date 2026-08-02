# JSON Viewer Implementation Schedule

> **Operating prompt:** Treat this file as the source of truth for project progress. Work from the first `TODO` downward unless a logged dependency requires otherwise. Before starting an item, read all earlier logs and the current item acceptance criteria. Change its status to `DONE` only after implementation and verification satisfy those criteria. Change it to `LOST` only when the work is intentionally abandoned, superseded, or impossible, and append the reason. Keep every log append-only: never edit or delete a prior entry, and add a dated correction instead. Never rewrite a `DONE` or `LOST` item's title, acceptance criteria, or historical log. As development reveals new information, revise, split, add, remove, or reorder only future `TODO` items, preserving dependencies and recording the reason in the nearest active item's log. Keep entries short and factual. Valid statuses are `TODO`, `DONE`, and `LOST`.

The schedule implements `JSON-Viewer-Plan.md`. A task is not `DONE` when code merely exists; its acceptance criteria and relevant automated checks must pass.

1. **[DONE] Specify the container inference contract**
   **Acceptance:** Document and approve the resulting strict JSON, visible layout, focus destination, and inverse event for one primitive, several primitives, named headers, repeated named headers, mixed content, shape conversion, and pasted arrays/objects. Every transition is deterministic and lossless.
   **Log (append-only):**
   - 2026-08-01: Locked V1 rules in `docs/container-inference-v1.md`, including mixed-content wrappers, intermediate conversions, paste modes, focus, and exact inverse requirements.

2. **[DONE] Scaffold the Vite React application**
   **Acceptance:** Create an npm-managed React and TypeScript Vite application that starts locally and produces a production build without SSR or backend code.
   **Log (append-only):**
   - 2026-08-01: Added the npm/Vite React client scaffold. Verified the static production build with Vite 8 on Node 24.

3. **[DONE] Configure TypeScript and project quality tools**
   **Acceptance:** Enable strict TypeScript settings, linting, formatting, and consistent npm scripts for development, type checking, linting, testing, and building.
   **Log (append-only):**
   - 2026-08-01: Configured strict TypeScript 6, ESLint 10 flat config, Prettier, and development, verification, and build scripts.
   - 2026-08-01: Pinned ESLint and `@eslint/js` to 9.x after reproducible ESLint 10 project-service crashes under the current TypeScript toolchain.

4. **[DONE] Install the minimal application dependencies**
   **Acceptance:** Add React, Tailwind CSS, Base UI primitives, xState v5, and test tooling. Do not add MobX, WASM, virtualization, or other deferred dependencies.
   **Log (append-only):**
   - 2026-08-01: Installed React 19, Tailwind 4, Base UI 1, xState 5, and test tooling with a clean npm audit. Deferred packages remain absent.

5. **[DONE] Create the domain-driven source hierarchy**
   **Acceptance:** Establish the `app`, `domain/document`, `domain/commands`, `domain/events`, `domain/reducer`, `domain/operations`, `infrastructure`, `state`, `interaction`, `components/tree`, `components/menus`, `components/layout`, `styles`, and `test` boundaries with enforceable dependency direction.
   **Log (append-only):**
   - 2026-08-01: Created all planned source boundaries and added layer-specific import restrictions for domain, infrastructure, state, interaction, and reusable components.

6. **[DONE] Establish the visual tokens and minimal application shell**
   **Acceptance:** Define the muted pastel and earthy palette, typography, spacing, focus, selection, and primitive-format tokens in Tailwind. Render a restrained full-viewport editor shell with no banners or explanatory marketing content.
   **Log (append-only):**
   - 2026-08-01: Added Tailwind theme tokens, reduced-motion and focus foundations, an isolated full-viewport editor canvas, and compact status bar.

7. **[DONE] Establish automated test infrastructure**
   **Acceptance:** Configure unit, property, component, and latest-Chrome browser tests with shared fixtures. Tests run through documented npm scripts.
   **Log (append-only):**
   - 2026-08-01: Added Vitest unit/property and Chrome component projects, Playwright Chrome E2E, and shared fixtures. `npm run test:all` passes.

8. **[DONE] Define the normalized document model**
   **Acceptance:** Model stable node IDs, kind-neutral and inferred/imported containers, source primitive input, semantic JSON values, formatting overrides, ordered child IDs, and ordered keyed entries without exposing container kinds to UI components.
   **Log (append-only):**
   - 2026-08-01: Added normalized primitive/container records, stable IDs, ordered keyed entries, additive metadata, UI-safe node views, and a persistent bucketed node table.

9. **[DONE] Implement identity, parent lookup, and document invariants**
   **Acceptance:** Generate stable IDs and validate unique IDs, one root, valid parent/child relationships, ordered children, legal scalar/container states, and cycle absence.
   **Log (append-only):**
   - 2026-08-01: Added Web Crypto UUID generation, linear parent lookup, graph and shape validation, cycle detection, and runtime primitive-state checks.

10. **[DONE] Implement strict JSON import parsing**
    **Acceptance:** Parse valid JSON into normalized nodes while preserving object order. Reject JSON5, comments, trailing commas, malformed input, excessive resource use, and duplicate object keys with typed errors.
    **Log (append-only):**
    - 2026-08-01: Added a duplicate-aware recursive-descent parser with typed syntax locations and early input, depth, node, and string resource guards.

11. **[DONE] Implement canonical JSON materialization and serialization**
    **Acceptance:** Convert normalized documents to standard JSON and deterministic serialized text without leaking editor metadata. The blank root and provisional one-primitive state follow the approved inference contract.
    **Log (append-only):**
    - 2026-08-01: Added deterministic materialization and serialization that preserve object order, strict JSON semantics, neutral roots, and imported scalar roots.

12. **[DONE] Implement primitive type detection**
    **Acceptance:** Pure, versioned functions detect strings, numbers, booleans, `null`, and approved unambiguous date-like strings while preserving source input and treating ambiguous input as a string.
    **Log (append-only):**
    - 2026-08-01: Added versioned detection for JSON primitives and validated ISO dates/datetimes while preserving ambiguous and imported string values.

13. **[DONE] Implement additive primitive formatting**
    **Acceptance:** Pure formatters produce spreadsheet-inspired string, number, boolean, null, and date presentations. Formatting never alters source input and supports global and per-value overrides.
    **Log (append-only):**
    - 2026-08-01: Added source-preserving spreadsheet-style number, boolean, null, date, and datetime formatting with global and per-node overrides.

14. **[DONE] Implement container inference transitions**
    **Acceptance:** Encode the approved action-sequence table as pure transitions for blank, provisional, ordered, and keyed shapes. Conflicting actions convert losslessly or return a typed error.
    **Log (append-only):**
    - 2026-08-01: Implemented lossless insert, wrap, unwrap, paste-into, and paste-beside transitions, including persistent ordered mixed shapes and exact restoration snapshots.

15. **[DONE] Define versioned commands and domain events**
    **Acceptance:** Define serializable user-intent commands, minimal versioned mutation events, deterministic metadata for tests, and typed validation failures. Ephemeral UI signals remain outside the domain log.
    **Log (append-only):**
    - 2026-08-01: Added serializable V1 semantic commands, minimal normalized patch events, deterministic injected metadata, inversion, and typed failures.

16. **[DONE] Implement the structurally shared document reducer**
    **Acceptance:** Apply every domain event as a pure function, update only affected normalized records, preserve invariants, and avoid deep cloning, serialization comparisons, or whole-document traversal for leaf edits.
    **Log (append-only):**
    - 2026-08-01: Added pure patch reduction over persistent buckets, O(1)-sized leaf patches, stale/unsupported event rejection, and structural invariant validation.

17. **[DONE] Implement command validation and event production**
    **Acceptance:** Commands validate targets and current revision, then emit complete event transactions without mutating state or containing UI notifications.
    **Log (append-only):**
    - 2026-08-01: Added revision, payload, target, collision, caption, parse, and no-op validation with injected IDs and minimal event production.

18. **[DONE] Implement event inversion, transactions, and replay**
    **Acceptance:** Every document mutation can be undone and redone exactly. Text edits group at commit or an idle boundary, event replay reproduces state, and periodic snapshots can bound long replay histories.
    **Log (append-only):**
    - 2026-08-01: Added exact inverse transactions, monotonic applied revisions, grouped edit boundaries, bounded checkpoints, and deterministic retained-history replay. Item 22 will drive idle-time boundary closure.

19. **[DONE] Implement the external document store**
    **Acceptance:** Provide `present`, `past`, `future`, `revision`, bounded event-log support, and URL-saved revision through a small store compatible with `useSyncExternalStore`.
    **Log (append-only):**
    - 2026-08-01: Added stable external-store snapshots, safe subscriptions, undo/redo, past/future history, bounded applied-event logs, checkpoints, and URL-saved revision state.

20. **[DONE] Implement focused document selectors**
    **Acceptance:** Provide stable selectors for individual nodes, paths, children, formatting, selection targets, and the flat visible-item projection without forcing unrelated component updates.
    **Log (append-only):**
    - 2026-08-01: Added stable node, child, parent, path, formatting, selection, and visible-item selectors with structural-token memoization.

21. **[DONE] Verify the document core**
    **Acceptance:** Unit and property tests cover parsing, materialization, primitive detection, formatting, all inference sequences, invariants, structural sharing, inversion, replay equivalence, and invalid commands.
    **Log (append-only):**
    - 2026-08-01: Added 56 unit/property tests covering strict parsing, inference, invariants, events, structural sharing, replay, store behavior, selectors, and malformed input. Full suite has 57 passing tests.

22. **[DONE] Define transient interaction machines**
    **Acceptance:** Use xState only where finite workflows clarify editing, text-edit idle boundaries, context menus, import/export, and URL decoding. Focus, hover, and other ephemeral state do not enter document undo history.
    **Log (append-only):**
    - 2026-08-01: Added a serializable xState v5 editor machine for focus, expansion, edit sessions, formatting preference, and draft-relative idle boundaries without document mutations.

23. **[DONE] Render the blank root JSON Header**
    **Acceptance:** Initial load displays one collapsed, selectable, full-width blank header with no visible child content and no object/array terminology.
    **Log (append-only):**
    - 2026-08-01: Rendered one blank, collapsed, selectable, full-width root header with no child content or exposed container terminology.

24. **[DONE] Implement header expansion and ephemeral add input**
    **Acceptance:** Click and `Space` expand or collapse immediately. Expanded headers expose one blank input that becomes document data only on commit and disappears on cancellation or uncommitted blur.
    **Log (append-only):**
    - 2026-08-01: Added immediate click/Space expansion and local composers that commit only on action, disappear on blur/Escape, reopen from the header, and preserve parent composers after nested insertion.

25. **[DONE] Implement graphical primitive editing**
    **Acceptance:** Users can add and edit strings, numbers, booleans, null, empty strings, and date-like strings. Focus reveals source input; commit applies inferred semantics as one undo transaction; `Escape` restores the prior value.
    **Log (append-only):**
    - 2026-08-01: Added source-preserving inline add/edit/cancel flows for every primitive presentation, including empty strings and date-like values, with one transaction per commit.

26. **[DONE] Implement nested JSON Header editing**
    **Acceptance:** Users can add, name, edit, expand, collapse, and remove nested full-width headers. Their contents drive kind inference without presenting an object/array choice.
    **Log (append-only):**
    - 2026-08-01: Added full-width nested header creation, neutral and empty-caption distinction, rename validation, expansion, removal, and action-driven shape inference.

27. **[DONE] Implement core node mutations**
    **Acceptance:** Rename, duplicate, delete, clear, wrap, and unwrap work through commands and remain lossless, undoable, replayable, and invariant-safe.
    **Log (append-only):**
    - 2026-08-01: Added command-backed rename, deep duplicate, delete, clear, wrap, and unwrap with exact history behavior and mutation-aware focus recovery.

28. **[DONE] Implement primitive presentation and formatting controls**
    **Acceptance:** Values have distinct but accessible presentations for strings, numbers, booleans, null, and date-like strings. Users can disable inferred formatting globally or per value without changing exported JSON.
    **Log (append-only):**
    - 2026-08-01: Added accessible non-color type markers, source-on-focus display, global formatting preference, and undoable per-value formatting overrides.

29. **[DONE] Implement base keyboard focus behavior**
    **Acceptance:** Roving focus supports `Enter`, `Escape`, `Tab`, and visible focus indicators without making every item a page tab stop.
    **Log (append-only):**
    - 2026-08-01: Added roving tree focus, inline Enter/Escape/Tab behavior, keyboard-reachable active controls, visible focus, and deterministic focus after edits and history movement.

30. **[DONE] Implement hierarchical keyboard navigation**
    **Acceptance:** `ArrowUp/Down`, `ArrowLeft/Right`, `Home`, `End`, and `Space` navigate the visible hierarchy, enter/leave sections, and expand/collapse according to a documented model.
    **Log (append-only):**
    - 2026-08-01: Implemented and documented visible-preorder arrows, Home, End, Space, mutation shortcuts, and section entry/exit in `docs/editor-keyboard-v1.md`.

31. **[DONE] Implement accessible hierarchy semantics**
    **Acceptance:** Tested tree or grouped-list semantics expose level, expansion, position, selection, editing, and error state to assistive technology despite the non-indented visual layout.
    **Log (append-only):**
    - 2026-08-01: Added tested treeitem/group ownership, hierarchy metadata, expansion and selection state, accessible values and type descriptions, inline error relationships, and polite status output.

32. **[DONE] Complete responsive editor styling**
    **Acceptance:** Headers remain full width, recursion remains vertically legible without indentation, long values have a usable overflow treatment, and the page has no horizontal viewport overflow at narrow widths.
    **Log (append-only):**
    - 2026-08-01: Completed full-width non-indented recursive styling, long-value wrapping, muted type colors, compact responsive controls, reduced motion, and zero horizontal overflow at 240 CSS pixels.

33. **[DONE] Implement single and multiple selection**
    **Acceptance:** Click selects, `Shift` selects a visible sibling range, and `Ctrl/Cmd` toggles additive selection. Selection survives unrelated edits through stable IDs and reports a count.
    **Log (append-only):**
    - 2026-08-01: Added stable-ID single, additive, sibling-range, select-all, pruning, normalized-root, count announcement, and focus-preserving selection behavior with machine and Chrome coverage.

34. **[DONE] Define and implement contextual clipboard serialization**
    **Acceptance:** A single node copies its value, keyed sibling selections copy a valid object fragment, and ordered or mixed selections copy a valid array. The context table is isolated and unit-tested.
    **Log (append-only):**
    - 2026-08-01: Isolated and tested single-value, keyed-sibling, ordered/mixed, dangerous-key, overlap, and deterministic-order clipboard contexts.

35. **[DONE] Implement contextual JSON paste**
    **Acceptance:** Ordinary paste intuitively inserts into or beside the focused target; active primitive editing and explicit commands support replacement. Invalid or duplicate-key input leaves the document unchanged and shows an inline typed error.
    **Log (append-only):**
    - 2026-08-01: Added automatic into/beside paste, explicit modes, active-editor replacement, typed inline failures, unchanged-on-error behavior, focus hints, and browser regressions.

36. **[DONE] Implement the accessible context menu**
    **Acceptance:** Base UI primitives render only commands valid for the current selection, support right click and keyboard opening, restore focus correctly, and dispatch domain commands rather than mutating state.
    **Log (append-only):**
    - 2026-08-01: Added a shared Base UI context menu with right-click/keyboard opening, selection-aware applicability, command dispatch, and tested focus restoration.

37. **[DONE] Implement structural utility operations**
    **Acceptance:** Add value, add nested header, duplicate, rename, convert, wrap, unwrap, move up/down, move to another container, reverse children, flatten nested values, remove empty values, remove selection, and clear container are pure, undoable operations with typed failures.
    **Log (append-only):**
    - 2026-08-01: Added command-backed creation/editing and pure versioned move, reparent, reverse, flatten, empty removal, and selection removal operations with typed failures and exact inverses.

38. **[DONE] Implement text utility operations**
    **Acceptance:** Uppercase, lowercase, title case, trim, find/replace, prefix/suffix, parse escaped string, and escape string operate predictably over valid selections and preserve unaffected data.
    **Log (append-only):**
    - 2026-08-01: Added case, trim, literal find/replace, affix, parse-escaped, and escape operations with selection validation and focused tests.

39. **[DONE] Implement primitive conversion and generation operations**
    **Acceptance:** String-to-number/boolean/null, date recognition override, number formatting, UUID generation, timestamp generation, boolean toggle, and number increment/decrement are pure and undoable.
    **Log (append-only):**
    - 2026-08-01: Added explicit primitive conversion, date-like/source and number display overrides, deterministic UUID/timestamp generation, boolean toggle, and finite number adjustment.

40. **[DONE] Implement sorting and collection operations**
    **Acceptance:** Sort by header/value/nested value, filter, deduplicate, group, and persistent reorder preserve deterministic ordering and produce one undoable transaction per invocation.
    **Log (append-only):**
    - 2026-08-01: Added stable caption/value/path sorting, query filtering, canonical deduplication, collision-safe grouping, and position-based persistent reorder as single transactions.

41. **[DONE] Implement merge, diff, and extraction operations**
    **Acceptance:** Shallow merge, deep merge, diff, extract keys, extract values, rename path segments, and select matching values define conflict behavior and return deterministic results or typed errors.
    **Log (append-only):**
    - 2026-08-01: Added later-wins shallow/deep merge, deterministic diff, key/value extraction, path rename, typed matching queries, and transient select-matching integration.

42. **[DONE] Implement the command palette and shortcuts**
    **Acceptance:** Every applicable context-menu operation is discoverable through a searchable keyboard-accessible palette, with conflict-free shortcuts and correct enablement for current selection.
    **Log (append-only):**
    - 2026-08-01: Added the shared searchable keyboard palette, parameter dialogs that retain inline failures, selection-aware enablement, documented non-browser-reserved shortcuts, and Chrome coverage.

43. **[DONE] Implement keyboard-only node movement**
    **Acceptance:** Users can reorder and reparent selected values and headers without pointer or touch dragging. Invalid cycles and illegal targets are rejected without mutation.
    **Log (append-only):**
    - 2026-08-01: Added sibling reorder, move-in/out shortcuts, source-path destination movement, visible destination expansion, deterministic selection order, and typed cycle/target rejection.

44. **[DONE] Implement navigation utility commands**
    **Acceptance:** Focus path, show source path, expand descendants, collapse descendants, expand all, and collapse all work with virtualized and non-virtualized projections.
    **Log (append-only):**
    - 2026-08-01: Added canonical escaped source paths, focus/reveal, descendant/all expansion and collapse, projection-independent ID helpers, and roving-focus recovery when rows become hidden.

45. **[DONE] Investigate and fix add behavior**
    **Acceptance:** Reproduce add failures across root and nested headers, value and header insertion, keyboard and pointer activation, draft blur/cancellation, and focus movement. Adds remain attached to the header where they were invoked, do not unexpectedly disappear on click-away, and have browser regressions for every confirmed defect.
    **Log (append-only):**
    - 2026-08-01: Moved ahead of file and URL work after timestamped product feedback reported disappearing add controls and nested additions grouping at the bottom.
    - 2026-08-01: Reproduced both defects. Composers now remain available after abandoned blur/Escape, clear uncommitted drafts, render directly beneath their owning header before descendants, and retain deterministic focus after value/header commits. Added root/nested placement, blur, cancellation, keyboard, pointer, and narrow-screen browser coverage; the full 174-test and 3-E2E gate passes.

46. **[DONE] Repair reported core interaction regressions**
    **Acceptance:** Reproduce and fix non-working `Ctrl/Cmd+Z`, array-of-objects imports that render an unintended empty header, vertical layout shifts on selection, and boolean clicks that unexpectedly change presentation. Single click only selects; any boolean toggle behavior is explicit, undoable, and browser-tested.
    **Log (append-only):**
    - 2026-08-01: Added from `docs/feedback-2026-08-01T21-04-22-05-00.md` and prioritized as data-integrity and primary-interaction work.
    - 2026-08-01: Confirmed undo was row-scoped, active values switched presentation, active-only controls changed layout, and imported object elements were valid anonymous wrappers with blank presentation. Added document undo/redo from pristine composers and non-text controls while preserving native draft undo; ordinal imported-item labels; stable formatted boolean selection; inert geometry-preserving controls; explicit undoable boolean toggle coverage; and desktop/240px row-geometry regressions. The full 178-test and 5-E2E gate passes.

47. **[DONE] Rework direct editing and header creation**
    **Acceptance:** Expanded headers do not render persistent add rows. `Enter` and an applicable menu action open exactly one contextual add session beneath a value or inside a header; blur/Escape cancel without mutation. Typing on a focused editable row starts editing, header creation cannot be accidentally committed as a value, and a value can be promoted to a header without data loss. Root and nested keyboard/pointer workflows are discoverable and browser-tested.
    **Log (append-only):**
    - 2026-08-01: Added from product feedback; supersedes treating the current value-first composer as final UX.
    - 2026-08-01: Urgent follow-up requires replacing repeated composers with one keyboard/menu-driven insertion session and making primitive promotion a first-class action.
    - 2026-08-01: Replaced persistent composers with one contextual indexed insertion session opened by `Enter`, `Alt+Enter`, menu, or palette; blur/Escape cancel atomically. Added direct typing/F2 editing, fixed-kind header creation, lossless primitive promotion, history-safe session cleanup, indexed command inversion, and keyboard/menu/browser coverage.
    - 2026-08-01: Added pointer parity: double-clicking any non-root header now opens caption editing while preserving root behavior and keyboard alternatives.

48. **[DONE] Improve at-a-glance hierarchy context**
    **Acceptance:** The focused row communicates its parent without indentation, and a collapsed captioned header with one primitive child shows a concise inline key/value preview. Expanded, multi-value, nested, anonymous, and empty headers do not duplicate hidden content. Long values remain readable and accessible at narrow widths.
    **Log (append-only):**
    - 2026-08-01: Added from product feedback about unclear parentage and opaque collapsed headers.
    - 2026-08-01: Added formatted collapsed previews for captioned singleton primitive headers, full generated ancestry references, accessible descriptions, and narrow-width coverage without duplicating expanded or non-scalar content.
    - 2026-08-01: Collapsed primitive previews now reuse the child value's semantic string, number, boolean, null, date, or datetime color class while retaining source-preserving formatting and neutral row backgrounds.

49. **[DONE] Add generated hierarchical row references**
    **Acceptance:** Every rendered document row has a deterministic left-side reference. Children of keyed parents use spreadsheet letters, children of ordered parents use one-based numbers, and segments compose as `A.1.B`; root uses `Root`. References update after structural changes, are not persisted or copied as JSON, and remain accessible at narrow widths.
    **Log (append-only):**
    - 2026-08-01: Added as urgent product direction; generated A/1 paths were explicitly selected over actual-key paths.
    - 2026-08-01: Added pure spreadsheet-letter and one-based ordered segments to the memoized visible projection, rendered `Root`/`A.1.B` gutters for every row, and verified mixed hierarchies, post-Z columns, imported wrappers, accessibility, and structural recomputation.

50. **[DONE] Add accessible kind and depth header styling**
    **Acceptance:** Keyed and ordered headers use distinct accessible colors, with a bounded shade progression by hierarchy level. Visible non-color labels and accessible descriptions identify each shape; neutral and single-value headers remain distinct; selection, focus, text, badges, and counts meet contrast requirements.
    **Log (append-only):**
    - 2026-08-01: Added as urgent product direction and resolves the prior undecided request for array/object-specific header color coding.
    - 2026-08-01: Added distinct orange object and blue array header families, bounded six-level shade cycling, neutral/single states, visible non-color shape badges, accessible descriptions, and selection-aware backgrounds. Verified all configured text/selected/focus contrast combinations exceed 4.5:1/3:1 targets.
    - 2026-08-01: Correction after visual review: removed visible Object/Array badges as redundant while retaining non-color shape information in accessible descriptions. Scoped striping to primitive-like rows, made object/array colors override row alternation at every position, excluded collapsed primitive previews from shape colors, and replaced the oversized text chevron with a compact CSS triangle.

51. **[DONE] Configure GitHub Pages deployment**
    **Acceptance:** Vite builds for `https://camjohnson26.github.io/JSON-Viewer/`, a least-privilege GitHub Actions workflow deploys `dist` from `master` and supports manual dispatch, and the README documents local commands plus exact Pages setup/deploy instructions. Local development and automated browser tests remain functional.
    **Log (append-only):**
    - 2026-08-01: Added as urgent product direction for the existing `CamJohnson26/JSON-Viewer` remote; no custom domain is assumed.
    - 2026-08-01: Added environment-gated `/JSON-Viewer/` Vite assets, a least-privilege `master`/manual Pages workflow, and README setup/deploy/private-repository guidance. Verified the Pages build emits project-site asset URLs while local builds and Chrome tests retain root-base behavior.

52. **[DONE] Add context-menu search**
    **Acceptance:** The keyboard and pointer context menu can filter its currently applicable actions without losing menu semantics, focus restoration, disabled-state explanations, or command-palette parity.
    **Log (append-only):**
    - 2026-08-01: Added from product feedback and placed before further I/O work because the action catalog is already large.
    - 2026-08-01: Selected as the first item in the next cohesive utility/discovery batch with items 53-54.
    - 2026-08-01: Added focused filtering over applicable shared-catalog actions with empty results, keyboard and pointer support, focus restoration, palette shortcut propagation, and Chrome regression coverage.

53. **[DONE] Add key naming and bulk-copy utilities**
    **Acceptance:** Selected captions can convert predictably among snake case, camel case, and spaced words with collision detection and one undoable transaction. Copy-all-captions and copy-all-values produce deterministic valid JSON without mutating the document.
    **Log (append-only):**
    - 2026-08-01: Added from product feedback; UI terminology uses captions rather than object/key model jargon.
    - 2026-08-01: Selected for the next batch after context-menu search so new transformations and copy actions share the improved discovery surface.
    - 2026-08-01: Added atomic snake/camel/spaced caption conversion with collision detection plus deterministic copy-all-captions and copy-all-values JSON actions. Domain and Chrome tests cover non-mutation and one-step undo.

54. **[DONE] Add modifier-based bulk expansion**
    **Acceptance:** Holding the approved Option/Alt modifier while expanding or collapsing applies the same state to descendants, does not trigger browser navigation, preserves visible roving focus, and is documented and tested on the supported Chrome target.
    **Log (append-only):**
    - 2026-08-01: Added from product feedback; exact browser-safe event handling remains an implementation concern.
    - 2026-08-01: Selected to complete the next batch as a focused keyboard/navigation improvement before file and URL work.
    - 2026-08-01: Added browser-safe Alt/Option descendant expansion and collapse for arrows, Space, and pointer activation, preserving focus and excluding AltGraph. Documented the shortcuts and verified the complete batch with 192 Vitest tests, 5 Chrome E2E tests, and local plus Pages builds.

55. **[DONE] Specify and test the drag-and-drop contract**
    **Acceptance:** Document deterministic before, after, and into drop intents for values, headers, and selected root blocks. Define invalid cycles, root movement, mixed-parent selection, keyed-caption collisions, collapsed targets, focus, selection, and one-step undo behavior. Pure tests resolve pointer geometry to domain move intents without mutating the document.
    **Log (append-only):**
    - 2026-08-01: Added as the first item in the next milestone after product direction promoted desktop drag-and-drop ahead of file and URL work. This supersedes the original plan's pointer drag deferral; keyboard movement remains the accessible alternative and touch behavior is not expanded by this decision.
    - 2026-08-01: Documented source normalization, before/after/inside zones, mixed-parent blocks, root/cycle/caption rules, neutral-target inference, cancellation, focus, and undo in `docs/drag-and-drop-v1.md`. Added pure geometry and intent resolution tests without introducing a drag dependency.

56. **[DONE] Implement pointer drag reorder and reparenting**
    **Acceptance:** Latest-Chrome users can drag values, headers, or the current selected root block before, after, or into a valid visible target. The UI shows one unambiguous drop location, performs no document mutation before drop, reuses validated domain movement, commits one undoable transaction, and preserves stable IDs, selection, and focus. Invalid targets never mutate the document.
    **Log (append-only):**
    - 2026-08-01: Selected as the implementation item for the drag-and-drop milestone; prefer native pointer events and existing move operations over a new dependency unless implementation evidence requires otherwise.
    - 2026-08-01: Added delegated Pointer Events from the generated row-reference gutter, visible valid/invalid drop zones, selected-root block movement, and one existing `structure.move-to` transaction per drop. Stable IDs, selection, focus, undo, redo, object-caption validation, cycles, and empty-header inference remain domain-controlled.

57. **[DONE] Harden drag-and-drop interaction and coverage**
    **Acceptance:** Escape and pointer cancellation end a drag without mutation; edge proximity auto-scrolls predictably; collapsed valid targets can reveal their destination without accidental drops; ordinary click, editing, context menus, text selection, and keyboard movement remain intact. Reduced-motion, narrow-width, accessibility, undo/redo, multi-selection, collision, cycle, and latest-Chrome regressions pass.
    **Log (append-only):**
    - 2026-08-01: Selected to complete the drag-and-drop milestone with browser behavior and regression hardening before URL persistence work.
    - 2026-08-01: Added threshold activation, pointer capture, bounded click suppression, Escape/pointer cancellation, stale-document rejection, delayed collapsed-target reveal/restoration, viewport auto-scroll, live target announcements, non-color invalid styling, selectable row text, reduced-motion behavior, and narrow-width coverage. Verified 200 Vitest tests, 8 latest-Chrome E2E workflows, and local plus Pages builds.
    - 2026-08-01: Added a visible six-dot grip to each non-root generated reference gutter so the drag initiation surface is visually discoverable without changing reference text or accessibility output.

58. **[LOST] Implement graphical JSON file import and export**
    **Acceptance:** Strict JSON files can populate the graphical editor, and current canonical JSON can download as a file. There is no raw JSON editing surface; errors never replace the current document.
    **Log (append-only):**
    - 2026-08-01: Intentionally skipped by product direction in favor of drag-and-drop and the next milestone; clipboard and future URL interchange remain available.

59. **[TODO] Implement the versioned URL codec**
    **Acceptance:** Canonical JSON round-trips through a compressed Base64URL payload shaped as `?v=1&d=...`, with typed version, corruption, and decompression errors and no server dependency.
    **Log (append-only):**

60. **[TODO] Load and recover URL document state**
    **Acceptance:** A missing payload loads the blank root, a valid payload loads its document, and an invalid payload preserves the URL while presenting a recoverable error without executing imported content.
    **Log (append-only):**

61. **[TODO] Persist revisions to the URL**
    **Acceptance:** Debounced `history.replaceState` writes do not create per-keystroke history entries. Success updates `urlSavedRevision`; oversized payloads or API failures preserve in-memory edits and visibly mark them unsaved.
    **Log (append-only):**

62. **[TODO] Implement share URL and reset actions**
    **Acceptance:** Copy share URL reflects the latest URL-saved revision. New/reset requests confirmation only when the current revision is not represented in the URL.
    **Log (append-only):**

63. **[TODO] Implement the compact editor status surface**
    **Acceptance:** A non-banner status area reports current path, selection count, inline errors, and URL persistence state without exposing inferred object/array kinds.
    **Log (append-only):**

64. **[TODO] Add input and resource-exhaustion guards**
    **Acceptance:** URL and clipboard inputs are treated as untrusted. Decompression and recursive operations fail safely before blocking the client, without imposing an arbitrary normal-document product limit.
    **Log (append-only):**

65. **[TODO] Add a cancellable Web Worker boundary**
    **Acceptance:** Expensive non-interactive parsing, compression, diffing, or bulk work can use a versioned, cancellation-aware worker protocol, and stale results cannot overwrite newer revisions. Only measured tasks are moved into it.
    **Log (append-only):**

66. **[TODO] Add threshold-based visible-item virtualization**
    **Acceptance:** Local profiling establishes a row-count threshold. Documents below it use direct rendering; larger visible projections virtualize while preserving focus, selection, expansion, accessibility, and navigation commands.
    **Log (append-only):**

67. **[TODO] Complete domain and operation test coverage**
    **Acceptance:** Every pure operation, typed failure, event inverse, replay path, strict JSON boundary, URL codec case, copy/paste context, and resource guard has focused automated coverage.
    **Log (append-only):**

68. **[TODO] Complete browser interaction tests**
    **Acceptance:** Latest-Chrome tests cover the blank start, editing and inference sequences, undo/redo, keyboard and pointer movement, selection, clipboard behavior, menus, palette, URL persistence, and recovery.
    **Log (append-only):**

69. **[TODO] Complete the accessibility audit**
    **Acceptance:** Automated and manual checks cover semantics, focus order and restoration, full keyboard operation, contrast, non-color state indicators, errors, and `prefers-reduced-motion`; critical findings are fixed.
    **Log (append-only):**

70. **[TODO] Profile and tune production performance**
    **Acceptance:** Repeatable local fixtures measure small, medium, and large documents in a production build. Leaf edits meet the one-frame target for normal documents, navigation has no visible lag, and memory growth tracks document plus retained history.
    **Log (append-only):**

71. **[TODO] Decide whether any measured hot path requires WASM**
    **Acceptance:** Record profiling evidence and either keep TypeScript/Workers or add a narrow WASM boundary that demonstrably improves a critical operation after transfer and loading costs. Unjustified WASM work is marked `LOST`, not implemented speculatively.
    **Log (append-only):**

72. **[TODO] Validate the latest stable Chrome release target**
    **Acceptance:** The production build passes all supported workflows in the latest stable Chrome, uses standards-based browser APIs where available, and has no backend, SSR, analytics, local storage, or IndexedDB dependency.
    **Log (append-only):**

73. **[TODO] Rethink the editor component file structure**
    **Acceptance:** Review `EditorTree.tsx` after feature work is complete and split it into cohesive components and interaction modules with clear ownership. Preserve behavior, accessibility, focus semantics, and performance; avoid fragmentation into trivial wrapper files.
    **Log (append-only):**

74. **[TODO] [HUMAN ATTENTION] Decide the remaining editor chrome**
    **Acceptance:** A human-approved direction resolves whether to remove formatting and undo/redo buttons, primitive indicators, node-count badges, and repeated disclosure icons, and whether the broader gray, white, and orange palette still applies alongside the approved keyed/ordered header colors. Record the decision before implementation and verify contrast, focus, selection, and responsive stability.
    **Log (append-only):**
    - 2026-08-01: Flagged because multiple visual comments are directionally clear but require a coherent design decision rather than independent removals.
    - 2026-08-01: Keyed/ordered header colors and level shading were explicitly approved and moved into item 50; remaining chrome and global palette choices still require review.
    - 2026-08-01: Product direction removed the global formatting toggle from the top bar, retained it in searchable row actions, and added an empty-document "Paste JSON to view and edit" prompt. Undo/redo and the other chrome decisions remain unresolved.

75. **[TODO] [HUMAN ATTENTION] Decide which actions remain visible**
    **Acceptance:** Confirm whether rename, duplicate, and related features should be removed entirely, removed only from inline row controls, or retained in menus/palette. Record the V1 action surface and update tests and documentation without silently deleting domain capability.
    **Log (append-only):**
    - 2026-08-01: Flagged because the feedback conflicts with previously approved and completed V1 operations.

76. **[TODO] [HUMAN ATTENTION] Decide empty collection representation**
    **Acceptance:** Decide whether and how users explicitly distinguish empty ordered and keyed collections on a header while preserving the no-jargon interface and deterministic inference contract. Update the inference specification before changing persisted behavior.
    **Log (append-only):**
    - 2026-08-01: Flagged because an explicit empty-kind choice changes the approved kind-neutral inference contract.

77. **[TODO] [HUMAN ATTENTION] Decide default paste semantics**
    **Acceptance:** Decide whether ordinary paste replaces the full selection/document, replaces the focused value, or retains contextual into/beside insertion. Document examples for root, header, primitive, multi-selection, and active editing before changing commands or UI.
    **Log (append-only):**
    - 2026-08-01: Flagged because replace-by-default feedback conflicts with the completed contextual paste contract.

78. **[TODO] Prepare the V1 release**
    **Acceptance:** Type checking, linting, automated tests, and production build pass; release behavior matches the resolved V1 scope and human-attention decisions; deferred features remain absent; known limitations and any `LOST` schedule items are recorded without rewriting history.
    **Log (append-only):**
