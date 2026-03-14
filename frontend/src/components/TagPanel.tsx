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
        quickInput={quickInput} selectedSegments={selectedSegments}
        quickFilter={quickFilter} quickHighlight={quickHighlight} tags={tags}
        onFilterChange={onFilterChange} onHighlightChange={onHighlightChange}
        onApplyTag={onApplyTag} onCancel={onCancelInput} inputRef={quickInputRef}
      />
      <TreeNode
        treeData={treeData} expandedNodes={expandedNodes} treeSelection={treeSelection}
        onToggleNode={onToggleNode} onTreeClick={onTreeClick}
        onNavigate={onNavigate} onContextMenu={onContextMenu}
      />
    </div>
  );
}
