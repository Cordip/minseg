# Frontend Refactoring: Electron → Tauri + TypeScript + Vite

## Goal

Rewrite the frontend from a 1600-line monolithic JavaScript file with Electron to a modular TypeScript application using Tauri v2, Vite, and React 19. Fix all architectural issues (TDZ errors, race conditions, API duplication, dead code) and reduce binary size from ~280MB to ~135MB.

## Background

The current frontend has two JS files (`app-bundle.js` — working 1159 lines, `app.js` — broken 1597 lines), an Electron shell (main.js + preload.js), and React loaded via CDN. The monolithic `app-bundle.js` has 27 useState variables, 23 API calls, 11 useEffect hooks in a single App component. Adding features cascades into multiple unrelated state changes. TDZ errors prevent esbuild minification with identifier renaming.

## Tech Stack

| Component | Choice |
|-----------|--------|
| Language | TypeScript (strict mode) |
| UI | React 19 (npm) |
| Desktop shell | Tauri v2 (Rust, system WebView) |
| Dev/Bundler | Vite + `@vitejs/plugin-react` |
| State | React hooks + `useReducer` for complex groups |
| CSS | Single `main.css` |
| Backend | Python FastAPI (unchanged, communicates via HTTP on dynamic port) |

## Architecture Change

### Before

```
Electron (main.js, 267 lines, Node.js)
├── preload.js (110 lines, Node.js)
├── index.html (inline JS, image loading)
├── app.html (loads CDN React + app-bundle.js)
├── app-bundle.js (1159 lines, monolith)
├── bytenode (V8 bytecode compilation)
├── esbuild (minification)
└── electron-builder (packaging)
```

### After

```
Tauri v2 (src-tauri/, ~50 lines Rust boilerplate)
├── src/
│   ├── app.tsx (~150 lines, orchestrator)
│   ├── api.ts (typed API client)
│   ├── types.ts (all interfaces)
│   ├── hooks/ (6 custom hooks)
│   └── components/ (11 components)
├── Vite (dev server + bundler)
└── tauri build (packaging)
```

## What Gets Removed

| Item | Reason |
|------|--------|
| Electron (`main.js`, `preload.js`, `main-entry.js`) | Replaced by Tauri |
| `app-bundle.js` (1159 lines) | Rewritten as modular TypeScript |
| `app.js` (1597 lines) | Broken dev version, not needed |
| `index.html` (inline JS) | Merged into React SPA |
| `app.html` | Vite manages HTML entry |
| CDN React scripts | React via npm |
| `src/shims/` | Not needed with npm React |
| `esbuild.config.mjs` | Vite replaces esbuild |
| `bytenode` | No Node.js to protect |
| `electron-builder` | Tauri has built-in bundler |
| `javascript-obfuscator` | Already removed, Vite minifies |

## File Structure

```
frontend/
├── index.html                     # Vite entry point (minimal)
├── vite.config.ts                 # Vite + React plugin config
├── tsconfig.json                  # TypeScript config
├── package.json                   # Dependencies
│
├── src/
│   ├── main.tsx                   # React root mount
│   ├── App.tsx                    # Root component, screen routing, hook orchestration
│   ├── api.ts                     # Typed API client (23 endpoints)
│   ├── types.ts                   # All TypeScript interfaces
│   │
│   ├── hooks/
│   │   ├── useApi.ts              # API initialization, dynamic port from Tauri
│   │   ├── useKeyboard.ts         # Keyboard shortcuts (ref pattern, keymap object)
│   │   ├── useSegmentation.ts     # Progress polling, patchStates, AbortController
│   │   ├── useCanvas.ts           # Zoom, pan, offset with refs
│   │   ├── useTree.ts             # useReducer: treeData, expandedNodes, selection
│   │   └── useTagging.ts          # Tags, undo/redo, quickInput, applyTag
│   │
│   ├── components/
│   │   ├── Toolbar.tsx            # Top button bar (stateless)
│   │   ├── Minimap.tsx            # Patch grid overview (React.memo)
│   │   ├── ImageViewer.tsx        # Multi-layer canvas viewer
│   │   ├── TagPanel.tsx           # Sidebar with tree + resize handle
│   │   ├── TreeNode.tsx           # Recursive tree node (React.memo)
│   │   ├── QuickInput.tsx         # Inline tag input with autocomplete
│   │   ├── ContextMenu.tsx        # Right-click menu
│   │   ├── WelcomeScreen.tsx      # Image loading (replaces index.html)
│   │   ├── HelpModal.tsx          # Keyboard shortcuts help
│   │   └── Toast.tsx              # Notifications
│   │
│   └── styles/
│       └── main.css               # All styles (migrated from current)
│
└── src-tauri/
    ├── Cargo.toml                 # Rust dependencies
    ├── tauri.conf.json            # Tauri config (window, sidecar, plugins)
    ├── capabilities/              # Permission policies
    └── src/
        └── main.rs                # Minimal: setup plugins, run app
```

