# Frontend Refactor Phase 1: Tauri + Vite + React 19 + TypeScript Setup

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Electron with Tauri v2, set up Vite + React 19 + TypeScript, configure sidecar for Python backend, and render a minimal working app that connects to the backend API.

**Architecture:** Tauri v2 provides the desktop shell with system WebView. Vite bundles the React 19 + TypeScript frontend. The Nuitka-compiled Python backend runs as a Tauri sidecar with dynamic port allocation. Frontend communicates with backend via HTTP (same as before).

**Tech Stack:** Tauri v2, Vite, React 19, TypeScript, @tauri-apps/plugin-shell, @tauri-apps/plugin-dialog

**Spec:** `docs/superpowers/specs/2026-03-14-frontend-refactor-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `frontend/package.json` | Rewrite | New deps: react, react-dom, @tauri-apps/cli, @tauri-apps/api, plugins |
| `frontend/tsconfig.json` | Create | TypeScript strict config |
| `frontend/tsconfig.node.json` | Create | TypeScript config for Vite config file |
| `frontend/vite.config.ts` | Create | Vite + React plugin config |
| `frontend/index.html` | Create | Vite entry point (replaces public/index.html + app.html) |
| `frontend/src/main.tsx` | Create | React root mount |
| `frontend/src/App.tsx` | Create | Minimal App component with API status check |
| `frontend/src/api.ts` | Create | Typed API client (only root endpoint for now) |
| `frontend/src/types.ts` | Create | Core TypeScript interfaces |
| `frontend/src/styles/main.css` | Keep | Existing styles (unchanged) |
| `frontend/src-tauri/Cargo.toml` | Create | Rust dependencies |
| `frontend/src-tauri/tauri.conf.json` | Create | Tauri config: window, sidecar, plugins |
| `frontend/src-tauri/capabilities/default.json` | Create | Tauri permissions |
| `frontend/src-tauri/src/main.rs` | Create | Rust entry: setup plugins, get_api_url command |
| `frontend/src-tauri/src/lib.rs` | Create | Tauri app builder |
| `frontend/src-tauri/icons/` | Create | App icons (can use defaults initially) |
| `build.sh` | Modify | Replace electron-builder with tauri build |
| `build.bat` | Modify | Same for Windows |
| `justfile` | Modify | Update dev/build/run commands |
| `.github/workflows/build.yml` | Modify | Add Rust toolchain, use tauri-action |

### Files to delete (after Phase 1 is working):

| File | Reason |
|------|--------|
| `frontend/main.js` | Electron main process → replaced by Tauri |
| `frontend/preload.js` | Electron preload → replaced by Tauri IPC |
| `frontend/main-entry.js` | Bytenode entry → not needed |
| `frontend/main.jsc` | Compiled bytecode → not needed |
| `frontend/esbuild.config.mjs` | Replaced by Vite |
| `frontend/src/shims/` | Not needed with npm React |
| `frontend/src/app.js` | Broken dev version |
| `frontend/src/app-bundle.js` | Old monolith (kept until Phase 3 complete) |
| `frontend/src/app-bundle.obf.js` | Obfuscated version |
| `frontend/public/index.html` | Replaced by Vite entry |
| `frontend/public/app.html` | Merged into SPA |

---

## Chunk 1: Tauri Scaffold + Vite + React 19

### Task 1: Initialize Tauri project

**Files:**
- Modify: `frontend/package.json`
- Create: `frontend/tsconfig.json`
- Create: `frontend/tsconfig.node.json`
- Create: `frontend/vite.config.ts`
- Create: `frontend/index.html`
- Create: `frontend/src/main.tsx`
- Create: `frontend/src/App.tsx`
- Create: `frontend/src-tauri/` (via `npx @tauri-apps/cli init`)

- [ ] **Step 1: Install Tauri CLI**

```bash
cd frontend
npm install -D @tauri-apps/cli@latest
```

- [ ] **Step 2: Create new package.json**

Replace `frontend/package.json` with new dependencies. Keep existing `name`, `version`, `description`.

```json
{
  "name": "mineral-segmentation-app",
  "version": "2.0.0",
  "description": "Desktop application for mineral grain segmentation and annotation",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "tauri": "tauri"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "@tauri-apps/api": "^2.0.0",
    "@tauri-apps/plugin-shell": "^2.0.0",
    "@tauri-apps/plugin-dialog": "^2.0.0"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.0.0",
    "typescript": "^5.7.0",
    "vite": "^6.0.0"
  }
}
```

- [ ] **Step 3: Create TypeScript config**

Create `frontend/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true
  },
  "include": ["src"]
}
```

Create `frontend/tsconfig.node.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "strict": true
  },
  "include": ["vite.config.ts"]
}
```

- [ ] **Step 4: Create Vite config**

Create `frontend/vite.config.ts`:

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: 'esnext',
    minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_DEBUG,
  },
});
```

