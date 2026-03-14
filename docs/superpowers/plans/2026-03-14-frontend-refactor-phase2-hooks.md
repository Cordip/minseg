# Phase 2: Hooks + Core Logic Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port all business logic from the 1159-line `app-bundle.js` monolith into 6 typed custom hooks, a WelcomeScreen component, and an integrated App.tsx that wires everything together.

**Architecture:** Each hook encapsulates one domain (API init, canvas interaction, segmentation data, tree state, tagging, keyboard). Hooks communicate through callbacks passed by App.tsx. State flows down via props. Canvas image data stored as base64 strings in hook state; components draw them.

**Tech Stack:** React 19 hooks, TypeScript, Tauri dialog plugin, useReducer for tree state

**Spec:** `docs/superpowers/specs/2026-03-14-frontend-refactor-design.md`
**Source:** `frontend/src/app-bundle.js` (1159 lines — the working monolith being ported)

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `frontend/src/types.ts` | Modify | Add SegProgress, PatchStats, ContextMenuState, QuickInputState, TreeAction, TreeState, KeyboardHandlers |
| `frontend/src/utils.ts` | Create | Pure helpers: tagColor, pluralSeg, drawOnCanvas, drawSelectionStripes |
| `frontend/src/hooks/useApi.ts` | Create | Tauri IPC → API URL → typed Api instance |
| `frontend/src/hooks/useCanvas.ts` | Create | Zoom/pan/offset with refs, non-passive wheel |
| `frontend/src/hooks/useSegmentation.ts` | Create | Progress polling, patch loading, debounce, AbortController |
| `frontend/src/hooks/useTree.ts` | Create | useReducer tree state, fetchTree, canUndo/canRedo |
| `frontend/src/hooks/useTagging.ts` | Create | Tags cache, applyTag, undo/redo, quickInput state |
| `frontend/src/hooks/useKeyboard.ts` | Create | 200ms input buffering, immediate keys, ref pattern |
| `frontend/src/components/WelcomeScreen.tsx` | Create | File picker, auto-detect, align, start segmentation |
| `frontend/src/App.tsx` | Rewrite | Hook orchestration, WelcomeScreen → Editor routing |

---

## Chunk 1: Utility Functions + useApi + useCanvas

### Task 1: Add types and create utility functions

**Files:**
- Modify: `frontend/src/types.ts`
- Create: `frontend/src/utils.ts`

- [ ] **Step 1: Add new types to types.ts**

Add these types at the end of `frontend/src/types.ts`:

```typescript
// Segmentation progress
export interface SegProgress {
  done: number;
  total: number;
  untagged: number;
}

export interface PatchStats {
  total: number;
  tagged: number;
}

// UI state
export interface ContextMenuState {
  x: number;
  y: number;
  tagName: string;
  tagColor: string;
  level: 'tag' | 'patch' | 'segment';
  patchY?: number;
  patchX?: number;
  segmentId?: number;
}

export interface QuickInputState {
  patchY: number;
  patchX: number;
  segmentId: number;
}

// Tree reducer
export type TreeAction =
  | { type: 'TOGGLE_NODE'; key: string }
  | { type: 'SET_SELECTION'; selection: Set<string> }
  | { type: 'SHIFT_SELECT'; nodeKey: string; allKeys: string[] }
  | { type: 'CLICK'; nodeKey: string }
  | { type: 'CLEAR_SELECTION' }
  | { type: 'REFRESH_TREE'; data: TreeTag[] };

export interface TreeState {
  treeData: TreeTag[];
  expandedNodes: Set<string>;
  treeSelection: Set<string>;
  lastTreeClick: string | null;
}

// Keyboard handler interface
export interface KeyboardHandlers {
  onUndo: () => void;
  onRedo: () => void;
  onNavigate: (dx: number, dy: number) => void;
  onToggleBounds: () => void;
  onToggleSegments: () => void;
  onToggleXpl90: () => void;
  onTogglePpl: () => void;
  onToggleUntagged: () => void;
  onToggleHelp: () => void;
  onEscape: () => void;
  onEnter: () => void;
  onZoom: (factor: number) => void;
}
```

- [ ] **Step 2: Create utils.ts**

Create `frontend/src/utils.ts`:

```typescript
// Deterministic vibrant color from tag name (DJB2 hash + golden ratio hue)
export function tagColor(name: string): string {
  let hash = 5381;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) + hash) + name.charCodeAt(i);
  }
  const hue = Math.abs(hash * 137.5) % 360;
  const s = 0.85;
  const l = 0.55;
  const h = hue / 360;
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const r = hue2rgb(p, q, h + 1 / 3);
  const g = hue2rgb(p, q, h);
  const b = hue2rgb(p, q, h - 1 / 3);
  const toHex = (x: number) => {
    const hex = Math.round(x * 255).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// Russian plural form for "segment"
export function pluralSeg(n: number): string {
  const m = n % 100;
  const d = n % 10;
  if (d === 1 && m !== 11) return 'сегмент';
  if (d >= 2 && d <= 4 && (m < 12 || m > 14)) return 'сегмента';
  return 'сегментов';
}

// Draw base64 image onto a canvas element
export function drawOnCanvas(
  canvas: HTMLCanvasElement | null,
  base64Data: string | null | undefined,
): void {
  if (!canvas || !base64Data) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const img = new Image();
  img.onload = () => {
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
  };
  img.src = 'data:image/png;base64,' + base64Data;
}

// Draw green diagonal stripes selection mask
export function drawSelectionStripes(
  canvas: HTMLCanvasElement | null,
  maskBase64: string | null | undefined,
): void {
  if (!canvas || !maskBase64) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const maskImg = new Image();
  maskImg.onload = () => {
    canvas.width = maskImg.width;
    canvas.height = maskImg.height;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(maskImg, 0, 0);
    ctx.globalCompositeOperation = 'source-in';
    const patCanvas = document.createElement('canvas');
    patCanvas.width = 8;
    patCanvas.height = 8;
    const pc = patCanvas.getContext('2d')!;
    pc.strokeStyle = '#00ff00';
    pc.lineWidth = 2;
    pc.beginPath();
    pc.moveTo(0, 8); pc.lineTo(8, 0);
    pc.moveTo(-2, 2); pc.lineTo(2, -2);
    pc.moveTo(6, 10); pc.lineTo(10, 6);
    pc.stroke();
    const pattern = ctx.createPattern(patCanvas, 'repeat')!;
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = 'source-over';
  };
  maskImg.src = 'data:image/png;base64,' + maskBase64;
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/types.ts frontend/src/utils.ts
git commit -m "feat: add utility functions and extended types for hooks"
```

---