## Tauri Integration

### Sidecar (Python Backend)

Tauri's sidecar feature manages the Nuitka-compiled backend binary:
- Bundled into the app package automatically
- Spawned on app start, killed on app close
- Dynamic port: Tauri picks a free port, passes via env `PORT`
- Frontend gets the port via Tauri IPC command

### Plugins

| Plugin | Replaces |
|--------|----------|
| `@tauri-apps/plugin-shell` | `child_process.spawn()` in main.js |
| `@tauri-apps/plugin-dialog` | Electron's `dialog.showOpenDialog()` |
| `@tauri-apps/plugin-fs` | `fs.readFileSync()` in preload.js (may not be needed — backend reads files by path) |

### IPC

Electron's `ipcMain.handle` / `window.electronAPI` replaced by Tauri commands:

```typescript
// Tauri command (Rust side)
#[tauri::command]
fn get_api_url(state: State<AppState>) -> String {
    state.api_url.clone()
}

// Frontend (TypeScript side)
import { invoke } from '@tauri-apps/api/core';
const apiUrl = await invoke<string>('get_api_url');
```

## API Client (`api.ts`)

Single typed module wrapping all 23 backend endpoints:

```typescript
interface Api {
  // Images
  loadPaths(paths: ImagePaths): Promise<StatusResponse>
  alignImages(): Promise<AlignResponse>

  // Segmentation
  startSegmentation(): Promise<void>
  getSegmentation(py: number, px: number): Promise<SegmentationData>
  requestPatchPriority(py: number, px: number): Promise<void>
  getProgress(): Promise<ProgressData>
  getStatus(): Promise<StatusData>

  // Viewing
  getPatch(py: number, px: number, imageType: string): Promise<ImageData>
  getMinimap(imageType: string): Promise<MinimapData>
  getSegmentAtPoint(py: number, px: number, x: number, y: number): Promise<SegmentInfo>
  getSelectionMask(py: number, px: number, ids: number[]): Promise<ImageData>
  getUntaggedMask(py: number, px: number): Promise<ImageData>

  // Tagging
  labelSegment(req: LabelRequest): Promise<void>
  batchLabel(req: BatchLabelRequest): Promise<void>
  untagSegments(req: UntagRequest): Promise<void>

  // Tag management
  getTags(): Promise<TagColors>
  getTagTree(): Promise<TreeData>
  renameTag(oldName: string, newName: string): Promise<void>
  recolorTag(tagName: string, newColor: string): Promise<void>
  deleteTag(tagName: string): Promise<void>

  // Undo/Redo
  undo(): Promise<UndoRedoResponse>
  redo(): Promise<UndoRedoResponse>
  getUndoStatus(): Promise<UndoStatus>

  // Export
  saveProject(outputPath: string): Promise<void>
  exportProject(outputPath: string): Promise<void>
}
```

All responses typed. Errors thrown as exceptions. No business logic — only fetch + JSON parse.

## Custom Hooks

### `useApi.ts`
- Gets API URL from Tauri IPC
- Creates typed `Api` instance
- Returns `{ api, isReady }`