- [ ] **Step 5: Create Vite entry HTML**

Create `frontend/index.html` (Vite entry point — this is NOT public/index.html):

```html
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Mineral Segmentation</title>
  <link rel="stylesheet" href="/src/styles/main.css" />
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
</html>
```

- [ ] **Step 6: Create React entry point**

Create `frontend/src/main.tsx`:

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

- [ ] **Step 7: Create minimal App component**

Create `frontend/src/App.tsx`:

```tsx
import { useState, useEffect } from 'react';

export default function App() {
  const [apiStatus, setApiStatus] = useState<string>('Connecting...');

  useEffect(() => {
    fetch('http://127.0.0.1:8001/')
      .then(r => r.json())
      .then(d => setApiStatus(d.message))
      .catch(() => setApiStatus('Backend not running'));
  }, []);

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      background: '#1a1a2e',
      color: '#eaeaea',
      fontFamily: 'system-ui',
    }}>
      <div style={{ textAlign: 'center' }}>
        <h1>Mineral Segmentation v2</h1>
        <p>Tauri + Vite + React 19 + TypeScript</p>
        <p>Backend: {apiStatus}</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Install npm dependencies**

```bash
cd frontend
rm -rf node_modules package-lock.json
npm install
```

- [ ] **Step 9: Verify Vite dev server starts**

```bash
cd frontend
npm run dev
```

Expected: Vite starts on http://localhost:1420, shows the React app in browser.
**Stop the Vite server (Ctrl+C) before proceeding to Step 10.**

- [ ] **Step 10: Commit**

```bash
git add frontend/package.json frontend/tsconfig.json frontend/tsconfig.node.json \
  frontend/vite.config.ts frontend/index.html frontend/src/main.tsx frontend/src/App.tsx
git commit -m "feat: scaffold Vite + React 19 + TypeScript"
```

---

### Task 2: Configure sidecar for Python backend

**Files:**
- Modify: `frontend/src-tauri/tauri.conf.json`
- Modify: `frontend/src-tauri/Cargo.toml`
- Modify: `frontend/src-tauri/src/main.rs`
- Modify: `frontend/src-tauri/src/lib.rs`
- Create: `frontend/src-tauri/capabilities/default.json`

- [ ] **Step 1: Create `src-tauri/` directory and Cargo.toml**

```bash
mkdir -p frontend/src-tauri/src frontend/src-tauri/icons frontend/src-tauri/capabilities frontend/src-tauri/binaries
```

Create `frontend/src-tauri/Cargo.toml`:

```toml
[package]
name = "mineral-segmentation"
version = "2.0.0"
edition = "2021"

[lib]
name = "mineral_segmentation_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-shell = "2"
tauri-plugin-dialog = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

Create `frontend/src-tauri/build.rs`:

```rust
fn main() {
    tauri_build::build();
}
```

- [ ] **Step 2: Configure sidecar in tauri.conf.json**

Update `frontend/src-tauri/tauri.conf.json` — add sidecar bundle config and window settings:

```json
{
  "$schema": "../node_modules/@tauri-apps/cli/schema.json",
  "productName": "Mineral Segmentation",
  "version": "2.0.0",
  "identifier": "com.mineral.segmentation",
  "build": {
    "beforeDevCommand": "npm run dev",
    "devUrl": "http://localhost:1420",
    "beforeBuildCommand": "npm run build",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [
      {
        "title": "Mineral Segmentation",
        "width": 1200,
        "height": 800,
        "minWidth": 900,
        "minHeight": 600
      }
    ],
    "security": {
      "csp": "default-src 'self'; connect-src 'self' http://127.0.0.1:*; script-src 'self'; style-src 'self' 'unsafe-inline'"
    }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ],
    "externalBin": ["binaries/backend"]
  }
}
```