### Task 2: Create useApi hook

**Files:**
- Create: `frontend/src/hooks/useApi.ts`

- [ ] **Step 1: Create hooks directory and useApi**

```bash
mkdir -p frontend/src/hooks
```

Create `frontend/src/hooks/useApi.ts`:

```typescript
import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { createApi, type Api } from '../api';

export function useApi() {
  const [api, setApi] = useState<Api | null>(null);
  const [apiUrl, setApiUrl] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [status, setStatus] = useState('Starting backend...');

  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      try {
        let url: string;
        try {
          url = await invoke<string>('get_api_url');
        } catch {
          // Fallback for dev without Tauri (plain browser)
          url = 'http://127.0.0.1:8001';
        }
        if (cancelled) return;
        setApiUrl(url);
        const newApi = createApi(url);

        for (let i = 0; i < 30; i++) {
          if (cancelled) return;
          try {
            await newApi.getStatus();
            setApi(newApi);
            setIsReady(true);
            setStatus('Connected');
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
    return () => { cancelled = true; };
  }, []);

  return { api, apiUrl, isReady, status };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/useApi.ts
git commit -m "feat: add useApi hook with Tauri IPC and polling"
```

---

### Task 3: Create useCanvas hook

**Files:**
- Create: `frontend/src/hooks/useCanvas.ts`

- [ ] **Step 1: Create useCanvas**

Create `frontend/src/hooks/useCanvas.ts`:

```typescript
import { useState, useRef, useCallback } from 'react';

export function useCanvas() {
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const zoomRef = useRef(1);
  const offsetRef = useRef({ x: 0, y: 0 });
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const isPanningRef = useRef(false);
  const lastPosRef = useRef({ x: 0, y: 0 });

  // Non-passive wheel listener via callback ref
  const viewerCallbackRef = useCallback((node: HTMLDivElement | null) => {
    if (viewerRef.current) {
      const prev = viewerRef.current as HTMLDivElement & { _wheelHandler?: (e: WheelEvent) => void };
      if (prev._wheelHandler) {
        prev.removeEventListener('wheel', prev._wheelHandler);
      }
    }
    viewerRef.current = node;
    if (!node) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = node.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      const curZoom = zoomRef.current;
      const curOffset = offsetRef.current;
      const newZoom = Math.max(0.1, Math.min(10, curZoom * factor));
      const scale = newZoom / curZoom;
      const newOffset = {
        x: cx - scale * (cx - curOffset.x),
        y: cy - scale * (cy - curOffset.y),
      };
      zoomRef.current = newZoom;
      offsetRef.current = newOffset;
      setZoom(newZoom);
      setOffset(newOffset);
    };

    (node as HTMLDivElement & { _wheelHandler?: (e: WheelEvent) => void })._wheelHandler = handleWheel;
    node.addEventListener('wheel', handleWheel, { passive: false });
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 2) {
      e.preventDefault();
      isPanningRef.current = true;
      lastPosRef.current = { x: e.clientX, y: e.clientY };
    }
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanningRef.current) return;
    const dx = e.clientX - lastPosRef.current.x;
    const dy = e.clientY - lastPosRef.current.y;
    setOffset(prev => {
      const newOff = { x: prev.x + dx, y: prev.y + dy };
      offsetRef.current = newOff;
      return newOff;
    });
    lastPosRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handleMouseUp = useCallback(() => {
    isPanningRef.current = false;
  }, []);

  const resetView = useCallback(() => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    zoomRef.current = 1;
    offsetRef.current = { x: 0, y: 0 };
  }, []);

  // Zoom centered on viewer (for Ctrl+=/- keyboard shortcuts)
  const handleZoom = useCallback((factor: number) => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const rect = viewer.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const curZoom = zoomRef.current;
    const curOffset = offsetRef.current;
    const newZoom = Math.max(0.1, Math.min(10, curZoom * factor));
    const scale = newZoom / curZoom;
    const newOffset = {
      x: cx - scale * (cx - curOffset.x),
      y: cy - scale * (cy - curOffset.y),
    };
    zoomRef.current = newZoom;
    offsetRef.current = newOffset;
    setZoom(newZoom);
    setOffset(newOffset);
  }, []);

  return {
    zoom, offset, zoomRef, offsetRef,
    viewerCallbackRef, viewerRef,
    handleMouseDown, handleMouseMove, handleMouseUp,
    resetView, handleZoom,
  };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/useCanvas.ts
git commit -m "feat: add useCanvas hook with zoom-to-cursor and pan"
```

---

## Chunk 2: useSegmentation + useTree

### Task 4: Create useSegmentation hook

**Files:**
- Create: `frontend/src/hooks/useSegmentation.ts`

- [ ] **Step 1: Create useSegmentation**

Create `frontend/src/hooks/useSegmentation.ts`:

