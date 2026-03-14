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
  const [_sidebarWidth, _setSidebarWidth] = useState(400);

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
        api.startSegmentation().catch(() => {});
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
    if (!seg.patchReady || !api || canvas.isPanningRef.current) return;
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

  // Editor view (minimal layout — full components in Phase 3)
  return (
    <div className="app-container" onContextMenu={e => e.preventDefault()}>
      {/* Toolbar */}
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
        <div className="tags-panel" style={{ width: _sidebarWidth }}>
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
              {([
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
              ] as const).map(([key, desc]) => (
                <span key={key} style={{ display: 'contents' }}>
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
