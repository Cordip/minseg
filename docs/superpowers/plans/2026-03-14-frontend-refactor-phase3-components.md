# Phase 3: UI Components Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract all inline UI from App.tsx into focused React components, completing the frontend refactoring from the 1159-line monolith to a modular TypeScript architecture.

**Architecture:** Each component receives props from App.tsx — no business logic in components. Toolbar, HelpModal are stateless. Minimap uses React.memo with custom comparator. TreeNode is recursive with React.memo. ContextMenu manages its own deleteConfirm and rename state internally. App.tsx becomes a thin orchestrator (~150 lines).

**Tech Stack:** React 19, TypeScript, React.memo, @tauri-apps/plugin-dialog (save/export folder picker)

**Spec:** `docs/superpowers/specs/2026-03-14-frontend-refactor-design.md`
**Source:** `frontend/src/app-bundle.js` (reference for canvas drawing, tree rendering, context menu logic)

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `frontend/src/components/Toolbar.tsx` | Create | Top button bar — view toggles, navigation, undo/redo, save/export |
| `frontend/src/components/HelpModal.tsx` | Create | Keyboard shortcuts reference overlay |
| `frontend/src/components/Minimap.tsx` | Create | Canvas patch grid with state overlays, click navigation |
| `frontend/src/components/ImageViewer.tsx` | Create | 6-layer stacked canvas viewer with zoom/pan |
| `frontend/src/components/QuickInput.tsx` | Create | Inline tag input with autocomplete |
| `frontend/src/components/TreeNode.tsx` | Create | Recursive 3-level tree node (React.memo) |
| `frontend/src/components/TagPanel.tsx` | Create | Sidebar with tree, resize handle, quick input |
| `frontend/src/components/ContextMenu.tsx` | Create | Right-click menu with level-aware actions |
| `frontend/src/App.tsx` | Rewrite | Thin orchestrator using all components |

---

## Chunk 1: Toolbar + HelpModal + Minimap

### Task 1: Create Toolbar and HelpModal

**Files:**
- Create: `frontend/src/components/Toolbar.tsx`
- Create: `frontend/src/components/HelpModal.tsx`

- [ ] **Step 1: Create Toolbar.tsx**

Create `frontend/src/components/Toolbar.tsx`:

```tsx
import type { PatchCoord } from '../types';

interface Props {
  isXpl: boolean;
  isXpl90: boolean;
  showSegments: boolean;
  showBounds: boolean;
  showUntagged: boolean;
  currentPatch: PatchCoord;
  gridSize: { rows: number; cols: number };
  canUndo: boolean;
  canRedo: boolean;
  onToggleXpl: () => void;
  onToggleXpl90: () => void;
  onToggleSegments: () => void;
  onToggleBounds: () => void;
  onToggleUntagged: () => void;
  onNavigate: (patch: PatchCoord) => void;
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => void;
  onExport: () => void;
  onHelp: () => void;
}

export default function Toolbar({
  isXpl, isXpl90, showSegments, showBounds, showUntagged,
  currentPatch, gridSize, canUndo, canRedo,
  onToggleXpl, onToggleXpl90, onToggleSegments, onToggleBounds, onToggleUntagged,
  onNavigate, onUndo, onRedo, onSave, onExport, onHelp,
}: Props) {
  return (
    <div className="toolbar">
      <div className="toolbar-group">
        <button className="btn btn-secondary" onClick={onToggleXpl}>
          {isXpl ? 'XPL' : 'PPL'}
        </button>
        <button className="btn btn-secondary" onClick={onToggleXpl90}>
          {isXpl90 ? '90°' : '45°'}
        </button>
      </div>
      <div className="toolbar-divider" />
      <div className="toolbar-group">
        <button className={`btn btn-secondary ${showBounds ? 'active' : ''}`}
          onClick={onToggleBounds}>Границы (S)</button>
        <button className={`btn btn-secondary ${showSegments ? 'active' : ''}`}
          onClick={onToggleSegments}>Сегменты (B)</button>
        <button className="btn" style={{
          backgroundColor: showUntagged ? '#ff4757' : '#6c757d',
          color: '#fff', border: 'none',
        }} onClick={onToggleUntagged}>Неразмеченные</button>
      </div>
      <div className="toolbar-divider" />
      <div className="toolbar-group">
        <button className="btn btn-secondary"
          onClick={() => onNavigate({ ...currentPatch, x: currentPatch.x - 1 })}
          disabled={currentPatch.x === 0}>◀</button>
        <span className="patch-counter">{currentPatch.x + 1}/{gridSize.cols}</span>
        <button className="btn btn-secondary"
          onClick={() => onNavigate({ ...currentPatch, x: currentPatch.x + 1 })}
          disabled={currentPatch.x >= gridSize.cols - 1}>▶</button>
        <span style={{ margin: '0 5px', color: '#555' }}>|</span>
        <button className="btn btn-secondary"
          onClick={() => onNavigate({ ...currentPatch, y: currentPatch.y - 1 })}
          disabled={currentPatch.y === 0}>▲</button>
        <span className="patch-counter">{currentPatch.y + 1}/{gridSize.rows}</span>
        <button className="btn btn-secondary"
          onClick={() => onNavigate({ ...currentPatch, y: currentPatch.y + 1 })}
          disabled={currentPatch.y >= gridSize.rows - 1}>▼</button>
      </div>
      <div className="toolbar-divider" />
      <button className="btn btn-secondary" onClick={onUndo}
        disabled={!canUndo} style={{ opacity: canUndo ? 1 : 0.3 }}>↩</button>
      <button className="btn btn-secondary" onClick={onRedo}
        disabled={!canRedo} style={{ opacity: canRedo ? 1 : 0.3 }}>↪</button>
      <div className="toolbar-divider" />
      <button className="btn btn-primary" onClick={onSave}>Сохранить</button>
      <button className="btn btn-primary" style={{ backgroundColor: '#28a745', borderColor: '#28a745' }}
        onClick={onExport}>Экспорт</button>
      <button className="btn btn-secondary" style={{ marginLeft: 'auto' }}
        onClick={onHelp}>?</button>
    </div>
  );
}
```