- [ ] **Step 3: Create capabilities**

Create `frontend/src-tauri/capabilities/default.json`:

```json
{
  "identifier": "default",
  "description": "Default capabilities for the app",
  "windows": ["main"],
  "permissions": [
    "core:default",
    {
      "identifier": "shell:allow-execute",
      "allow": [{ "name": "binaries/backend", "sidecar": true }]
    },
    "shell:allow-spawn",
    "dialog:allow-open",
    "dialog:allow-save",
    "dialog:allow-message"
  ]
}
```

Note: The scoped `shell:allow-execute` permission is required for Tauri v2 to allow the sidecar binary to run.

- [ ] **Step 4: Write Rust backend with sidecar + dynamic port**

Create `frontend/src-tauri/src/lib.rs`:

```rust
use std::net::TcpListener;
use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_shell::ShellExt;

struct AppState {
    api_url: Mutex<String>,
}

#[tauri::command]
fn get_api_url(state: tauri::State<AppState>) -> String {
    state.api_url.lock().unwrap().clone()
}

fn find_free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .expect("Failed to bind to a free port")
        .local_addr()
        .expect("Failed to get local address")
        .port()
}

pub fn run() {
    let port = find_free_port();
    let api_url = format!("http://127.0.0.1:{}", port);

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            api_url: Mutex::new(api_url.clone()),
        })
        .invoke_handler(tauri::generate_handler![get_api_url])
        .setup(move |app| {
            // Set PORT env var so sidecar inherits it
            std::env::set_var("PORT", port.to_string());

            let shell = app.shell();
            let (mut _rx, _child) = shell
                .sidecar("backend")
                .expect("Failed to find backend sidecar binary")
                .spawn()
                .expect("Failed to spawn backend sidecar");

            println!("Backend started on port {}", port);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Error while running Tauri application");
}
```

Create `frontend/src-tauri/src/main.rs`:

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    mineral_segmentation_lib::run();
}
```

- [ ] **Step 5: Set up sidecar binary for dev**

The sidecar binary name must include the target triple. For development, create a wrapper script that runs the Python backend:

```bash
# Linux dev wrapper:
cat > frontend/src-tauri/binaries/backend-x86_64-unknown-linux-gnu << 'SCRIPT'
#!/bin/bash
BACKEND_DIR="$(cd "$(dirname "$0")" && pwd)"
# Find the backend directory — check common locations
for d in "$BACKEND_DIR/../../../../backend" "$HOME/Gits/python/two/new2/backend"; do
    if [ -f "$d/main.py" ]; then
        cd "$d"
        exec .venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port "${PORT:-8001}"
    fi
done
echo "ERROR: backend/main.py not found" >&2
exit 1
SCRIPT
chmod +x frontend/src-tauri/binaries/backend-x86_64-unknown-linux-gnu
```

For production builds, `build.sh` copies the Nuitka binary here, overwriting the dev script.

**Alternative for dev:** Run backend separately with `just backend` and skip sidecar issues entirely. The App.tsx will connect to whatever port the backend is on.

- [ ] **Step 6: Update App.tsx to use Tauri IPC for API URL**

```tsx
import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';

export default function App() {
  const [apiStatus, setApiStatus] = useState<string>('Starting backend...');

  useEffect(() => {
    const init = async () => {
      try {
        const apiUrl = await invoke<string>('get_api_url');

        // Poll until backend is ready (up to 30 attempts, 500ms apart)
        for (let i = 0; i < 30; i++) {
          try {
            const res = await fetch(`${apiUrl}/`);
            const data = await res.json();
            setApiStatus(`Connected: ${data.message}`);
            return;
          } catch {
            setApiStatus(`Waiting for backend... (${i + 1}/30)`);
            await new Promise(r => setTimeout(r, 500));
          }
        }
        setApiStatus('Backend failed to start');
      } catch (e) {
        setApiStatus(`Error: ${e}`);
      }
    };
    init();
  }, []);

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      background: '#1a1a2e',
      color: '#eaeaea',
      fontFamily: 'system-ui',
    }}>
      <div style={{ textAlign: 'center' }}>
        <h1>Mineral Segmentation v2</h1>
        <p>Tauri + Vite + React 19 + TypeScript</p>
        <p>Backend: {apiStatus}</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Build and test Tauri with sidecar**

```bash
cd frontend
npm run tauri dev
```

