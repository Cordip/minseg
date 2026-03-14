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
    viewerCallbackRef, viewerRef, isPanningRef,
    handleMouseDown, handleMouseMove, handleMouseUp,
    resetView, handleZoom,
  };
}