- [ ] **Step 2: Create HelpModal.tsx**

Create `frontend/src/components/HelpModal.tsx`:

```tsx
interface Props {
  onClose: () => void;
}

const SHORTCUTS = [
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
  ['Ctrl+Z', 'Отменить'],
  ['Ctrl+Y', 'Повторить'],
] as const;

export default function HelpModal({ onClose }: Props) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="help-modal" onClick={e => e.stopPropagation()}>
        <h3 style={{ marginBottom: 16 }}>Горячие клавиши</h3>
        <div className="help-grid">
          {SHORTCUTS.map(([key, desc]) => (
            <span key={key} style={{ display: 'contents' }}>
              <kbd>{key}</kbd>
              <span>{desc}</span>
            </span>
          ))}
        </div>
        <button className="btn btn-secondary" style={{ marginTop: 16, width: '100%' }}
          onClick={onClose}>Закрыть</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify and commit**

```bash
cd frontend && npx tsc --noEmit
git add frontend/src/components/Toolbar.tsx frontend/src/components/HelpModal.tsx
git commit -m "feat: add Toolbar and HelpModal components"
```

---

### Task 2: Create Minimap component

**Files:**
- Create: `frontend/src/components/Minimap.tsx`

- [ ] **Step 1: Create Minimap.tsx**

Create `frontend/src/components/Minimap.tsx`:

```tsx
import { useEffect, useRef, useState, memo } from 'react';
import type { PatchCoord, PatchState, MinimapData, SegProgress, PatchStats } from '../types';

interface Props {
  minimapData: MinimapData | null;
  currentPatch: PatchCoord;
  gridSize: { rows: number; cols: number };
  patchStates: Record<string, PatchState>;
  segProgress: SegProgress;
  patchStats: PatchStats;
  onNavigate: (patch: PatchCoord) => void;
}

function MinimapInner({
  minimapData, currentPatch, gridSize, patchStates, segProgress, patchStats, onNavigate,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [animTick, setAnimTick] = useState(0);

  // Animate spinner when patches are actively processing
  useEffect(() => {
    const hasActive = Object.values(patchStates).some(s => s === 'active');
    if (!hasActive) return;
    const timer = setInterval(() => setAnimTick(t => t + 1), 200);
    return () => clearInterval(timer);
  }, [patchStates]);

  // Draw minimap
  useEffect(() => {
    if (!minimapData || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const img = new Image();
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      const cw = canvas.width / gridSize.cols;
      const ch = canvas.height / gridSize.rows;

      // Per-cell state overlays
      for (let py = 0; py < gridSize.rows; py++) {
        for (let px = 0; px < gridSize.cols; px++) {
          const st = patchStates[`${py},${px}`];
          if (st === 'pending') {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
            ctx.fillRect(px * cw, py * ch, cw, ch);
          } else if (st === 'active') {
            ctx.fillStyle = 'rgba(74, 158, 255, 0.3)';
            ctx.fillRect(px * cw, py * ch, cw, ch);
            const cx = px * cw + cw / 2;
            const cy = py * ch + ch / 2;
            const r = Math.min(cw, ch) * 0.2;
            ctx.strokeStyle = '#4a9eff';
            ctx.lineWidth = 2;
            ctx.beginPath();
            const t = Date.now() / 500;
            ctx.arc(cx, cy, r, t, t + Math.PI * 1.4);
            ctx.stroke();
          }
        }
      }

      // Grid lines
      ctx.strokeStyle = 'rgba(255,255,255,0.2)';
      ctx.lineWidth = 1;
      for (let i = 0; i <= gridSize.cols; i++) {
        ctx.beginPath(); ctx.moveTo(i * cw, 0); ctx.lineTo(i * cw, canvas.height); ctx.stroke();
      }
      for (let j = 0; j <= gridSize.rows; j++) {
        ctx.beginPath(); ctx.moveTo(0, j * ch); ctx.lineTo(canvas.width, j * ch); ctx.stroke();
      }

      // Current patch highlight (red)
      ctx.strokeStyle = '#ff4757';
      ctx.lineWidth = 3;
      ctx.strokeRect(currentPatch.x * cw, currentPatch.y * ch, cw, ch);
      ctx.fillStyle = 'rgba(255, 71, 87, 0.2)';
      ctx.fillRect(currentPatch.x * cw, currentPatch.y * ch, cw, ch);
    };
    img.src = 'data:image/png;base64,' + minimapData.image;
  }, [minimapData, currentPatch, gridSize, patchStates, animTick]);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) / rect.width * gridSize.cols);
    const y = Math.floor((e.clientY - rect.top) / rect.height * gridSize.rows);
    onNavigate({
      y: Math.max(0, Math.min(gridSize.rows - 1, y)),
      x: Math.max(0, Math.min(gridSize.cols - 1, x)),
    });
  };

  const pct = segProgress.total > 0 ? Math.round(segProgress.done / segProgress.total * 100) : 0;

  return (
    <div className="minimap-panel">
      <div className="minimap-header">Миникарта</div>
      <div style={{ padding: 10 }}>
        <canvas ref={canvasRef} onClick={handleClick}
          style={{ width: '100%', cursor: 'pointer', display: 'block' }} />
      </div>
      {segProgress.total > 0 && (
        <div style={{ padding: '0 10px 10px 10px' }}>
          <div style={{
            width: '100%', height: 16, backgroundColor: '#2a2a3e',
            borderRadius: 8, overflow: 'hidden',
          }}>
            <div style={{
              width: `${pct}%`, height: '100%',
              backgroundColor: segProgress.done >= segProgress.total ? '#28a745' : '#4a9eff',
              borderRadius: 8, transition: 'width 0.3s ease',
            }} />
          </div>
          <div style={{ textAlign: 'center', fontSize: 13, color: '#aaa', marginTop: 4 }}>
            {`${segProgress.done} / ${segProgress.total} (${pct}%) | Осталось: ${segProgress.untagged}`}
          </div>
          <div style={{ textAlign: 'center', fontSize: 13, color: '#aaa', marginTop: 2 }}>
            {`Патч: ${patchStats.tagged} / ${patchStats.total} | Осталось: ${patchStats.total - patchStats.tagged}`}
          </div>
        </div>
      )}
    </div>
  );
}