Expected: Tauri window opens, backend sidecar starts on a dynamic port, status shows "Connected: Mineral Segmentation API is running".

- [ ] **Step 8: Commit**

```bash
git add frontend/src-tauri/ frontend/src/App.tsx
git commit -m "feat: configure Tauri sidecar for Python backend with dynamic port"
```

---

## Chunk 2: Types, API Client, and Build Pipeline

### Task 3: Create core types

**Files:**
- Create: `frontend/src/types.ts`

- [ ] **Step 1: Create types file**

Create `frontend/src/types.ts` with all interfaces from the spec:

```typescript
// Image paths for loading
export interface ImagePaths {
  ppl45: string;
  ppl90: string;
  xpl45: string;
  xpl90: string;
}

// API responses
export interface StatusResponse {
  status: string;
  message?: string;
}

export interface AlignResponse {
  status: string;
  grid_size: { rows: number; cols: number };
  image_size: { width: number; height: number };
}

export interface SegmentationData {
  status: string;
  colored_segments?: string; // base64
  bounds?: string; // base64
  borders?: string; // base64
  segment_tags?: Record<number, string>;
  total_segs?: number;
  tagged_segs?: number;
}

export interface ProgressData {
  total: number;
  completed: number;
  is_running: boolean;
  processed: number[][];
  current_active: number[][];
  pending: number[][];
}

export interface StatusData {
  images_loaded: boolean;
  images_aligned: boolean;
  grid_size: { rows: number; cols: number };
  segmented_patches: number;
  total_patches: number;
  is_segmenting: boolean;
  total_segments: number;
  tagged_segments: number;
  untagged_segments: number;
}

export interface ImageData {
  image: string; // base64
}

export interface MinimapData {
  image: string; // base64
  scale: number;
}

export interface SegmentInfo {
  status: string;
  segment_id: number;
  tag: string | null;
  color: string | null;
}

export interface TagColors {
  tag_colors: Record<string, string>;
}

export interface TreeTag {
  name: string;
  color: string;
  total_segments: number;
  patches: TreePatch[];
}

export interface TreePatch {
  patch_y: number;
  patch_x: number;
  count: number;
  segments: number[];
}

export interface TreeData {
  tags: TreeTag[];
}

export interface UndoRedoResponse {
  status: string;
  type?: string;
  description?: string;
  can_undo: boolean;
  can_redo: boolean;
}

export interface UndoStatus {
  can_undo: boolean;
  can_redo: boolean;
  undo_count: number;
  redo_count: number;
}

// Request types
export interface LabelRequest {
  patch_y: number;
  patch_x: number;
  segment_id: number;
  tag: string;
  color: string;
}

export interface BatchLabelRequest {
  tag_name: string;
  color: string | null;
  segments: Array<{ patch_y: number; patch_x: number; segment_id: number }>;
}

export interface UntagRequest {
  segments: Array<{ patch_y: number; patch_x: number; segment_id: number }>;
}

// App state types
export type PatchState = 'processed' | 'active' | 'pending';

export interface PatchCoord {
  y: number;
  x: number;
}

export interface SelectedSegment {
  id: number;
  patchY: number;
  patchX: number;
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/types.ts
git commit -m "feat: add TypeScript type definitions for all API contracts"
```

---

### Task 4: Create typed API client

**Files:**
- Create: `frontend/src/api.ts`

- [ ] **Step 1: Create API client**

Create `frontend/src/api.ts`:

```typescript
import type {
  ImagePaths, StatusResponse, AlignResponse, SegmentationData,
  ProgressData, StatusData, ImageData, MinimapData, SegmentInfo,
  TagColors, TreeData, UndoRedoResponse, UndoStatus,
  LabelRequest, BatchLabelRequest, UntagRequest,
} from './types';

export function createApi(baseUrl: string) {
  async function get<T>(endpoint: string): Promise<T> {
    const res = await fetch(`${baseUrl}${endpoint}`);
    if (!res.ok) throw new Error(`API ${res.status}: ${endpoint}`);
    return res.json();
  }

  async function post<T>(endpoint: string, data?: unknown): Promise<T> {
    const res = await fetch(`${baseUrl}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: data ? JSON.stringify(data) : undefined,
    });
    if (!res.ok) throw new Error(`API ${res.status}: ${endpoint}`);
    return res.json();
  }

  return {
    // Images
    loadPaths: (paths: ImagePaths) =>
      post<StatusResponse>('/api/load-all-paths', paths),
    alignImages: () =>
      post<AlignResponse>('/api/align-images'),

    // Segmentation
    startSegmentation: () =>
      post<StatusResponse>('/api/start-segmentation'),
    getSegmentation: (py: number, px: number) =>
      get<SegmentationData>(`/api/segmentation/${py}/${px}`),
    requestPatchPriority: (py: number, px: number) =>
      post<StatusResponse>(`/api/segment-patch/${py}/${px}`),
    getProgress: () =>
      get<ProgressData>('/api/segmentation-progress'),
    getStatus: () =>
      get<StatusData>('/api/status'),

    // Viewing
    getPatch: (py: number, px: number, imageType: string) =>
      get<ImageData>(`/api/patch/${py}/${px}?image_type=${imageType}`),
    getMinimap: (imageType: string) =>
      get<MinimapData>(`/api/minimap?image_type=${imageType}`),
    getSegmentAtPoint: (py: number, px: number, x: number, y: number) =>
      get<SegmentInfo>(`/api/patch-segment-at-point/${py}/${px}?x=${x}&y=${y}`),
    getSelectionMask: (py: number, px: number, ids: number[]) =>
      get<ImageData>(`/api/selection-mask/${py}/${px}?ids=${ids.join(',')}`),
    getUntaggedMask: (py: number, px: number) =>
      get<ImageData>(`/api/untagged-mask/${py}/${px}`),

    // Tagging
    labelSegment: (req: LabelRequest) =>
      post<StatusResponse>('/api/label-segment', req),
    batchLabel: (req: BatchLabelRequest) =>
      post<StatusResponse>('/api/batch-label', req),
    untagSegments: (req: UntagRequest) =>
      post<StatusResponse>('/api/untag-segments', req),

    // Tag management
    getTags: () =>
      get<TagColors>('/api/tags'),
    getTagTree: () =>
      get<TreeData>('/api/tag-tree'),
    renameTag: (oldName: string, newName: string) =>
      post<StatusResponse>('/api/rename-tag', { old_name: oldName, new_name: newName }),
    recolorTag: (tagName: string, newColor: string) =>
      post<StatusResponse>('/api/recolor-tag', { tag_name: tagName, new_color: newColor }),
    deleteTag: (tagName: string) =>
      post<StatusResponse>('/api/delete-tag', { tag_name: tagName }),

    // Undo/Redo
    undo: () =>
      post<UndoRedoResponse>('/api/undo'),
    redo: () =>
      post<UndoRedoResponse>('/api/redo'),
    getUndoStatus: () =>
      get<UndoStatus>('/api/undo-status'),

    // Export
    saveProject: (outputPath: string) =>
      post<StatusResponse>('/api/save-project', { output_path: outputPath }),
    exportProject: (outputPath: string) =>
      post<StatusResponse>('/api/export', { output_path: outputPath }),
  };
}

export type Api = ReturnType<typeof createApi>;
```

- [ ] **Step 2: Update App.tsx to use typed API**

Update `frontend/src/App.tsx`:

```tsx
import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { createApi, type Api } from './api';

export default function App() {
  const [api, setApi] = useState<Api | null>(null);
  const [status, setStatus] = useState<string>('Starting backend...');

  useEffect(() => {
    const init = async () => {
      try {
        const apiUrl = await invoke<string>('get_api_url');
        const newApi = createApi(apiUrl);

        // Poll until backend is ready
        for (let i = 0; i < 30; i++) {
          try {
            const data = await newApi.getStatus();
            setApi(newApi);
            setStatus(`Connected. Aligned: ${data.images_aligned}`);
            return;
          } catch {
            setStatus(`Waiting for backend... (${i + 1}/30)`);
            await new Promise(r => setTimeout(r, 500));
          }
        }
        setStatus('Backend failed to start');
      } catch (e) {
        setStatus(`Error: ${e}`);
      }
    };
    init();
  }, []);

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      background: '#1a1a2e',
      color: '#eaeaea',
      fontFamily: 'system-ui',
    }}>
      <div style={{ textAlign: 'center' }}>
        <h1>Mineral Segmentation v2</h1>
        <p>Tauri + Vite + React 19 + TypeScript</p>
        <p>Backend: {status}</p>
        {api && <p style={{ color: '#4a9eff' }}>API client ready (24 endpoints typed)</p>}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd frontend
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Verify Tauri dev works with typed API**