```typescript
import { useState, useEffect, useRef, useCallback } from 'react';
import type { Api } from '../api';
import type { PatchCoord, SegProgress, PatchStats, PatchState, MinimapData } from '../types';

export function useSegmentation(
  api: Api | null,
  currentPatch: PatchCoord,
  currentView: string,
  imagesAligned: boolean,
  gridSize: { rows: number; cols: number },
) {
  const [patchReady, setPatchReady] = useState(false);
  const [segProgress, setSegProgress] = useState<SegProgress>({ done: 0, total: 0, untagged: 0 });
  const [patchStates, setPatchStates] = useState<Record<string, PatchState>>({});
  const [patchStats, setPatchStats] = useState<PatchStats>({ total: 0, tagged: 0 });
  const [showUntagged, setShowUntagged] = useState(false);

  // Image data as base64 strings
  const [bgImage, setBgImage] = useState<string | null>(null);
  const [segImage, setSegImage] = useState<string | null>(null);
  const [boundsImage, setBoundsImage] = useState<string | null>(null);
  const [bordersImage, setBordersImage] = useState<string | null>(null);
  const [untaggedImage, setUntaggedImage] = useState<string | null>(null);
  const [minimapData, setMinimapData] = useState<MinimapData | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const isProcessingRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadingRef = useRef(false);

  // Load background image (lightweight, immediate)
  const loadBackgroundData = useCallback(() => {
    if (!api || !imagesAligned) return;
    api.getPatch(currentPatch.y, currentPatch.x, currentView)
      .then(d => setBgImage(d.image))
      .catch(() => {});
  }, [api, currentPatch, currentView, imagesAligned]);

  // Load segmentation data (heavy, debounced)
  const loadSegmentationData = useCallback(() => {
    if (!api || !imagesAligned) return;
    if (abortRef.current) abortRef.current.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setPatchReady(false);

    api.getSegmentation(currentPatch.y, currentPatch.x)
      .then(d => {
        if (ac.signal.aborted) return;
        if (d.status === 'ready') {
          setPatchStats({ total: d.total_segs ?? 0, tagged: d.tagged_segs ?? 0 });
          setSegImage(d.colored_segments ?? null);
          setBoundsImage(d.bounds ?? null);
          setBordersImage(d.borders ?? null);
          setPatchReady(true);
        } else {
          setSegImage(null);
          setBoundsImage(null);
          setBordersImage(null);
          api.requestPatchPriority(currentPatch.y, currentPatch.x).catch(() => {});
        }
      })
      .catch(() => {});

    api.getTags().catch(() => {});
  }, [api, currentPatch, imagesAligned]);

  // Poll segmentation progress (2s when processing, 5s when idle)
  useEffect(() => {
    if (!api || !imagesAligned) return;
    let timer: ReturnType<typeof setTimeout>;
    const fetchProgress = () => {
      api.getStatus().then(s => {
        setSegProgress({ done: s.segmented_patches, total: s.total_patches, untagged: s.untagged_segments });
        isProcessingRef.current = s.is_segmenting;
      }).catch(() => {});
      api.getProgress().then(p => {
        if (!p.is_running && (!p.processed || p.processed.length === 0)) return;
        const map: Record<string, PatchState> = {};
        (p.processed || []).forEach(([py, px]) => { map[`${py},${px}`] = 'processed'; });
        (p.current_active || []).forEach(([py, px]) => { map[`${py},${px}`] = 'active'; });
        (p.pending || []).forEach(([py, px]) => { map[`${py},${px}`] = 'pending'; });
        setPatchStates(map);
      }).catch(() => {});
    };
    const tick = () => {
      fetchProgress();
      timer = setTimeout(tick, isProcessingRef.current ? 2000 : 5000);
    };
    tick();
    return () => clearTimeout(timer);
  }, [api, imagesAligned]);

  // Debounced segmentation load (300ms after patch changes)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (!loadingRef.current) {
        loadingRef.current = true;
        loadSegmentationData();
        setTimeout(() => { loadingRef.current = false; }, 500);
      }
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [loadSegmentationData]);

  // Immediate background + minimap load
  useEffect(() => {
    loadBackgroundData();
    if (api && imagesAligned) {
      api.getMinimap(currentView).then(setMinimapData).catch(() => {});
    }
  }, [loadBackgroundData, currentView, api, imagesAligned]);

  // Poll for patch ready (2s) when not ready
  useEffect(() => {
    if (patchReady || !api) return;
    const itv = setInterval(() => {
      if (loadingRef.current) return;
      api.getSegmentation(currentPatch.y, currentPatch.x).then(d => {
        if (d.status === 'ready') {
          setPatchStats({ total: d.total_segs ?? 0, tagged: d.tagged_segs ?? 0 });
          setSegImage(d.colored_segments ?? null);
          setBoundsImage(d.bounds ?? null);
          setBordersImage(d.borders ?? null);
          setPatchReady(true);
        }
      }).catch(() => {});
    }, 2000);
    return () => clearInterval(itv);
  }, [api, currentPatch, patchReady]);

  const toggleUntagged = useCallback(() => {
    setShowUntagged(prev => {
      const next = !prev;
      if (next && api) {
        api.getUntaggedMask(currentPatch.y, currentPatch.x)
          .then(d => setUntaggedImage(d.image))
          .catch(() => {});
      }
      return next;
    });
  }, [api, currentPatch]);

  const startSegmentation = useCallback(() => {
    if (!api) return;
    api.startSegmentation().catch(() => {});
  }, [api]);

  const reloadPatch = useCallback(() => {
    loadSegmentationData();
    if (api) {
      api.getTags().catch(() => {});
    }
  }, [loadSegmentationData, api]);

  return {
    patchReady, segProgress, patchStates, patchStats,
    showUntagged, bgImage, segImage, boundsImage, bordersImage,
    untaggedImage, minimapData,
    toggleUntagged, startSegmentation, reloadPatch, setPatchReady,
  };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/useSegmentation.ts
git commit -m "feat: add useSegmentation hook with polling and AbortController"
```

---

### Task 5: Create useTree hook

**Files:**
- Create: `frontend/src/hooks/useTree.ts`

- [ ] **Step 1: Create useTree**

Create `frontend/src/hooks/useTree.ts`:

```typescript
import { useReducer, useCallback, useState } from 'react';
import type { Api } from '../api';
import type { TreeAction, TreeState, TreeTag } from '../types';

const initialState: TreeState = {
  treeData: [],
  expandedNodes: new Set<string>(),
  treeSelection: new Set<string>(),
  lastTreeClick: null,
};

function treeReducer(state: TreeState, action: TreeAction): TreeState {
  switch (action.type) {
    case 'TOGGLE_NODE': {
      const next = new Set(state.expandedNodes);
      if (next.has(action.key)) next.delete(action.key);
      else next.add(action.key);
      return { ...state, expandedNodes: next };
    }
    case 'SET_SELECTION':
      return { ...state, treeSelection: action.selection };
    case 'CLICK':
      return { ...state, treeSelection: new Set<string>(), lastTreeClick: action.nodeKey };
    case 'SHIFT_SELECT': {
      const a = action.allKeys.indexOf(state.lastTreeClick ?? '');
      const b = action.allKeys.indexOf(action.nodeKey);
      if (a >= 0 && b >= 0) {
        const start = Math.min(a, b);
        const end = Math.max(a, b);
        return { ...state, treeSelection: new Set(action.allKeys.slice(start, end + 1)) };
      }
      return state;
    }
    case 'CLEAR_SELECTION':
      return { ...state, treeSelection: new Set<string>(), lastTreeClick: null };
    case 'REFRESH_TREE':
      return { ...state, treeData: action.data };
    default:
      return state;
  }
}

export function useTree(api: Api | null) {
  const [state, dispatch] = useReducer(treeReducer, initialState);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const fetchTree = useCallback(() => {
    if (!api) return;
    api.getTagTree().then(d => dispatch({ type: 'REFRESH_TREE', data: d.tags })).catch(() => {});
    api.getUndoStatus().then(d => {
      setCanUndo(d.can_undo);
      setCanRedo(d.can_redo);
    }).catch(() => {});
  }, [api]);

  const flattenTreeKeys = useCallback(() => {
    const keys: string[] = [];
    state.treeData.forEach(tag => {
      keys.push('tag:' + tag.name);
      if (state.expandedNodes.has('tag:' + tag.name)) {
        tag.patches.forEach(p => {
          keys.push(`patch:${tag.name}:${p.patch_y},${p.patch_x}`);
          if (state.expandedNodes.has(`patch:${tag.name}:${p.patch_y},${p.patch_x}`)) {
            p.segments.forEach(sid => {
              keys.push(`seg:${p.patch_y},${p.patch_x}:${sid}`);
            });
          }
        });
      }
    });
    return keys;
  }, [state.treeData, state.expandedNodes]);

  const resolveTreeSelection = useCallback((selection: Set<string>) => {
    const resolved = new Set<string>();
    selection.forEach(key => {
      if (key.startsWith('tag:')) {
        const tagName = key.slice(4);
        const tag = state.treeData.find(t => t.name === tagName);
        if (tag) tag.patches.forEach(p => {
          p.segments.forEach(sid => resolved.add(`seg:${p.patch_y},${p.patch_x}:${sid}`));
        });
      } else if (key.startsWith('patch:')) {
        const parts = key.split(':');
        const tName = parts[1]!;
        const coords = parts[2]!.split(',').map(Number);
        const tag = state.treeData.find(t => t.name === tName);
        if (tag) {
          const patch = tag.patches.find(p => p.patch_y === coords[0] && p.patch_x === coords[1]);
          if (patch) patch.segments.forEach(sid => resolved.add(`seg:${coords[0]},${coords[1]}:${sid}`));
        }
      } else {
        resolved.add(key);
      }
    });
    return resolved;
  }, [state.treeData]);

  const handleTreeClick = useCallback((e: React.MouseEvent, nodeKey: string) => {
    if (e.ctrlKey) {
      const next = new Set(state.treeSelection);
      if (next.has(nodeKey)) next.delete(nodeKey);
      else next.add(nodeKey);
      dispatch({ type: 'SET_SELECTION', selection: next });
      // Update lastTreeClick for shift-select anchor
      dispatch({ type: 'CLICK', nodeKey });
      // Re-set selection since CLICK clears it
      dispatch({ type: 'SET_SELECTION', selection: next });
    } else if (e.shiftKey && state.lastTreeClick) {
      dispatch({ type: 'SHIFT_SELECT', nodeKey, allKeys: flattenTreeKeys() });
    } else {
      dispatch({ type: 'CLICK', nodeKey });
    }
  }, [state.treeSelection, state.lastTreeClick, flattenTreeKeys]);

  return {
    treeData: state.treeData,
    expandedNodes: state.expandedNodes,
    treeSelection: state.treeSelection,
    lastTreeClick: state.lastTreeClick,
    canUndo, canRedo,
    dispatch, fetchTree, flattenTreeKeys, resolveTreeSelection, handleTreeClick,
  };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/useTree.ts
git commit -m "feat: add useTree hook with useReducer and tree selection"
```

---

## Chunk 3: useTagging + useKeyboard + WelcomeScreen + App.tsx

### Task 6: Create useTagging hook

**Files:**
- Create: `frontend/src/hooks/useTagging.ts`

- [ ] **Step 1: Create useTagging**

Create `frontend/src/hooks/useTagging.ts`:

```typescript
import { useState, useCallback } from 'react';
import type { Api } from '../api';
import type { QuickInputState, SelectedSegment } from '../types';
import { tagColor } from '../utils';

export function useTagging(
  api: Api | null,
  selectedSegments: SelectedSegment[],
  setSelectedSegments: (segs: SelectedSegment[]) => void,
  onRefreshTree: () => void,
  onReloadPatch: () => void,
) {
  const [tags, setTags] = useState<Record<string, string>>({});
  const [quickInput, setQuickInput] = useState<QuickInputState | null>(null);
  const [quickFilter, setQuickFilter] = useState('');
  const [quickHighlight, setQuickHighlight] = useState(0);

  const refreshTags = useCallback(() => {
    if (!api) return;
    api.getTags().then(d => setTags(d.tag_colors)).catch(() => {});
  }, [api]);

  const applyTag = useCallback((tagName: string) => {
    if (!tagName.trim() || !api) return;
    const color = tags[tagName] ?? tagColor(tagName);

    if (selectedSegments.length > 0) {
      api.batchLabel({
        tag_name: tagName,
        color,
        segments: selectedSegments.map(s => ({
          patch_y: s.patchY, patch_x: s.patchX, segment_id: s.id,
        })),
      }).then(() => {
        setSelectedSegments([]);
        setQuickInput(null);
        setQuickFilter('');
        onRefreshTree();
        onReloadPatch();
        refreshTags();
      }).catch(() => {});
    } else if (quickInput) {
      api.labelSegment({
        patch_y: quickInput.patchY, patch_x: quickInput.patchX,
        segment_id: quickInput.segmentId, tag: tagName, color,
      }).then(() => {
        setQuickInput(null);
        setQuickFilter('');
        onRefreshTree();
        onReloadPatch();
        refreshTags();
      }).catch(() => {});
    }
  }, [api, quickInput, selectedSegments, tags, onRefreshTree, onReloadPatch, refreshTags, setSelectedSegments]);

  const handleUndo = useCallback(() => {
    if (!api) return;
    api.undo().then(() => {
      onRefreshTree();
      onReloadPatch();
      refreshTags();
    }).catch(() => {});
  }, [api, onRefreshTree, onReloadPatch, refreshTags]);

  const handleRedo = useCallback(() => {
    if (!api) return;
    api.redo().then(() => {
      onRefreshTree();
      onReloadPatch();
      refreshTags();
    }).catch(() => {});
  }, [api, onRefreshTree, onReloadPatch, refreshTags]);

  return {
    tags, quickInput, quickFilter, quickHighlight,
    setQuickInput, setQuickFilter, setQuickHighlight,
    applyTag, handleUndo, handleRedo, refreshTags,
  };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/useTagging.ts
git commit -m "feat: add useTagging hook with batch label and undo/redo"
```

---

### Task 7: Create useKeyboard hook

**Files:**
- Create: `frontend/src/hooks/useKeyboard.ts`

- [ ] **Step 1: Create useKeyboard**

Create `frontend/src/hooks/useKeyboard.ts`:

