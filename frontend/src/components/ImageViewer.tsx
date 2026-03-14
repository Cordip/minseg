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
        <canvas ref={canvasBgRef} style={{ position: 'absolute', top: 0, left: 0, zIndex: 1 }} />
        <canvas ref={canvasBoundRef} style={{ position: 'absolute', top: 0, left: 0, opacity: showBounds ? 0.8 : 0, mixBlendMode: 'multiply', zIndex: 2, pointerEvents: 'none' }} />
        <canvas ref={canvasSegRef} style={{ position: 'absolute', top: 0, left: 0, opacity: showSegments ? 1 : 0, zIndex: 3, pointerEvents: 'none' }} />
        <canvas ref={canvasBorderRef} style={{ position: 'absolute', top: 0, left: 0, opacity: showSegments ? 0.6 : 0, mixBlendMode: 'multiply', zIndex: 4, pointerEvents: 'none' }} />
        <canvas ref={canvasUntaggedRef} style={{ position: 'absolute', top: 0, left: 0, opacity: showUntagged ? 0.6 : 0, zIndex: 5, pointerEvents: 'none' }} />
        <canvas ref={canvasSelectionRef} style={{ position: 'absolute', top: 0, left: 0, opacity: hasSelection ? 0.5 : 0, zIndex: 6, pointerEvents: 'none' }} />
        {!patchReady && (
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', zIndex: 7 }}>Обработка...</div>
        )}
      </div>
    </div>
  );
}