```bash
cd frontend
npm run tauri dev
```

Expected: Window shows "Connected" status and "API client ready".

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api.ts frontend/src/App.tsx
git commit -m "feat: add typed API client with 24 endpoints"
```

---

### Task 5: Update build pipeline

**Files:**
- Modify: `build.sh`
- Modify: `build.bat`
- Modify: `justfile`
- Modify: `.github/workflows/build.yml`

- [ ] **Step 1: Update build.sh**

Replace the entire file:

```bash
#!/bin/bash
set -e

echo "================================================"
echo "   Mineral Segmentation - Protected Build"
echo "================================================"
echo

# Check dependencies
command -v uv &>/dev/null || { echo "ERROR: uv not found!"; exit 1; }
command -v node &>/dev/null || { echo "ERROR: Node.js not found!"; exit 1; }
command -v cargo &>/dev/null || { echo "ERROR: Rust not found!"; exit 1; }

# Step 1: Compile backend (Nuitka)
echo "[1/2] Compiling backend (Nuitka)..."
cd backend
uv pip install -r requirements.txt
rm -rf main.build main.onefile-build main.dist dist/backend

uv run python -m nuitka \
  --onefile \
  --output-dir=dist \
  --output-filename=backend \
  --follow-import-to=aligner,segmentation,undo \
  --nofollow-import-to=pytest,setuptools,pip,pyarmor \
  --include-module=cv2 \
  --include-module=numpy \
  --include-module=scipy \
  --include-module=skimage \
  --include-module=fastapi \
  --include-module=uvicorn \
  --include-module=pydantic \
  --include-module=starlette \
  --include-module=anyio \
  --include-module=multipart \
  --include-module=h11 \
  --include-module=PIL \
  --include-module=websockets \
  main.py

[ -f "dist/backend" ] || { echo "ERROR: Nuitka failed"; exit 1; }
echo "Backend compiled."

# Copy binary as Tauri sidecar
mkdir -p ../frontend/src-tauri/binaries
cp dist/backend ../frontend/src-tauri/binaries/backend-x86_64-unknown-linux-gnu
cd ..

# Step 2: Build Tauri app (Vite + Rust + packaging)
echo "[2/2] Building Tauri app..."
cd frontend
npm install
npm run tauri build

cd ..
echo
echo "================================================"
echo "   BUILD COMPLETE — Output in frontend/src-tauri/target/release/bundle/"
echo "================================================"
ls frontend/src-tauri/target/release/bundle/appimage/ 2>/dev/null || true
ls frontend/src-tauri/target/release/bundle/deb/ 2>/dev/null || true
```

- [ ] **Step 2: Update build.bat**

```batch
@echo off
setlocal enabledelayedexpansion
echo ================================================
echo   Mineral Segmentation - Protected Build
echo ================================================
echo.

where python >nul 2>&1
if errorlevel 1 ( echo ERROR: Python not found! && pause && exit /b 1 )
where node >nul 2>&1
if errorlevel 1 ( echo ERROR: Node.js not found! && pause && exit /b 1 )
where cargo >nul 2>&1
if errorlevel 1 ( echo ERROR: Rust not found! && pause && exit /b 1 )

:: Step 1: Compile backend (Nuitka)
echo [1/2] Compiling backend (Nuitka)...
cd backend
python -m pip install -r requirements.txt
if errorlevel 1 ( echo ERROR: pip install failed && cd .. && pause && exit /b 1 )

if exist main.build rmdir /s /q main.build
if exist main.onefile-build rmdir /s /q main.onefile-build
if exist main.dist rmdir /s /q main.dist
if exist dist\backend.exe del dist\backend.exe

python -m nuitka ^
  --assume-yes-for-downloads ^
  --onefile ^
  --output-dir=dist ^
  --output-filename=backend ^
  --follow-import-to=aligner,segmentation,undo ^
  --nofollow-import-to=pytest,setuptools,pip,pyarmor ^
  --include-module=cv2 ^
  --include-module=numpy ^
  --include-module=scipy ^
  --include-module=skimage ^
  --include-module=fastapi ^
  --include-module=uvicorn ^
  --include-module=pydantic ^
  --include-module=starlette ^
  --include-module=anyio ^
  --include-module=multipart ^
  --include-module=h11 ^
  --include-module=PIL ^
  --include-module=websockets ^
  main.py