```typescript
import { useEffect, useRef } from 'react';
import type { KeyboardHandlers } from '../types';

export function useKeyboard(
  handlers: KeyboardHandlers,
  enabled: boolean,
  quickInputOpen: boolean,
) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!enabled) return;

    const keyBuffer = { s: 0, b: 0, x: 0, p: 0, u: 0, dx: 0, dy: 0 };

    const handleKeyDown = (e: KeyboardEvent) => {
      const h = handlersRef.current;

      // Ctrl+= / Ctrl+- zoom (immediate)
      if (e.ctrlKey && (e.key === '=' || e.key === '+' || e.key === '-')) {
        e.preventDefault();
        h.onZoom(e.key === '-' ? 0.8 : 1.2);
        return;
      }

      // Escape (immediate) — always works
      if (e.key === 'Escape') {
        h.onEscape();
        return;
      }

      // H toggles help (immediate)
      if (e.key.toLowerCase() === 'h' && !e.ctrlKey && !quickInputOpen) {
        h.onToggleHelp();
        return;
      }

      // Ctrl+Z undo (immediate)
      if (e.ctrlKey && e.key === 'z') {
        e.preventDefault();
        h.onUndo();
        return;
      }

      // Ctrl+Y redo (immediate)
      if (e.ctrlKey && e.key === 'y') {
        e.preventDefault();
        h.onRedo();
        return;
      }

      // Enter (immediate)
      if (e.key === 'Enter') {
        e.preventDefault();
        h.onEnter();
        return;
      }

      // Block buffered hotkeys when quickInput is open
      if (quickInputOpen) return;

      // Buffer toggle and navigation keys
      const k = e.key.toLowerCase();
      if (k === 's') keyBuffer.s++;
      else if (k === 'b') keyBuffer.b++;
      else if (k === 'x') keyBuffer.x++;
      else if (k === 'p') keyBuffer.p++;
      else if (k === 'u') keyBuffer.u++;
      else if (k === 'arrowright') keyBuffer.dx++;
      else if (k === 'arrowleft') keyBuffer.dx--;
      else if (k === 'arrowup') keyBuffer.dy--;
      else if (k === 'arrowdown') keyBuffer.dy++;
    };

    window.addEventListener('keydown', handleKeyDown);

    // 200ms tick evaluates buffered keys
    const ticker = setInterval(() => {
      const b = keyBuffer;
      if (b.s === 0 && b.b === 0 && b.x === 0 && b.p === 0 && b.u === 0 && b.dx === 0 && b.dy === 0) return;
      const h = handlersRef.current;

      if (b.s % 2 !== 0) h.onToggleBounds();
      if (b.b % 2 !== 0) h.onToggleSegments();
      if (b.x % 2 !== 0) h.onToggleXpl90();
      if (b.p % 2 !== 0) h.onTogglePpl();
      if (b.u % 2 !== 0) h.onToggleUntagged();
      if (b.dx !== 0 || b.dy !== 0) h.onNavigate(b.dx, b.dy);

      // Reset buffer
      keyBuffer.s = keyBuffer.b = keyBuffer.x = keyBuffer.p = keyBuffer.u = keyBuffer.dx = keyBuffer.dy = 0;
    }, 200);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      clearInterval(ticker);
    };
  }, [enabled, quickInputOpen]);
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/useKeyboard.ts
git commit -m "feat: add useKeyboard hook with 200ms input buffering"
```

---

### Task 8: Create WelcomeScreen component

**Files:**
- Create: `frontend/src/components/WelcomeScreen.tsx`

- [ ] **Step 1: Create components directory and WelcomeScreen**

```bash
mkdir -p frontend/src/components
```

Create `frontend/src/components/WelcomeScreen.tsx`:

```tsx
import { useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import type { Api } from '../api';

interface Props {
  api: Api;
  onReady: (gridSize: { rows: number; cols: number }) => void;
}

interface FileSlot {
  path: string | null;
  name: string;
}

const IMAGE_TYPES = ['ppl45', 'ppl90', 'xpl45', 'xpl90'] as const;
const LABELS: Record<string, string> = {
  ppl45: 'PPL 45°',
  ppl90: 'PPL 90°',
  xpl45: 'XPL 45°',
  xpl90: 'XPL 90°',
};
const DESCS: Record<string, string> = {
  ppl45: 'Параллельный николь, 45°',
  ppl90: 'Параллельный николь, 90°',
  xpl45: 'Скрещенный николь, 45°',
  xpl90: 'Скрещенный николь, 90°',
};

export default function WelcomeScreen({ api, onReady }: Props) {
  const [files, setFiles] = useState<Record<string, FileSlot>>({
    ppl45: { path: null, name: '' },
    ppl90: { path: null, name: '' },
    xpl45: { path: null, name: '' },
    xpl90: { path: null, name: '' },
  });
  const [status, setStatus] = useState('');
  const [statusType, setStatusType] = useState<'' | 'error' | 'success'>('');
  const [progress, setProgress] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);

  const allSelected = IMAGE_TYPES.every(t => files[t].path !== null);

  const selectFile = async (type: string) => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'tif', 'tiff', 'bmp'] }],
      });
      if (typeof selected === 'string') {
        const name = selected.split(/[/\\]/).pop() ?? selected;
        setFiles(prev => ({ ...prev, [type]: { path: selected, name } }));
        setStatus('');
        setStatusType('');
      }
    } catch (e) {
      setStatus(`Ошибка: ${e}`);
      setStatusType('error');
    }
  };

  const clearAll = () => {
    setFiles({
      ppl45: { path: null, name: '' },
      ppl90: { path: null, name: '' },
      xpl45: { path: null, name: '' },
      xpl90: { path: null, name: '' },
    });
    setStatus('');
    setStatusType('');
  };

  const startProcessing = async () => {
    if (!allSelected) return;
    setIsProcessing(true);
    try {
      setProgress(10);
      setStatus('Загрузка изображений...');

      await api.loadPaths({
        ppl45: files.ppl45.path!,
        ppl90: files.ppl90.path!,
        xpl45: files.xpl45.path!,
        xpl90: files.xpl90.path!,
      });
      setProgress(30);
      setStatus('Выравнивание изображений...');

      const alignData = await api.alignImages();
      setProgress(50);
      setStatus('Запуск сегментации...');

      api.startSegmentation().catch(() => {});
      setProgress(100);
      setStatus('Готово!');
      setStatusType('success');

      onReady(alignData.grid_size);
    } catch (e) {
      setStatus(`Ошибка: ${e}`);
      setStatusType('error');
      setIsProcessing(false);
    }
  };

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', padding: 40, background: '#1a1a2e',
    }}>
      <h1 style={{ fontSize: 32, color: '#e94560', marginBottom: 10, textAlign: 'center' }}>
        Mineral Segmentation
      </h1>
      <p style={{ color: '#888', textAlign: 'center', marginBottom: 40, fontSize: 14 }}>
        Сегментация минеральных зерен по изображениям поляризованной микроскопии
      </p>

      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 20,
        marginBottom: 30, maxWidth: 700, width: '100%',
      }}>
        {IMAGE_TYPES.map(type => (
          <div key={type} style={{
            background: '#16213e', borderRadius: 12, padding: 20,
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            border: `2px solid ${files[type].path ? '#4ecca3' : 'transparent'}`,
          }}>
            <h3 style={{ color: '#fff', marginBottom: 8, fontSize: 16 }}>{LABELS[type]}</h3>
            <p style={{ color: '#666', fontSize: 12, marginBottom: 15, textAlign: 'center' }}>{DESCS[type]}</p>
            <p style={{
              color: '#4ecca3', fontSize: 11, marginBottom: 10, maxWidth: '100%',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              textAlign: 'center', minHeight: 16,
            }}>
              {files[type].name}
            </p>
            <button
              onClick={() => selectFile(type)}
              disabled={isProcessing}
              style={{
                background: files[type].path ? '#4ecca3' : '#0f3460',
                color: files[type].path ? '#16213e' : '#eaeaea',
                border: '1px solid #4ecca3', padding: '10px 20px',
                fontSize: 14, borderRadius: 6, cursor: isProcessing ? 'not-allowed' : 'pointer',
                width: '100%',
              }}
            >
              {files[type].path ? 'Изменить' : 'Выбрать файл'}
            </button>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 15, justifyContent: 'center', marginTop: 20 }}>
        <button
          onClick={clearAll}
          disabled={isProcessing}
          style={{
            background: 'transparent', color: '#888', border: '1px solid #555',
            padding: '16px 30px', fontSize: 14, borderRadius: 8, cursor: 'pointer',
          }}
        >
          Очистить все
        </button>
        <button
          onClick={startProcessing}
          disabled={!allSelected || isProcessing}
          style={{
            background: allSelected && !isProcessing ? '#e94560' : '#555',
            color: 'white', border: 'none', padding: '16px 40px',
            fontSize: 16, borderRadius: 8,
            cursor: allSelected && !isProcessing ? 'pointer' : 'not-allowed',
          }}
        >
          Начать обработку
        </button>
      </div>

      {status && (
        <p style={{
          marginTop: 20, fontSize: 14, textAlign: 'center',
          color: statusType === 'error' ? '#e94560' : statusType === 'success' ? '#4ecca3' : '#888',
        }}>
          {status}
        </p>
      )}

      {isProcessing && (
        <div style={{ marginTop: 20, width: '100%', maxWidth: 700 }}>
          <div style={{ width: '100%', height: 8, background: '#16213e', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{
              height: '100%', width: `${progress}%`,
              background: 'linear-gradient(90deg, #e94560, #4ecca3)',
              transition: 'width 0.3s',
            }} />
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/WelcomeScreen.tsx
git commit -m "feat: add WelcomeScreen with Tauri file picker and alignment flow"
```