const Minimap = memo(MinimapInner, (prev, next) => {
  return prev.minimapData === next.minimapData
    && prev.currentPatch.y === next.currentPatch.y
    && prev.currentPatch.x === next.currentPatch.x
    && prev.patchStates === next.patchStates
    && prev.segProgress === next.segProgress
    && prev.patchStats === next.patchStats
    && prev.gridSize === next.gridSize;
});

export default Minimap;
```

- [ ] **Step 2: Verify and commit**

```bash
cd frontend && npx tsc --noEmit
git add frontend/src/components/Minimap.tsx
git commit -m "feat: add Minimap component with canvas overlays and React.memo"
```

---

## Chunk 2: ImageViewer + QuickInput + TreeNode

### Task 3: Create ImageViewer component

**Files:**
- Create: `frontend/src/components/ImageViewer.tsx`

- [ ] **Step 1: Create ImageViewer.tsx**

Create `frontend/src/components/ImageViewer.tsx`:

```tsx
import type { RefObject } from 'react';

interface Props {
  zoom: number;
  offset: { x: number; y: number };
  showSegments: boolean;
  showBounds: boolean;
  showUntagged: boolean;
  hasSelection: boolean;
  patchReady: boolean;
  viewerCallbackRef: (node: HTMLDivElement | null) => void;
  onMouseDown: (e: React.MouseEvent) => void;
  onMouseMove: (e: React.MouseEvent) => void;
  onMouseUp: () => void;
  onClick: (e: React.MouseEvent) => void;
  canvasBgRef: RefObject<HTMLCanvasElement | null>;
  canvasBoundRef: RefObject<HTMLCanvasElement | null>;
  canvasSegRef: RefObject<HTMLCanvasElement | null>;
  canvasBorderRef: RefObject<HTMLCanvasElement | null>;
  canvasUntaggedRef: RefObject<HTMLCanvasElement | null>;
  canvasSelectionRef: RefObject<HTMLCanvasElement | null>;
}