if errorlevel 1 ( echo ERROR: Nuitka failed && cd .. && pause && exit /b 1 )
if not exist "dist\backend.exe" ( echo ERROR: backend.exe not found && cd .. && pause && exit /b 1 )
echo Backend compiled.

:: Copy binary as Tauri sidecar
if not exist ..\frontend\src-tauri\binaries mkdir ..\frontend\src-tauri\binaries
copy dist\backend.exe ..\frontend\src-tauri\binaries\backend-x86_64-pc-windows-msvc.exe
cd ..

:: Step 2: Build Tauri app
echo [2/2] Building Tauri app...
cd frontend
call npm install
call npx tauri build
if errorlevel 1 ( echo ERROR: Tauri build failed && cd .. && pause && exit /b 1 )
cd ..

echo.
echo ================================================
echo   BUILD COMPLETE
echo ================================================
dir frontend\src-tauri\target\release\bundle\nsis\*.exe 2>nul
pause
exit /b 0
```

- [ ] **Step 3: Update justfile**

```just
# Mineral Segmentation App — development commands

# List available commands
default:
	@just --list

# ─── Development ──────────────────────────────────────────────

# Run backend API server
[group('dev')]
backend:
	cd backend && uv run uvicorn main:app --host 127.0.0.1 --port 8001 --reload

# Run frontend with Tauri dev mode
[group('dev')]
frontend:
	cd frontend && npm run tauri dev

# Install all dependencies
[group('dev')]
install:
	cd backend && uv sync
	cd frontend && npm install

# ─── Testing ─────────────────────────────────────────────────

# Run backend tests
[group('test')]
test:
	cd backend && uv run pytest tests/ -v

# Run backend tests with coverage
[group('test')]
test-cov:
	cd backend && uv run pytest tests/ -v --cov=. --cov-report=term-missing

# Run a single test file
[group('test')]
test-file file:
	cd backend && uv run pytest {{file}} -v

# ─── Building ────────────────────────────────────────────────

# Full protected build (Linux)
[group('build')]
[linux]
build:
	bash build.sh

# Full protected build (Windows)
[group('build')]
[windows]
build:
	cmd /c build.bat

# ─── Run built app ────────────────────────────────────────────

# Launch built app (Linux)
[group('run')]
[linux]
run:
	./frontend/src-tauri/target/release/mineral-segmentation

# Launch built app (Windows)
[group('run')]
[windows]
run:
	frontend\src-tauri\target\release\mineral-segmentation.exe

# ─── Cleanup ─────────────────────────────────────────────────

# Remove backend build artifacts
[group('clean')]
clean-backend:
	rm -rf backend/build backend/dist

# Remove frontend build artifacts
[group('clean')]
clean-frontend:
	rm -rf frontend/dist frontend/src-tauri/target

# Remove all build artifacts
[group('clean')]
clean: clean-backend clean-frontend
```

- [ ] **Step 4: Update GitHub Actions workflow**

Replace `.github/workflows/build.yml`:

```yaml
name: Build

on:
  push:
    tags: ['v*']
  workflow_dispatch:

jobs:
  build:
    strategy:
      matrix:
        include:
          - os: ubuntu-latest
            artifact: Linux
          - os: windows-latest
            artifact: Windows
    runs-on: ${{ matrix.os }}

    steps:
      - uses: actions/checkout@v4

      - name: Install Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.13'

      - name: Install Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install Rust
        uses: dtolnay/rust-toolchain@stable

      - name: Install uv
        uses: astral-sh/setup-uv@v4

      - name: Install system deps (Linux)
        if: runner.os == 'Linux'
        run: |
          sudo apt-get update
          sudo apt-get install -y patchelf ccache \
            libwebkit2gtk-4.1-dev libappindicator3-dev \
            librsvg2-dev libgtk-3-dev

      - name: Cache Rust
        uses: actions/cache@v4
        with:
          path: |
            ~/.cargo/registry
            ~/.cargo/git
            frontend/src-tauri/target
          key: rust-${{ runner.os }}-${{ hashFiles('frontend/src-tauri/Cargo.lock') }}
          restore-keys: rust-${{ runner.os }}-

      - name: Cache npm
        uses: actions/cache@v4
        with:
          path: frontend/node_modules
          key: npm-${{ runner.os }}-${{ hashFiles('frontend/package-lock.json') }}

      - name: Install backend deps
        working-directory: backend
        run: uv pip install -r requirements.txt --system

      - name: Run tests
        working-directory: backend
        run: python -m pytest tests/ -v

      - name: Compile backend (Nuitka)
        working-directory: backend
        shell: bash
        run: |
          python -m nuitka \
            --assume-yes-for-downloads \
            --onefile \
            --output-dir=dist \
            --output-filename=backend \
            --follow-import-to=aligner,segmentation,undo \
            --nofollow-import-to=pytest,setuptools,pip \
            --include-module=cv2 \
            --include-module=numpy \
            --include-module=scipy \
            --include-module=skimage \
            --include-module=fastapi \
            --include-module=uvicorn \
            --include-module=pydantic \
            --include-module=starlette \
            --include-module=anyio \
            --include-module=multipart \
            --include-module=h11 \
            --include-module=PIL \
            --include-module=websockets \
            main.py

      - name: Copy backend as Tauri sidecar (Linux)
        if: runner.os == 'Linux'
        run: |
          mkdir -p frontend/src-tauri/binaries
          cp backend/dist/backend frontend/src-tauri/binaries/backend-x86_64-unknown-linux-gnu

      - name: Copy backend as Tauri sidecar (Windows)
        if: runner.os == 'Windows'
        run: |
          mkdir -p frontend/src-tauri/binaries
          cp backend/dist/backend.exe frontend/src-tauri/binaries/backend-x86_64-pc-windows-msvc.exe
        shell: bash

      - name: Install frontend deps
        working-directory: frontend
        run: npm install

      - name: Build Tauri
        uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          projectPath: frontend

      - name: Upload artifact
        uses: actions/upload-artifact@v4
        with:
          name: mineral-segmentation-${{ matrix.artifact }}
          path: |
            frontend/src-tauri/target/release/bundle/appimage/*.AppImage
            frontend/src-tauri/target/release/bundle/deb/*.deb
            frontend/src-tauri/target/release/bundle/nsis/*.exe
            frontend/src-tauri/target/release/bundle/msi/*.msi
          if-no-files-found: warn
```

- [ ] **Step 5: Update .gitignore**

Add to `.gitignore`:

```
# Tauri
frontend/src-tauri/target/
frontend/src-tauri/binaries/
frontend/dist/
```

- [ ] **Step 6: Commit**

```bash
git add build.sh build.bat justfile .github/workflows/build.yml .gitignore
git commit -m "build: update pipeline for Tauri (2-step build, tauri-action CI)"
```

---

### Task 6: Clean up old Electron files

**Files:**
- Delete: `frontend/main.js`
- Delete: `frontend/preload.js`
- Delete: `frontend/main-entry.js`
- Delete: `frontend/esbuild.config.mjs`
- Delete: `frontend/src/shims/`
- Delete: `frontend/src/app.js`
- Delete: `frontend/src/app-bundle.obf.js` (if exists)
- Delete: `frontend/public/` (both HTML files)
- Keep: `frontend/src/app-bundle.js` (reference for Phase 2-3, delete after)

- [ ] **Step 1: Remove Electron files**

```bash
cd frontend
git rm main.js preload.js main-entry.js esbuild.config.mjs
git rm -r src/shims/
git rm src/app.js
git rm --cached src/app-bundle.obf.js 2>/dev/null || true
rm -f src/app-bundle.obf.js main.jsc
git rm -r public/
```

- [ ] **Step 2: Verify Tauri still works**

```bash
cd frontend
npm run tauri dev
```

Expected: Tauri app launches, connects to backend, shows status.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: remove Electron files (main.js, preload.js, esbuild, shims, public/)"
```

---

## End of Phase 1

After completing all 6 tasks, you have:
- Tauri v2 app with system WebView
- Vite + React 19 + TypeScript fully configured
- Python backend running as Tauri sidecar with dynamic port
- Typed API client with 24 endpoints
- All TypeScript interfaces defined
- Build pipeline: Nuitka → Tauri (2 steps)
- CI/CD with GitHub Actions + tauri-action
- All old Electron code removed

**Next:** Phase 2 (hooks + core logic) and Phase 3 (UI components) in separate plans.
