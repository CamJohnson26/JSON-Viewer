# JSON Viewer

A local-first graphical JSON editor built with React, TypeScript, Vite, and xState. JSON data remains in the browser; there is no backend, raw JSON editing surface, analytics, or local persistence.

## Requirements

- Node.js 24 or newer
- npm
- Latest stable Chrome for the supported browser workflows

## Development

```bash
npm ci
npm run dev
```

Useful checks:

```bash
npm run typecheck
npm run lint
npm run format:check
npm test
npm run test:browser
npm run test:all
```

Create and preview a local production build:

```bash
npm run build
npm run preview
```

## Editing

- `Enter` opens one contextual row composer inside a header or beneath a value.
- `Alt+Enter` opens a header composer in the same location.
- Typing on a focused value or non-root header starts direct editing.
- `Escape` cancels an editor or composer.
- `Ctrl/Cmd+Z` and `Ctrl/Cmd+Shift+Z` undo and redo document changes.
- `Ctrl/Cmd+Shift+P` opens the command palette.
- Right click or `Shift+F10` opens applicable row actions.
- `Alt+ArrowRight`/`Alt+ArrowLeft` expands or collapses a header and all descendants; `Alt+Space` or Alt-click toggles them together.

The interface derives object/array presentation, generated row references, and formatting without adding editor metadata to exported JSON.

## GitHub Pages

The deployment workflow publishes the `master` branch to:

`https://camjohnson26.github.io/JSON-Viewer/`

Initial repository setup:

1. The repository is currently private. Use a GitHub plan that supports Pages for private repositories, or make the repository public.
2. Open **Settings > Pages** in `CamJohnson26/JSON-Viewer`.
3. Under **Build and deployment**, choose **GitHub Actions** as the source.
4. Push the committed workflow and application changes to `master`.
5. Follow the **Deploy to GitHub Pages** run under the repository's **Actions** tab.

Every later push to `master` builds and deploys automatically. A maintainer can also run the workflow manually with **Actions > Deploy to GitHub Pages > Run workflow**.

The workflow sets `GITHUB_PAGES=true`, which builds assets under `/JSON-Viewer/`. Local development and ordinary production builds continue using `/`. A future custom domain should use `/` instead and requires corresponding Pages and DNS configuration.

## Current Scope

File import/export, URL persistence, large-document virtualization, and final release hardening remain scheduled work. See `Schedule.md` for current progress and acceptance criteria.