---

### Task 9: Rewrite App.tsx to integrate all hooks

**Files:**
- Rewrite: `frontend/src/App.tsx`

- [ ] **Step 1: Rewrite App.tsx**

Replace `frontend/src/App.tsx` with:

```tsx
import { useState, useEffect, useCallback, useRef } from 'react';
import type { PatchCoord, SelectedSegment, ContextMenuState } from './types';
import { useApi } from './hooks/useApi';
import { useCanvas } from './hooks/useCanvas';
import { useSegmentation } from './hooks/useSegmentation';
import { useTree } from './hooks/useTree';
import { useTagging } from './hooks/useTagging';
import { useKeyboard } from './hooks/useKeyboard';
import { drawOnCanvas, drawSelectionStripes } from './utils';
import WelcomeScreen from './components/WelcomeScreen';

export default function App() {
  // API
  const { api, isReady, status: apiStatus } = useApi();

  // App-level state
  const [imagesAligned, setImagesAligned] = useState(false);
  const [gridSize, setGridSize] = useState({ rows: 0, cols: 0 });
  const [currentPatch, setCurrentPatch] = useState<PatchCoord>({ y: 0, x: 0 });
  const [isXpl, setIsXpl] = useState(true);
  const [isXpl90, setIsXpl90] = useState(false);
  const [showSegments, setShowSegments] = useState(true);
  const [showBounds, setShowBounds] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [selectedSegments, setSelectedSegments] = useState<SelectedSegment[]>([]);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(400);

  const currentView = (isXpl ? 'xpl' : 'ppl') + (isXpl90 ? '90' : '45');

  // Canvas refs for image layers
  const canvasBgRef = useRef<HTMLCanvasElement>(null);
  const canvasBoundRef = useRef<HTMLCanvasElement>(null);
  const canvasSegRef = useRef<HTMLCanvasElement>(null);
  const canvasBorderRef = useRef<HTMLCanvasElement>(null);
  const canvasUntaggedRef = useRef<HTMLCanvasElement>(null);
  const canvasSelectionRef = useRef<HTMLCanvasElement>(null);
  const quickInputRef = useRef<HTMLInputElement>(null);

  // Hooks
  const canvas = useCanvas();
  const seg = useSegmentation(api, currentPatch, currentView, imagesAligned, gridSize);
  const tree = useTree(api);
  const tagging = useTagging(api, selectedSegments, setSelectedSegments, tree.fetchTree, seg.reloadPatch);

  // Draw images on canvases when data changes
  useEffect(() => { drawOnCanvas(canvasBgRef.current, seg.bgImage); }, [seg.bgImage]);
  useEffect(() => { drawOnCanvas(canvasSegRef.current, seg.segImage); }, [seg.segImage]);
  useEffect(() => { drawOnCanvas(canvasBoundRef.current, seg.boundsImage); }, [seg.boundsImage]);
  useEffect(() => { drawOnCanvas(canvasBorderRef.current, seg.bordersImage); }, [seg.bordersImage]);
  useEffect(() => { drawOnCanvas(canvasUntaggedRef.current, seg.untaggedImage); }, [seg.untaggedImage]);

  // Selection mask
  useEffect(() => {
    if (selectedSegments.length === 0) {
      const c = canvasSelectionRef.current;
      if (c) c.getContext('2d')?.clearRect(0, 0, c.width, c.height);
      return;
    }
    if (!api) return;
    const ids = selectedSegments
      .filter(s => s.patchY === currentPatch.y && s.patchX === currentPatch.x)
      .map(s => s.id);
    if (ids.length === 0) return;
    api.getSelectionMask(currentPatch.y, currentPatch.x, ids)
      .then(d => drawSelectionStripes(canvasSelectionRef.current, d.image))
      .catch(() => {});
  }, [selectedSegments, currentPatch, api]);

  // Check if already aligned on startup
  useEffect(() => {
    if (!api) return;
    api.getStatus().then(s => {
      if (s.images_aligned) {
        setGridSize(s.grid_size);
        setImagesAligned(true);
        seg.startSegmentation();
      }
    }).catch(() => {});
  }, [api]);

  // Fetch tree when editor becomes active
  useEffect(() => {
    if (api && imagesAligned) tree.fetchTree();
  }, [api, imagesAligned]);

  // Reset view on patch change
  useEffect(() => {
    canvas.resetView();
  }, [currentPatch]);

  // WelcomeScreen callback
  const handleWelcomeReady = useCallback((grid: { rows: number; cols: number }) => {
    setGridSize(grid);
    setImagesAligned(true);
  }, []);

  // Keyboard handlers
  const keyboardHandlers = {
    onUndo: tagging.handleUndo,
    onRedo: tagging.handleRedo,
    onNavigate: (dx: number, dy: number) => {
      setCurrentPatch(p => ({
        x: Math.max(0, Math.min(gridSize.cols - 1, p.x + dx)),
        y: Math.max(0, Math.min(gridSize.rows - 1, p.y + dy)),
      }));
    },
    onToggleBounds: () => setShowBounds(v => !v),
    onToggleSegments: () => setShowSegments(v => !v),
    onToggleXpl90: () => setIsXpl90(v => !v),
    onTogglePpl: () => setIsXpl(v => !v),
    onToggleUntagged: seg.toggleUntagged,
    onToggleHelp: () => setShowHelp(v => !v),
    onEscape: () => {
      if (contextMenu) { setContextMenu(null); return; }
      if (showHelp) { setShowHelp(false); return; }
      tagging.setQuickInput(null);
      tagging.setQuickFilter('');
      setSelectedSegments([]);
      tree.dispatch({ type: 'CLEAR_SELECTION' });
    },
    onEnter: () => {
      if (selectedSegments.length > 0 && !quickInputRef.current?.matches(':focus')) {
        setTimeout(() => quickInputRef.current?.focus(), 50);
      }
    },
    onZoom: canvas.handleZoom,
  };

  useKeyboard(keyboardHandlers, imagesAligned, tagging.quickInput !== null);

  // Image click handler
  const handleImageClick = useCallback((e: React.MouseEvent) => {
    if (!seg.patchReady || !api) return;
    const viewer = canvas.viewerRef.current;
    if (!viewer) return;
    const panelRect = viewer.getBoundingClientRect();
    const screenX = e.clientX - panelRect.left;
    const screenY = e.clientY - panelRect.top;
    const x = Math.floor((screenX - canvas.offsetRef.current.x) / canvas.zoomRef.current);
    const y = Math.floor((screenY - canvas.offsetRef.current.y) / canvas.zoomRef.current);
    if (x < 0 || y < 0 || x >= 1024 || y >= 1024) return;
    api.getSegmentAtPoint(currentPatch.y, currentPatch.x, x, y).then(r => {
      if (r.status === 'success' && r.segment_id > 0) {
        if (e.ctrlKey) {
          setSelectedSegments(prev => {
            const exists = prev.find(s => s.id === r.segment_id);
            if (exists) return prev.filter(s => s.id !== r.segment_id);
            return [...prev, { id: r.segment_id, patchY: currentPatch.y, patchX: currentPatch.x }];
          });
          return;
        }
        setSelectedSegments([]);
        tagging.setQuickInput({ patchY: currentPatch.y, patchX: currentPatch.x, segmentId: r.segment_id });
        tagging.setQuickFilter(r.tag ?? '');
        setTimeout(() => quickInputRef.current?.focus(), 50);
      }
    }).catch(() => {});
  }, [api, seg.patchReady, currentPatch, canvas, tagging]);

  // ─── Render ──────────────────────────────────────────────

  if (!isReady) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100vh', background: '#1a1a2e', color: '#eaeaea', fontFamily: 'system-ui',
      }}>
        <div style={{ textAlign: 'center' }}>
          <h1>Mineral Segmentation v2</h1>
          <p>{apiStatus}</p>
        </div>
      </div>
    );
  }

  if (!imagesAligned && api) {
    return <WelcomeScreen api={api} onReady={handleWelcomeReady} />;
  }

  // Editor view (minimal layout — components added in Phase 3)
  return (
    <div className="app-container" onContextMenu={e => e.preventDefault()}>
      {/* Toolbar placeholder */}
      <div className="toolbar">
        <div className="toolbar-group">
          <button className="btn btn-secondary" onClick={() => setIsXpl(v => !v)}>
            {isXpl ? 'XPL' : 'PPL'}
          </button>
          <button className="btn btn-secondary" onClick={() => setIsXpl90(v => !v)}>
            {isXpl90 ? '90°' : '45°'}
          </button>
        </div>
        <div className="toolbar-divider" />
        <div className="toolbar-group">
          <button className={`btn btn-secondary ${showBounds ? 'active' : ''}`}
            onClick={() => setShowBounds(v => !v)}>Границы (S)</button>
          <button className={`btn btn-secondary ${showSegments ? 'active' : ''}`}
            onClick={() => setShowSegments(v => !v)}>Сегменты (B)</button>
          <button className="btn" style={{
            backgroundColor: seg.showUntagged ? '#ff4757' : '#6c757d',
            color: '#fff', border: 'none',
          }} onClick={seg.toggleUntagged}>Неразмеченные</button>
        </div>
        <div className="toolbar-divider" />
        <div className="toolbar-group">
          <button className="btn btn-secondary"
            onClick={() => setCurrentPatch(p => ({ ...p, x: Math.max(0, p.x - 1) }))}
            disabled={currentPatch.x === 0}>◀</button>
          <span className="patch-counter">{currentPatch.x + 1}/{gridSize.cols}</span>
          <button className="btn btn-secondary"
            onClick={() => setCurrentPatch(p => ({ ...p, x: Math.min(gridSize.cols - 1, p.x + 1) }))}
            disabled={currentPatch.x >= gridSize.cols - 1}>▶</button>
          <span style={{ margin: '0 5px', color: '#555' }}>|</span>
          <button className="btn btn-secondary"
            onClick={() => setCurrentPatch(p => ({ ...p, y: Math.max(0, p.y - 1) }))}
            disabled={currentPatch.y === 0}>▲</button>
          <span className="patch-counter">{currentPatch.y + 1}/{gridSize.rows}</span>
          <button className="btn btn-secondary"
            onClick={() => setCurrentPatch(p => ({ ...p, y: Math.min(gridSize.rows - 1, p.y + 1) }))}
            disabled={currentPatch.y >= gridSize.rows - 1}>▼</button>
        </div>
        <div className="toolbar-divider" />
        <button className="btn btn-secondary" onClick={tagging.handleUndo}
          disabled={!tree.canUndo} style={{ opacity: tree.canUndo ? 1 : 0.3 }}>↩</button>
        <button className="btn btn-secondary" onClick={tagging.handleRedo}
          disabled={!tree.canRedo} style={{ opacity: tree.canRedo ? 1 : 0.3 }}>↪</button>
        <button className="btn btn-secondary" style={{ marginLeft: 'auto' }}
          onClick={() => setShowHelp(v => !v)}>?</button>
      </div>

      {/* Main content */}
      <div className="main-content">
        {/* Minimap placeholder */}
        <div className="minimap-panel">
          <div className="minimap-header">Миникарта</div>
          <div style={{ padding: 10, color: '#888', fontSize: 12 }}>
            {seg.segProgress.total > 0 &&
              `${seg.segProgress.done}/${seg.segProgress.total} (${Math.round(seg.segProgress.done / seg.segProgress.total * 100)}%)`
            }
          </div>
        </div>

        {/* Viewer */}
        <div className="viewer-panel" ref={canvas.viewerCallbackRef}
          onMouseDown={canvas.handleMouseDown} onMouseMove={canvas.handleMouseMove}
          onMouseUp={canvas.handleMouseUp} onMouseLeave={canvas.handleMouseUp}
          onContextMenu={e => e.preventDefault()}>
          <div className="viewer-canvas" style={{
            transform: `translate(${canvas.offset.x}px, ${canvas.offset.y}px) scale(${canvas.zoom})`,
            transformOrigin: '0 0', position: 'relative', width: 1024, height: 1024,
          }} onClick={handleImageClick}>
            <canvas ref={canvasBgRef} style={{ position: 'absolute', top: 0, left: 0, zIndex: 1 }} />
            <canvas ref={canvasBoundRef} style={{
              position: 'absolute', top: 0, left: 0, opacity: showBounds ? 0.8 : 0,
              mixBlendMode: 'multiply', zIndex: 2, pointerEvents: 'none',
            }} />
            <canvas ref={canvasSegRef} style={{
              position: 'absolute', top: 0, left: 0, opacity: showSegments ? 1 : 0,
              zIndex: 3, pointerEvents: 'none',
            }} />
            <canvas ref={canvasBorderRef} style={{
              position: 'absolute', top: 0, left: 0, opacity: showSegments ? 0.6 : 0,
              mixBlendMode: 'multiply', zIndex: 4, pointerEvents: 'none',
            }} />
            <canvas ref={canvasUntaggedRef} style={{
              position: 'absolute', top: 0, left: 0, opacity: seg.showUntagged ? 0.6 : 0,
              zIndex: 5, pointerEvents: 'none',
            }} />
            <canvas ref={canvasSelectionRef} style={{
              position: 'absolute', top: 0, left: 0, opacity: selectedSegments.length > 0 ? 0.5 : 0,
              zIndex: 6, pointerEvents: 'none',
            }} />
            {!seg.patchReady && (
              <div style={{
                position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center',
                justifyContent: 'center', color: '#fff', zIndex: 7,
              }}>Обработка...</div>
            )}
          </div>
        </div>

        {/* Tags panel placeholder */}
        <div className="tags-panel" style={{ width: sidebarWidth }}>
          <div className="tags-header">
            <span>Теги минералов ({tree.treeData.length})</span>
          </div>
          <div className="tags-list" style={{ color: '#888', padding: 16, fontSize: 13 }}>
            {tree.treeData.length === 0 && 'Нет тегов. Нажмите на сегмент, чтобы назначить тег.'}
            {tree.treeData.map(tag => (
              <div key={tag.name} style={{ padding: '4px 0' }}>
                <span style={{
                  display: 'inline-block', width: 12, height: 12, borderRadius: '50%',
                  background: tag.color, marginRight: 8, verticalAlign: 'middle',
                }} />
                {tag.name} ({tag.total_segments})
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Help modal */}
      {showHelp && (
        <div className="modal-overlay" onClick={() => setShowHelp(false)}>
          <div className="help-modal" onClick={e => e.stopPropagation()}>
            <h3 style={{ marginBottom: 16 }}>Горячие клавиши</h3>
            <div className="help-grid">
              {[
                ['S', 'Границы сегментов'],
                ['B', 'Цветные сегменты'],
                ['X', 'Угол 45°/90°'],
                ['P', 'Режим PPL/XPL'],
                ['U', 'Неразмеченные'],
                ['H', 'Эта справка'],
                ['←→↑↓', 'Навигация по патчам'],
                ['Ctrl+=', 'Приблизить'],
                ['Ctrl+-', 'Отдалить'],
                ['ПКМ+тянуть', 'Перемещение'],
                ['Колесо', 'Масштаб к курсору'],
                ['Ctrl+клик', 'Мультивыбор'],
              ].map(([key, desc]) => (
                <span key={key as string} style={{ display: 'contents' }}>
                  <kbd>{key}</kbd>
                  <span>{desc}</span>
                </span>
              ))}
            </div>
            <button className="btn btn-secondary" style={{ marginTop: 16, width: '100%' }}
              onClick={() => setShowHelp(false)}>Закрыть</button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```