### `useSegmentation.ts`
- State: `segmentationProgress`, `isSegmenting`, `patchStates`, `patchReady`, `showUntagged`
- Adaptive polling calls both `getStatus()` and `getProgress()`, merges data (separate endpoints)
- When patch status is not 'ready': POST `requestPatchPriority()` to queue it, then poll `getSegmentation()` every 2s until ready. Stop polling once `patchReady` is true
- Debounce segmentation loading by 300ms after patch changes. Guard against overlapping loads
- AbortController cancels requests on patch change
- `startSegmentation()`, `requestPatchPriority()`, `toggleUntagged()` (fetches `getUntaggedMask()` when toggled on)

### `useCanvas.ts`
- State: `zoom`, `offset`
- Refs: `zoomRef`, `offsetRef` (event handlers without re-renders)
- `handleWheel(delta, mouseX, mouseY)` — zoom to cursor
- `handlePan(dx, dy)` — pan with right mouse button
- `resetView()` — reset on patch change
- Wheel listener must be attached with `{ passive: false }` via callback ref or `useEffect` on the viewer DOM node. React 19's `onWheel` cannot `preventDefault` due to passive defaults

### `useTree.ts`
- `useReducer` with actions: `TOGGLE_NODE`, `SET_SELECTION`, `SHIFT_SELECT`, `REFRESH_TREE`
- Single state object: `{ treeData, expandedNodes, treeSelection, lastTreeClick }`
- `fetchTree()` — loads `/api/tag-tree` + `/api/undo-status`
- Computed: `flattenTreeKeys()`, `resolveTreeSelection()`

### `useTagging.ts`
- State: `tags`, `canUndo`, `canRedo`, `quickInput`, `quickFilter`, `quickHighlight`
- `applyTag(segments, tagName, color)` — single or batch
- `handleUndo()`, `handleRedo()`
- `tagColor(name)` — deterministic color generation
- Callbacks: `onRefreshTree()`, `onReloadPatch()` after operations

### `useKeyboard.ts`
- Accepts handler object: `{ onUndo, onRedo, onNavigate, onToggleXpl, onTogglePpl, onToggleSegments, onToggleBounds, onToggleUntagged, onSave, onLoad }`
- `useRef` for handlers (register listener once, ref always fresh)
- Toggle keys (S, B, X, P, U) use 200ms input buffering with odd/even evaluation — rapid double-press cancels out. Arrow keys sum displacements within the buffer window
- Immediate keys (Ctrl+Z, Ctrl+Y, H, Escape, Enter) bypass the buffer
- Blocks hotkeys when modal/quickInput is open

## Components

### `App.tsx` (~200-250 lines)
- Assembles all hooks
- Two screens: `WelcomeScreen` → Editor (based on `imagesAligned` flag)
- Passes props to components, no business logic
- Manages: `currentPatch`, `currentView`, `isXpl`, `isXpl90`, `showSegments`, `showBounds`, `showHelp`, `selectedSegments`, `contextMenu`, `gridSize`, `imagesAligned`, `minimapData`
- UI language: Russian (all labels, buttons, messages). Helper `pluralSeg(n)` for Russian plural forms

### `WelcomeScreen.tsx` (replaces index.html)
- Image loading via Tauri file picker dialog
- Auto-detection of PPL/XPL from filenames
- Assignment modal when auto-detect fails
- Progress bar for alignment
- Calls `/api/load-all-paths`, `/api/align-images`, `/api/start-segmentation`

### `Toolbar.tsx` (stateless)
- Buttons: PPL/XPL, 45°/90°, Segments, Bounds, Untagged (red toggle)
- Patch navigation (arrows + counter)
- Undo/Redo buttons
- Save / Export

### `ImageViewer.tsx`
- Multi-layer canvas: background, bounds, segments, borders, untagged, selection
- Zoom/pan via props from `useCanvas`
- Ctrl+click for multi-select
- Green striped mask for selected segments

### `Minimap.tsx` (React.memo)
- Redraw only on `patchStates` change (not every 200ms)
- Custom comparator for memo
- Per-patch state visualization (processing/queued/done)
- Click navigates to patch AND resets zoom/offset to defaults

### `TagPanel.tsx`
- Renders tree via `TreeNode`
- Sidebar resize handle
- QuickInput embedded at bottom

