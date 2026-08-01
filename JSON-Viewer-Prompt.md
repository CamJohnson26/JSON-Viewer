We are going to build a performant frontend application to edit JSON graphically.

Tech Stack
* React for component hierarchy
* Typescript as base language
* WebAssembly for operations where speed is critical
* BaseUI for component design
* Tailwind for styles
* xState for business logic (recommend alternative if this is not a good fit)
* MobX and Observables for frontend state (Recommend alternative if not a good fit)
* No backend or server side rendering
* Vite for builds
* npm for package management

Design Principles
* Performance is the key concern. We want instant updates and immediate feedback. If choosing between a fancy implementation and a fast one, choose the fast one.
* Fully event driven architecture. Every event should be undoable and replayable
* Idempotent, pure functions with single responsibility
* Domain driven design and folder hierarchy
* Muted, pastel and earthy colors. Simple performant design. No bootstrap/web 2.0 look, borrow from the Sublime Text design aesthetic
* Intuitive, instant interactions. Operqations should just work, and instantly
* Short, pithy code comments that get straight to the point. No wordy explanations that provide no value.
* Obsessively organized code file structure.

Features
* Simple page with no banners, wordy explanations, or fancy features.
* JSON Viewer:
  * A hierarchical display of the json data, graphically. An object or array is represented as a colored bar, full width. Clicking the bar expands or contracts the section. On initial load, show a blank bar with nothing underneath it. We'll call this the JSON Header
  * A blank input under each JSON Header. When the user types in a value, this immediately becomes a value to the parent object. A JSON header with only values under it is an array, a Header with a single value is an object, where the Header's value is the key, and the child's is the value.
  * Separate colors for numbers, strings, dates, and separate formatting for each. Infer the data type from its content.
  * JSON Headers are selectable and keyboard navigable. Space expands/collapses a section instantly
  * Headers can be copy/pasted as raw JSON.
  * Multiple headers and values can be selected at once, to allow utility operations to act on the values
  * Headers and values can be dragged
* The raw JSON is base64 encoded and compressed in the page's URL, so that JSON can be shared easily to other machines.
* A right click menu contains a comprehensive list of JSON tools that can be useful, focused mainly on manipulating and editing data. Generate a list of these features, but a good start is UPPER CASE, lower case, find and replace, etc.

Validate this plan and suggest alternate approaches, missing features, and other cleanup. Ask any questions necessary, and when finished save your plan as JSON-Viewer-Plan.md