If there are type errors, fix them. Common issues:
- Missing `React` import for `React.Fragment` → use `<></>` instead
- Ref types need proper initialization → use `useRef<T>(null)`

- [ ] **Step 3: Verify Vite dev server starts**

```bash
cd frontend && timeout 10 npm run dev 2>&1 || true
```

Expected: Vite starts without errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "feat: rewrite App.tsx with hook orchestration and WelcomeScreen routing"
```

---

## End of Phase 2

After completing all 9 tasks, you have:
- 6 custom hooks encapsulating all business logic from the monolith
- `utils.ts` with shared pure functions (tagColor, pluralSeg, drawOnCanvas, drawSelectionStripes)
- WelcomeScreen component with Tauri file picker
- App.tsx that orchestrates everything with WelcomeScreen → Editor routing
- All TypeScript, no runtime errors from tsc

**What's working:**
- API initialization with dynamic port
- Image loading and alignment flow
- Segmentation progress polling
- Canvas zoom/pan with refs
- Keyboard shortcuts with input buffering
- Tree state with useReducer
- Tagging, undo/redo
- Selection masking

**What's placeholder (Phase 3):**
- Minimap component (currently text-only progress)
- TreeNode recursive component (currently flat tag list)
- QuickInput autocomplete component (currently no input UI in sidebar)
- ContextMenu component (currently no right-click menu)
- Full Toolbar component (currently inline buttons)
- ImageViewer as separate component (currently inline canvases)
- Toast notifications

**Next:** Phase 3 (UI components) in a separate plan.
