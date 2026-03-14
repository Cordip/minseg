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
        <button className="btn btn-secondary" onClick={onToggleXpl}>{isXpl ? 'XPL' : 'PPL'}</button>
        <button className="btn btn-secondary" onClick={onToggleXpl90}>{isXpl90 ? '90°' : '45°'}</button>
      </div>
      <div className="toolbar-divider" />
      <div className="toolbar-group">
        <button className={`btn btn-secondary ${showBounds ? 'active' : ''}`} onClick={onToggleBounds}>Границы (S)</button>
        <button className={`btn btn-secondary ${showSegments ? 'active' : ''}`} onClick={onToggleSegments}>Сегменты (B)</button>
        <button className="btn" style={{ backgroundColor: showUntagged ? '#ff4757' : '#6c757d', color: '#fff', border: 'none' }} onClick={onToggleUntagged}>Неразмеченные</button>
      </div>
      <div className="toolbar-divider" />
      <div className="toolbar-group">
        <button className="btn btn-secondary" onClick={() => onNavigate({ ...currentPatch, x: currentPatch.x - 1 })} disabled={currentPatch.x === 0}>◀</button>
        <span className="patch-counter">{currentPatch.x + 1}/{gridSize.cols}</span>
        <button className="btn btn-secondary" onClick={() => onNavigate({ ...currentPatch, x: currentPatch.x + 1 })} disabled={currentPatch.x >= gridSize.cols - 1}>▶</button>
        <span style={{ margin: '0 5px', color: '#555' }}>|</span>
        <button className="btn btn-secondary" onClick={() => onNavigate({ ...currentPatch, y: currentPatch.y - 1 })} disabled={currentPatch.y === 0}>▲</button>
        <span className="patch-counter">{currentPatch.y + 1}/{gridSize.rows}</span>
        <button className="btn btn-secondary" onClick={() => onNavigate({ ...currentPatch, y: currentPatch.y + 1 })} disabled={currentPatch.y >= gridSize.rows - 1}>▼</button>
      </div>
      <div className="toolbar-divider" />
      <button className="btn btn-secondary" onClick={onUndo} disabled={!canUndo} style={{ opacity: canUndo ? 1 : 0.3 }}>↩</button>
      <button className="btn btn-secondary" onClick={onRedo} disabled={!canRedo} style={{ opacity: canRedo ? 1 : 0.3 }}>↪</button>
      <div className="toolbar-divider" />
      <button className="btn btn-primary" onClick={onSave}>Сохранить</button>
      <button className="btn btn-primary" style={{ backgroundColor: '#28a745', borderColor: '#28a745' }} onClick={onExport}>Экспорт</button>
      <button className="btn btn-secondary" style={{ marginLeft: 'auto' }} onClick={onHelp}>?</button>
    </div>
  );
}
