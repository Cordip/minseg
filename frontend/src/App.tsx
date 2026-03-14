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
