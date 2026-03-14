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