export default function ImageViewer({
  zoom, offset, showSegments, showBounds, showUntagged, hasSelection, patchReady,
  viewerCallbackRef, onMouseDown, onMouseMove, onMouseUp, onClick,
  canvasBgRef, canvasBoundRef, canvasSegRef, canvasBorderRef, canvasUntaggedRef, canvasSelectionRef,
}: Props) {
  return (
    <div className="viewer-panel" ref={viewerCallbackRef}
      onMouseDown={onMouseDown} onMouseMove={onMouseMove}
      onMouseUp={onMouseUp} onMouseLeave={onMouseUp}
      onContextMenu={e => e.preventDefault()}>
      <div className="viewer-canvas" style={{
        transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
        transformOrigin: '0 0', position: 'relative', width: 1024, height: 1024,
      }} onClick={onClick}>
        <canvas ref={canvasBgRef}
          style={{ position: 'absolute', top: 0, left: 0, zIndex: 1 }} />
        <canvas ref={canvasBoundRef} style={{
          position: 'absolute', top: 0, left: 0,
          opacity: showBounds ? 0.8 : 0,
          mixBlendMode: 'multiply', zIndex: 2, pointerEvents: 'none',
        }} />
        <canvas ref={canvasSegRef} style={{
          position: 'absolute', top: 0, left: 0,
          opacity: showSegments ? 1 : 0,
          zIndex: 3, pointerEvents: 'none',
        }} />
        <canvas ref={canvasBorderRef} style={{
          position: 'absolute', top: 0, left: 0,
          opacity: showSegments ? 0.6 : 0,
          mixBlendMode: 'multiply', zIndex: 4, pointerEvents: 'none',
        }} />
        <canvas ref={canvasUntaggedRef} style={{
          position: 'absolute', top: 0, left: 0,
          opacity: showUntagged ? 0.6 : 0,
          zIndex: 5, pointerEvents: 'none',
        }} />
        <canvas ref={canvasSelectionRef} style={{
          position: 'absolute', top: 0, left: 0,
          opacity: hasSelection ? 0.5 : 0,
          zIndex: 6, pointerEvents: 'none',
        }} />
        {!patchReady && (
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center',
            justifyContent: 'center', color: '#fff', zIndex: 7,
          }}>Обработка...</div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify and commit**

```bash
cd frontend && npx tsc --noEmit
git add frontend/src/components/ImageViewer.tsx
git commit -m "feat: add ImageViewer component with 6 stacked canvas layers"
```

---

### Task 4: Create QuickInput component

**Files:**
- Create: `frontend/src/components/QuickInput.tsx`

- [ ] **Step 1: Create QuickInput.tsx**

Create `frontend/src/components/QuickInput.tsx`:

```tsx
import { useRef, useEffect } from 'react';
import type { QuickInputState, SelectedSegment } from '../types';
import { pluralSeg } from '../utils';

interface Props {
  quickInput: QuickInputState | null;
  selectedSegments: SelectedSegment[];
  quickFilter: string;
  quickHighlight: number;
  tags: Record<string, string>;
  onFilterChange: (value: string) => void;
  onHighlightChange: (value: number) => void;
  onApplyTag: (tagName: string) => void;
  onCancel: () => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}

export default function QuickInput({
  quickInput, selectedSegments, quickFilter, quickHighlight, tags,
  onFilterChange, onHighlightChange, onApplyTag, onCancel, inputRef,
}: Props) {
  const localRef = useRef<HTMLInputElement>(null);
  const ref = inputRef ?? localRef;

  const isOpen = quickInput !== null || selectedSegments.length > 0;

  useEffect(() => {
    if (isOpen) setTimeout(() => ref.current?.focus(), 50);
  }, [isOpen, ref]);

  if (!isOpen) return null;

  const filtered = Object.entries(tags)
    .filter(([n]) => n.toLowerCase().includes(quickFilter.toLowerCase()))
    .slice(0, 8);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      const chosen = filtered[quickHighlight]?.[0] ?? quickFilter;
      if (chosen.trim()) onApplyTag(chosen);
    } else if (e.key === 'Escape') {
      onCancel();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      onHighlightChange(quickHighlight + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      onHighlightChange(Math.max(0, quickHighlight - 1));
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const name = filtered[quickHighlight]?.[0];
      if (name) onFilterChange(name);
    }
  };

  return (
    <div className="quick-input">
      <div className="quick-input-label">
        {selectedSegments.length > 0
          ? `Выбрано: ${selectedSegments.length} ${pluralSeg(selectedSegments.length)}`
          : quickInput
            ? `Сегмент #${quickInput.segmentId} · Патч ${quickInput.patchY},${quickInput.patchX}`
            : ''}
      </div>
      <input
        ref={ref}
        placeholder="Название минерала..."
        value={quickFilter}
        onChange={e => { onFilterChange(e.target.value); onHighlightChange(0); }}
        onKeyDown={handleKeyDown}
      />
      <div className="quick-input-hint">Enter — применить · Esc — отмена</div>
      {quickFilter && (
        <div className="quick-input-suggestions">
          {filtered.map(([name, color], i) => (
            <div key={name}
              className={`quick-input-suggestion${i === quickHighlight ? ' highlighted' : ''}`}
              onClick={() => onApplyTag(name)}>
              <span style={{ width: 12, height: 12, borderRadius: '50%', background: color, display: 'inline-block' }} />
              <span>{name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify and commit**

```bash
cd frontend && npx tsc --noEmit
git add frontend/src/components/QuickInput.tsx
git commit -m "feat: add QuickInput component with autocomplete"
```

---

### Task 5: Create TreeNode component

**Files:**
- Create: `frontend/src/components/TreeNode.tsx`

- [ ] **Step 1: Create TreeNode.tsx**

Create `frontend/src/components/TreeNode.tsx`:

```tsx
import { memo } from 'react';
import type { TreeTag, PatchCoord, ContextMenuState } from '../types';

interface Props {
  treeData: TreeTag[];
  expandedNodes: Set<string>;
  treeSelection: Set<string>;
  onToggleNode: (key: string) => void;
  onTreeClick: (e: React.MouseEvent, nodeKey: string) => void;
  onNavigate: (patch: PatchCoord) => void;
  onContextMenu: (menu: ContextMenuState) => void;
}

function TreeNodeInner({
  treeData, expandedNodes, treeSelection,
  onToggleNode, onTreeClick, onNavigate, onContextMenu,
}: Props) {
  return (
    <div className="tags-list">
      {treeData.map(tag => (
        <div key={tag.name}>
          {/* Level 1: Tag */}
          <div
            className={`tree-node tree-level-1${treeSelection.has('tag:' + tag.name) ? ' selected' : ''}`}
            onContextMenu={e => {
              e.preventDefault();
              onContextMenu({ x: e.clientX, y: e.clientY, tagName: tag.name, tagColor: tag.color, level: 'tag' });
            }}
            onClick={e => {
              if (e.ctrlKey || e.shiftKey) { onTreeClick(e, 'tag:' + tag.name); return; }
              onToggleNode('tag:' + tag.name);
            }}
          >
            <span className="tree-node-arrow" onClick={e => { e.stopPropagation(); onToggleNode('tag:' + tag.name); }}>
              {expandedNodes.has('tag:' + tag.name) ? '▼' : '▶'}
            </span>
            <span className="tree-node-color" style={{ backgroundColor: tag.color }} />
            <span className="tree-node-label">{tag.name}</span>
            <span className="tree-node-count">{tag.total_segments}</span>
          </div>

          {/* Level 2: Patches */}
          {expandedNodes.has('tag:' + tag.name) && tag.patches.map(patch => {
            const patchKey = `patch:${tag.name}:${patch.patch_y},${patch.patch_x}`;
            return (
              <div key={patchKey}>
                <div
                  className="tree-node tree-level-2"
                  onClick={e => {
                    if (e.ctrlKey || e.shiftKey) { onTreeClick(e, patchKey); return; }
                    onNavigate({ y: patch.patch_y, x: patch.patch_x });
                  }}
                  onContextMenu={e => {
                    e.preventDefault();
                    onContextMenu({
                      x: e.clientX, y: e.clientY, tagName: tag.name, tagColor: tag.color,
                      level: 'patch', patchY: patch.patch_y, patchX: patch.patch_x,
                    });
                  }}
                >
                  <span className="tree-node-arrow" onClick={e => { e.stopPropagation(); onToggleNode(patchKey); }}>
                    {expandedNodes.has(patchKey) ? '▼' : '▶'}
                  </span>
                  <span className="tree-node-label">Патч {patch.patch_y},{patch.patch_x}</span>
                  <span className="tree-node-count">{patch.count}</span>
                </div>

                {/* Level 3: Segments */}
                {expandedNodes.has(patchKey) && patch.segments.map(sid => {
                  const segKey = `seg:${patch.patch_y},${patch.patch_x}:${sid}`;
                  return (
                    <div key={sid}
                      className={`tree-node tree-level-3${treeSelection.has(segKey) ? ' selected' : ''}`}
                      onClick={e => {
                        if (e.ctrlKey || e.shiftKey) { onTreeClick(e, segKey); return; }
                        onNavigate({ y: patch.patch_y, x: patch.patch_x });
                      }}
                      onContextMenu={e => {
                        e.preventDefault();
                        onContextMenu({
                          x: e.clientX, y: e.clientY, tagName: tag.name, tagColor: tag.color,
                          level: 'segment', patchY: patch.patch_y, patchX: patch.patch_x, segmentId: sid,
                        });
                      }}
                    >
                      <span className="tree-node-label" style={{ color: '#aaa' }}>#{sid}</span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

const TreeNode = memo(TreeNodeInner);
export default TreeNode;
```

- [ ] **Step 2: Verify and commit**

```bash
cd frontend && npx tsc --noEmit
git add frontend/src/components/TreeNode.tsx
git commit -m "feat: add TreeNode component with 3-level recursive rendering"
```

---

## Chunk 3: TagPanel + ContextMenu + App.tsx Integration

### Task 6: Create TagPanel component

**Files:**
- Create: `frontend/src/components/TagPanel.tsx`

- [ ] **Step 1: Create TagPanel.tsx**

Create `frontend/src/components/TagPanel.tsx`:

```tsx
import { useState, useCallback } from 'react';
import type { TreeTag, PatchCoord, ContextMenuState, QuickInputState, SelectedSegment } from '../types';
import TreeNode from './TreeNode';
import QuickInput from './QuickInput';

interface Props {
  treeData: TreeTag[];
  expandedNodes: Set<string>;
  treeSelection: Set<string>;
  canUndo: boolean;
  canRedo: boolean;
  quickInput: QuickInputState | null;
  selectedSegments: SelectedSegment[];
  quickFilter: string;
  quickHighlight: number;
  tags: Record<string, string>;
  onToggleNode: (key: string) => void;
  onTreeClick: (e: React.MouseEvent, nodeKey: string) => void;
  onNavigate: (patch: PatchCoord) => void;
  onContextMenu: (menu: ContextMenuState) => void;
  onUndo: () => void;
  onRedo: () => void;
  onFilterChange: (value: string) => void;
  onHighlightChange: (value: number) => void;
  onApplyTag: (tagName: string) => void;
  onCancelInput: () => void;
  quickInputRef?: React.RefObject<HTMLInputElement | null>;
}

export default function TagPanel({
  treeData, expandedNodes, treeSelection, canUndo, canRedo,
  quickInput, selectedSegments, quickFilter, quickHighlight, tags,
  onToggleNode, onTreeClick, onNavigate, onContextMenu,
  onUndo, onRedo, onFilterChange, onHighlightChange, onApplyTag, onCancelInput,
  quickInputRef,
}: Props) {
  const [width, setWidth] = useState(400);

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;
    const onMove = (e2: MouseEvent) => {
      setWidth(Math.max(250, Math.min(600, startWidth - (e2.clientX - startX))));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [width]);

  return (
    <div className="tags-panel" style={{ width }}>
      <div className="sidebar-resize" onMouseDown={startResize} />
      <div className="tags-header">
        <span>Теги минералов <span style={{ color: '#888', fontWeight: 400 }}>({treeData.length})</span></span>
        <div style={{ display: 'flex', gap: 4 }}>
          <button className="btn btn-secondary"
            style={{ padding: '2px 6px', fontSize: 11, opacity: canUndo ? 1 : 0.3 }}
            onClick={onUndo} disabled={!canUndo} title="Undo (Ctrl+Z)">↩</button>
          <button className="btn btn-secondary"
            style={{ padding: '2px 6px', fontSize: 11, opacity: canRedo ? 1 : 0.3 }}
            onClick={onRedo} disabled={!canRedo} title="Redo (Ctrl+Y)">↪</button>
        </div>
      </div>
      <QuickInput
        quickInput={quickInput}
        selectedSegments={selectedSegments}
        quickFilter={quickFilter}
        quickHighlight={quickHighlight}
        tags={tags}
        onFilterChange={onFilterChange}
        onHighlightChange={onHighlightChange}
        onApplyTag={onApplyTag}
        onCancel={onCancelInput}
        inputRef={quickInputRef}
      />
      <TreeNode
        treeData={treeData}
        expandedNodes={expandedNodes}
        treeSelection={treeSelection}
        onToggleNode={onToggleNode}
        onTreeClick={onTreeClick}
        onNavigate={onNavigate}
        onContextMenu={onContextMenu}
      />
    </div>
  );
}
```

- [ ] **Step 2: Verify and commit**

```bash
cd frontend && npx tsc --noEmit
git add frontend/src/components/TagPanel.tsx
git commit -m "feat: add TagPanel with resize handle, tree, and quick input"
```

---

### Task 7: Create ContextMenu component

**Files:**
- Create: `frontend/src/components/ContextMenu.tsx`

- [ ] **Step 1: Create ContextMenu.tsx**

Create `frontend/src/components/ContextMenu.tsx`:

```tsx
import { useState } from 'react';
import type { Api } from '../api';
import type { ContextMenuState, SelectedSegment, TreeTag } from '../types';
import { pluralSeg } from '../utils';

interface Props {
  menu: ContextMenuState;
  api: Api;
  treeData: TreeTag[];
  treeSelection: Set<string>;
  resolveTreeSelection: (selection: Set<string>) => Set<string>;
  onClose: () => void;
  onRefresh: () => void;
  onNavigate: (patch: { y: number; x: number }) => void;
  onSelectSegments: (segs: SelectedSegment[]) => void;
}

const menuItemStyle: React.CSSProperties = {
  padding: '8px 16px', cursor: 'pointer', fontSize: 13, color: '#ddd',
  display: 'flex', alignItems: 'center', gap: 8,
};

function MenuItem({ onClick, style, children }: {
  onClick: () => void; style?: React.CSSProperties; children: React.ReactNode;
}) {
  return (
    <div style={{ ...menuItemStyle, ...style }}
      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = '#2a2a4a'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
      onClick={onClick}>
      {children}
    </div>
  );
}

export default function ContextMenu({
  menu, api, treeData, treeSelection, resolveTreeSelection,
  onClose, onRefresh, onNavigate, onSelectSegments,
}: Props) {
  const [deleteConfirm, setDeleteConfirm] = useState<{
    tagName: string; count: number; level?: string;
    patchY?: number; patchX?: number; segmentId?: number;
    resolved?: Set<string>;
  } | null>(null);
  const [renameValue, setRenameValue] = useState<string | null>(null);

  const handleRename = () => {
    setRenameValue(menu.tagName);
  };

  const submitRename = () => {
    if (!renameValue || !renameValue.trim() || renameValue.trim() === menu.tagName) {
      setRenameValue(null);
      return;
    }
    api.renameTag(menu.tagName, renameValue.trim()).then(() => {
      onRefresh();
      onClose();
    }).catch(() => {});
  };

  const handleRecolor = () => {
    const input = document.createElement('input');
    input.type = 'color';
    input.value = menu.tagColor;
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.onchange = () => {
      api.recolorTag(menu.tagName, input.value).then(() => onRefresh()).catch(() => {});
      document.body.removeChild(input);
      onClose();
    };
    input.addEventListener('cancel', () => document.body.removeChild(input));
    onClose();
    input.click();
  };

  const handleSelectForTag = () => {
    const resolved = resolveTreeSelection(treeSelection);
    const segs: SelectedSegment[] = [];
    resolved.forEach(key => {
      const parts = key.split(':');
      const coords = parts[1]!.split(',').map(Number);
      const sid = parseInt(parts[2]!);
      segs.push({ id: sid, patchY: coords[0]!, patchX: coords[1]! });
    });
    onSelectSegments(segs);
    onClose();
  };

  const handleDelete = () => {
    if (treeSelection.size > 0) {
      const resolved = resolveTreeSelection(treeSelection);
      setDeleteConfirm({ tagName: 'selected', count: resolved.size, resolved });
    } else if (menu.level === 'tag') {
      const tag = treeData.find(t => t.name === menu.tagName);
      setDeleteConfirm({ tagName: menu.tagName, count: tag?.total_segments ?? 0, level: 'tag' });
    } else {
      setDeleteConfirm({
        tagName: menu.tagName, count: 1, level: menu.level,
        patchY: menu.patchY, patchX: menu.patchX, segmentId: menu.segmentId,
      });
    }
  };

  const confirmDelete = () => {
    if (!deleteConfirm) return;
    if (deleteConfirm.resolved) {
      const segs: Array<{ patch_y: number; patch_x: number; segment_id: number }> = [];
      deleteConfirm.resolved.forEach(key => {
        const parts = key.split(':');
        const coords = parts[1]!.split(',').map(Number);
        const sid = parseInt(parts[2]!);
        segs.push({ patch_y: coords[0]!, patch_x: coords[1]!, segment_id: sid });
      });
      api.untagSegments({ segments: segs }).then(() => { onRefresh(); onClose(); }).catch(() => {});
    } else if (deleteConfirm.level === 'tag') {
      api.deleteTag(deleteConfirm.tagName).then(() => { onRefresh(); onClose(); }).catch(() => {});
    } else {
      api.untagSegments({
        segments: [{ patch_y: deleteConfirm.patchY!, patch_x: deleteConfirm.patchX!, segment_id: deleteConfirm.segmentId! }],
      }).then(() => { onRefresh(); onClose(); }).catch(() => {});
    }
  };

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999 }}
      onClick={() => { onClose(); setDeleteConfirm(null); }}
      onContextMenu={e => { e.preventDefault(); onClose(); }}>
      <div style={{
        position: 'fixed', left: menu.x, top: menu.y,
        background: '#1e1e2e', border: '1px solid #444', borderRadius: 6,
        boxShadow: '0 4px 16px rgba(0,0,0,0.5)', padding: '4px 0',
        minWidth: 180, zIndex: 10000,
      }} onClick={e => e.stopPropagation()}>

        {treeSelection.size > 0 && (
          <div style={{ padding: '6px 16px', fontSize: 11, color: '#888', borderBottom: '1px solid #333' }}>
            Выбрано: {treeSelection.size} ({resolveTreeSelection(treeSelection).size} {pluralSeg(resolveTreeSelection(treeSelection).size)})
          </div>
        )}

        {renameValue !== null ? (
          <div style={{ padding: '8px 16px' }}>
            <input autoFocus value={renameValue}
              onChange={e => setRenameValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submitRename(); if (e.key === 'Escape') setRenameValue(null); }}
              style={{
                width: '100%', background: '#16213e', border: '1px solid #4a9eff',
                borderRadius: 4, padding: '4px 8px', color: '#eaeaea', fontSize: 13, outline: 'none',
              }} />
          </div>
        ) : (
          <>
            {menu.level === 'tag' && treeSelection.size === 0 && (
              <MenuItem onClick={handleRename}>Переименовать</MenuItem>
            )}
            {treeSelection.size > 0 && (
              <MenuItem onClick={handleSelectForTag}>Назначить тег</MenuItem>
            )}
            <MenuItem onClick={handleRecolor}>Сменить цвет</MenuItem>
            {(menu.level === 'patch' || menu.level === 'segment') && (
              <MenuItem onClick={() => { onNavigate({ y: menu.patchY!, x: menu.patchX! }); onClose(); }}>
                Перейти
              </MenuItem>
            )}
            <div style={{ borderTop: '1px solid #444', margin: '4px 0' }} />
            {!deleteConfirm && (
              <MenuItem onClick={handleDelete} style={{ color: '#ff6b6b' }}>Удалить тег</MenuItem>
            )}
            {deleteConfirm && (
              <div style={{ padding: 8, background: '#2a2020', border: '1px solid #5a3030', borderRadius: 6, margin: '4px 8px' }}>
                <div style={{ color: '#ff6b6b', marginBottom: 4, fontSize: 12 }}>
                  {deleteConfirm.resolved
                    ? `Удалить теги у ${deleteConfirm.count} ${pluralSeg(deleteConfirm.count)}?`
                    : `Удалить "${deleteConfirm.tagName}" (${deleteConfirm.count} ${pluralSeg(deleteConfirm.count)})?`}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn" style={{ background: '#ff4444', color: '#fff', padding: '4px 12px', border: 'none', borderRadius: 4, cursor: 'pointer' }}
                    onClick={confirmDelete}>Удалить</button>
                  <button className="btn btn-secondary" style={{ padding: '4px 12px' }}
                    onClick={() => setDeleteConfirm(null)}>Отмена</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify and commit**

```bash
cd frontend && npx tsc --noEmit
git add frontend/src/components/ContextMenu.tsx
git commit -m "feat: add ContextMenu with rename, recolor, delete, and inline confirmation"
```

---

### Task 8: Rewrite App.tsx and clean up

**Files:**
- Rewrite: `frontend/src/App.tsx`
- Delete: `frontend/src/app-bundle.js`

- [ ] **Step 1: Rewrite App.tsx**

Replace `frontend/src/App.tsx` entirely with:

```tsx
import { useState, useEffect, useCallback, useRef } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import type { PatchCoord, SelectedSegment, ContextMenuState } from './types';
import { useApi } from './hooks/useApi';
import { useCanvas } from './hooks/useCanvas';
import { useSegmentation } from './hooks/useSegmentation';
import { useTree } from './hooks/useTree';
import { useTagging } from './hooks/useTagging';
import { useKeyboard } from './hooks/useKeyboard';
import { drawOnCanvas, drawSelectionStripes } from './utils';
import WelcomeScreen from './components/WelcomeScreen';
import Toolbar from './components/Toolbar';
import Minimap from './components/Minimap';
import ImageViewer from './components/ImageViewer';
import TagPanel from './components/TagPanel';
import ContextMenu from './components/ContextMenu';
import HelpModal from './components/HelpModal';

export default function App() {
  const { api, isReady, status: apiStatus } = useApi();

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

  const currentView = (isXpl ? 'xpl' : 'ppl') + (isXpl90 ? '90' : '45');

  const canvasBgRef = useRef<HTMLCanvasElement>(null);
  const canvasBoundRef = useRef<HTMLCanvasElement>(null);
  const canvasSegRef = useRef<HTMLCanvasElement>(null);
  const canvasBorderRef = useRef<HTMLCanvasElement>(null);
  const canvasUntaggedRef = useRef<HTMLCanvasElement>(null);
  const canvasSelectionRef = useRef<HTMLCanvasElement>(null);
  const quickInputRef = useRef<HTMLInputElement>(null);

  const canvas = useCanvas();
  const seg = useSegmentation(api, currentPatch, currentView, imagesAligned, gridSize);
  const tree = useTree(api);
  const tagging = useTagging(api, selectedSegments, setSelectedSegments, tree.fetchTree, seg.reloadPatch);

  // Draw images
  useEffect(() => { drawOnCanvas(canvasBgRef.current, seg.bgImage); }, [seg.bgImage]);
  useEffect(() => { drawOnCanvas(canvasSegRef.current, seg.segImage); }, [seg.segImage]);
  useEffect(() => { drawOnCanvas(canvasBoundRef.current, seg.boundsImage); }, [seg.boundsImage]);
  useEffect(() => { drawOnCanvas(canvasBorderRef.current, seg.bordersImage); }, [seg.bordersImage]);
  useEffect(() => { drawOnCanvas(canvasUntaggedRef.current, seg.untaggedImage); }, [seg.untaggedImage]);

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

  useEffect(() => {
    if (!api) return;
    api.getStatus().then(s => {
      if (s.images_aligned) {
        setGridSize(s.grid_size);
        setImagesAligned(true);
        api.startSegmentation().catch(() => {});
      }
    }).catch(() => {});
  }, [api]);

  useEffect(() => { if (api && imagesAligned) tree.fetchTree(); }, [api, imagesAligned]);
  useEffect(() => { canvas.resetView(); }, [currentPatch]);

  const handleNavigate = useCallback((patch: PatchCoord) => {
    setCurrentPatch({
      y: Math.max(0, Math.min(gridSize.rows - 1, patch.y)),
      x: Math.max(0, Math.min(gridSize.cols - 1, patch.x)),
    });
  }, [gridSize]);

  const handleSave = useCallback(async () => {
    if (!api) return;
    try {
      const selected = await open({ directory: true });
      if (typeof selected === 'string') api.saveProject(selected).catch(() => {});
    } catch { /* user cancelled */ }
  }, [api]);

  const handleExport = useCallback(async () => {
    if (!api) return;
    try {
      const selected = await open({ directory: true });
      if (typeof selected === 'string') api.exportProject(selected).catch(() => {});
    } catch { /* user cancelled */ }
  }, [api]);

  const handleRefresh = useCallback(() => {
    tree.fetchTree();
    seg.reloadPatch();
    tagging.refreshTags();
  }, [tree.fetchTree, seg.reloadPatch, tagging.refreshTags]);

  useKeyboard({
    onUndo: tagging.handleUndo,
    onRedo: tagging.handleRedo,
    onNavigate: (dx, dy) => setCurrentPatch(p => ({
      x: Math.max(0, Math.min(gridSize.cols - 1, p.x + dx)),
      y: Math.max(0, Math.min(gridSize.rows - 1, p.y + dy)),
    })),
    onToggleBounds: () => setShowBounds(v => !v),
    onToggleSegments: () => setShowSegments(v => !v),
    onToggleXpl90: () => setIsXpl90(v => !v),
    onTogglePpl: () => setIsXpl(v => !v),
    onToggleUntagged: seg.toggleUntagged,
    onToggleHelp: () => setShowHelp(v => !v),
    onEscape: () => {
      if (contextMenu) { setContextMenu(null); return; }
      if (showHelp) { setShowHelp(false); return; }
      tagging.setQuickInput(null); tagging.setQuickFilter('');
      setSelectedSegments([]); tree.dispatch({ type: 'CLEAR_SELECTION' });
    },
    onEnter: () => {
      if (selectedSegments.length > 0 && !quickInputRef.current?.matches(':focus'))
        setTimeout(() => quickInputRef.current?.focus(), 50);
    },
    onZoom: canvas.handleZoom,
  }, imagesAligned, tagging.quickInput !== null);

  const handleImageClick = useCallback((e: React.MouseEvent) => {
    if (!seg.patchReady || !api || canvas.isPanningRef.current) return;
    const viewer = canvas.viewerRef.current;
    if (!viewer) return;
    const rect = viewer.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left - canvas.offsetRef.current.x) / canvas.zoomRef.current);
    const y = Math.floor((e.clientY - rect.top - canvas.offsetRef.current.y) / canvas.zoomRef.current);
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

  // ─── Render ───

  if (!isReady) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#1a1a2e', color: '#eaeaea', fontFamily: 'system-ui' }}>
        <div style={{ textAlign: 'center' }}><h1>Mineral Segmentation v2</h1><p>{apiStatus}</p></div>
      </div>
    );
  }

  if (!imagesAligned && api) return <WelcomeScreen api={api} onReady={g => { setGridSize(g); setImagesAligned(true); }} />;

  return (
    <div className="app-container" onContextMenu={e => e.preventDefault()}>
      <Toolbar
        isXpl={isXpl} isXpl90={isXpl90} showSegments={showSegments} showBounds={showBounds}
        showUntagged={seg.showUntagged} currentPatch={currentPatch} gridSize={gridSize}
        canUndo={tree.canUndo} canRedo={tree.canRedo}
        onToggleXpl={() => setIsXpl(v => !v)} onToggleXpl90={() => setIsXpl90(v => !v)}
        onToggleSegments={() => setShowSegments(v => !v)} onToggleBounds={() => setShowBounds(v => !v)}
        onToggleUntagged={seg.toggleUntagged} onNavigate={handleNavigate}
        onUndo={tagging.handleUndo} onRedo={tagging.handleRedo}
        onSave={handleSave} onExport={handleExport} onHelp={() => setShowHelp(v => !v)}
      />
      <div className="main-content">
        <Minimap
          minimapData={seg.minimapData} currentPatch={currentPatch} gridSize={gridSize}
          patchStates={seg.patchStates} segProgress={seg.segProgress} patchStats={seg.patchStats}
          onNavigate={handleNavigate}
        />
        <ImageViewer
          zoom={canvas.zoom} offset={canvas.offset}
          showSegments={showSegments} showBounds={showBounds}
          showUntagged={seg.showUntagged} hasSelection={selectedSegments.length > 0}
          patchReady={seg.patchReady} viewerCallbackRef={canvas.viewerCallbackRef}
          onMouseDown={canvas.handleMouseDown} onMouseMove={canvas.handleMouseMove}
          onMouseUp={canvas.handleMouseUp} onClick={handleImageClick}
          canvasBgRef={canvasBgRef} canvasBoundRef={canvasBoundRef}
          canvasSegRef={canvasSegRef} canvasBorderRef={canvasBorderRef}
          canvasUntaggedRef={canvasUntaggedRef} canvasSelectionRef={canvasSelectionRef}
        />
        <TagPanel
          treeData={tree.treeData} expandedNodes={tree.expandedNodes} treeSelection={tree.treeSelection}
          canUndo={tree.canUndo} canRedo={tree.canRedo}
          quickInput={tagging.quickInput} selectedSegments={selectedSegments}
          quickFilter={tagging.quickFilter} quickHighlight={tagging.quickHighlight} tags={tagging.tags}
          onToggleNode={key => tree.dispatch({ type: 'TOGGLE_NODE', key })}
          onTreeClick={tree.handleTreeClick} onNavigate={handleNavigate}
          onContextMenu={setContextMenu} onUndo={tagging.handleUndo} onRedo={tagging.handleRedo}
          onFilterChange={tagging.setQuickFilter} onHighlightChange={tagging.setQuickHighlight}
          onApplyTag={tagging.applyTag} onCancelInput={() => { tagging.setQuickInput(null); tagging.setQuickFilter(''); setSelectedSegments([]); }}
          quickInputRef={quickInputRef}
        />
      </div>
      {contextMenu && api && (
        <ContextMenu menu={contextMenu} api={api} treeData={tree.treeData}
          treeSelection={tree.treeSelection} resolveTreeSelection={tree.resolveTreeSelection}
          onClose={() => setContextMenu(null)} onRefresh={handleRefresh}
          onNavigate={handleNavigate} onSelectSegments={segs => { setSelectedSegments(segs); setTimeout(() => quickInputRef.current?.focus(), 50); }}
        />
      )}
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 3: Delete old monolith reference**

```bash
cd /home/cordis/Gits/python/two/new2
git rm frontend/src/app-bundle.js
```

- [ ] **Step 4: Verify Vite dev server starts**

```bash
cd frontend && timeout 10 npm run dev 2>&1 || true
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "$(cat <<'EOF'
feat: rewrite App.tsx with extracted components, remove app-bundle.js

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## End of Phase 3

After completing all 8 tasks, the frontend refactoring is complete:

**Component tree:**
```
App.tsx (~150 lines, orchestrator)
├── WelcomeScreen (file picker, alignment)
├── Toolbar (view toggles, navigation, save/export)
├── Minimap (canvas, React.memo, progress)
├── ImageViewer (6 canvas layers, zoom/pan)
├── TagPanel (sidebar container)
│   ├── QuickInput (autocomplete)
│   └── TreeNode (3-level recursive, React.memo)
├── ContextMenu (rename, recolor, delete)
└── HelpModal (keyboard shortcuts)
```

**Hooks:**
```
useApi → useCanvas → useSegmentation → useTree → useTagging → useKeyboard
```

**What was removed:**
- `app-bundle.js` (1159-line monolith) — fully replaced

**Total file count:** ~20 TypeScript files replacing 1 JavaScript monolith