### `TreeNode.tsx` (React.memo, recursive)
- 3 levels: Tag → Patch → Segment
- Props: `node`, `level`, `expanded`, `selected`, `onToggle`, `onClick`, `onContextMenu`

### `QuickInput.tsx`
- Inline input with substring-match autocomplete (max 8 suggestions)
- Arrow keys navigate suggestions
- Tab fills input with highlighted suggestion
- Enter to apply, Escape to close
- Auto-focus on open

### `ContextMenu.tsx`
- Positioned at click coordinates
- Level-aware actions: rename/recolor/delete (tag), navigate (patch), select (segment)
- Rename uses inline input component (not `window.prompt()` — unreliable in Tauri WebView)
- `deleteConfirm` is internal state of this component
- Inline delete confirmation

### `HelpModal.tsx`
- Keyboard shortcuts reference
- Closes on Escape or backdrop click

### `Toast.tsx`
- Auto-dismiss after 3s
- Types: info, success, error

## Bug Fixes in New Architecture

| Bug | Solution |
|-----|----------|
| TDZ (`loadCurrentPatch` before init) | Hooks in separate files — imports resolved at module level |
| Race conditions (patch change during load) | AbortController in `useSegmentation` |
| `/api/tags` called 4x per operation | `useTagging` caches tags, refreshes once after operation |
| Minimap redraws every 200ms | `React.memo` + redraw only on `patchStates` change |
| Dead code (`zoomToSegment`, `loadMinimap`) | Not carried over to new architecture |
| Keyboard re-registration (useEffect with 5 deps) | `useKeyboard` with ref pattern — register once |
| Tree state desync (4 separate useState) | `useReducer` in `useTree` — atomic updates |
| `index.html` + `app.html` page switch | Single SPA, no page navigation |

## Build Pipeline

### Before (5 steps)
```
Nuitka → npm install → bytenode → esbuild → electron-builder
```

### After (2 steps)
```
Nuitka (backend) → tauri build (Vite + Rust + packaging)
```

`tauri build` handles: Vite production build, Rust compilation, sidecar bundling, platform packaging (AppImage/deb on Linux, MSI/exe on Windows).

### CI/CD

GitHub Actions matrix stays the same (Linux + Windows), but steps simplify:
1. Install Python, Rust, Node.js
2. Install deps, run backend tests
3. Nuitka compile backend
4. `npx tauri build`
5. Upload artifacts

### Binary Size

| Component | Before (Electron) | After (Tauri) |
|-----------|-------------------|---------------|
| Backend (Nuitka) | ~130MB | ~130MB |
| Desktop shell | ~150MB (Chromium) | ~5MB (system WebView) |
| **Total** | **~280MB** | **~135MB** |

## Migration Strategy

Write from scratch in new `frontend/` structure. Keep working `app-bundle.js` in git until complete.

**Phase 1: Setup**
- `npm create tauri-app` scaffold
- Install React 19, TypeScript, Vite
- Configure sidecar for Nuitka backend binary
- Single `App.tsx` with "Hello World" — verify Tauri + Vite + React works

**Phase 2: Infrastructure**
- `types.ts` — all interfaces
- `api.ts` — typed API client
- `hooks/useApi.ts` — initialization via Tauri IPC

**Phase 3: WelcomeScreen**
- Replace `index.html` with React component
- Image loading, assignment, alignment, progress
- Tauri dialog plugin for file picker

**Phase 4: Hooks**
- `useKeyboard`, `useCanvas`, `useSegmentation`, `useTree`, `useTagging`
- Each tested via dev run against real backend

**Phase 5: Components**
- Toolbar, Minimap, ImageViewer, TagPanel, TreeNode, QuickInput, ContextMenu
- Each connected one by one

**Phase 6: Integration**
- `App.tsx` assembles everything
- Smoke test: load → segment → tag → undo/redo → export
- Remove old files: `app-bundle.js`, `app.js`, `main.js`, `preload.js`, `main-entry.js`, shims, `esbuild.config.mjs`

**Rollback:** At any phase, switch back to working `app-bundle.js` + Electron — it stays in git.
