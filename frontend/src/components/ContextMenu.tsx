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

const itemStyle: React.CSSProperties = {
  padding: '8px 16px', cursor: 'pointer', fontSize: 13, color: '#ddd',
  display: 'flex', alignItems: 'center', gap: 8,
};

function MenuItem({ onClick, style, children }: {
  onClick: () => void; style?: React.CSSProperties; children: React.ReactNode;
}) {
  return (
    <div style={{ ...itemStyle, ...style }}
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

  const submitRename = () => {
    if (!renameValue || !renameValue.trim() || renameValue.trim() === menu.tagName) { setRenameValue(null); return; }
    api.renameTag(menu.tagName, renameValue.trim()).then(() => { onRefresh(); onClose(); }).catch(() => {});
  };

  const handleRecolor = () => {
    const input = document.createElement('input');
    input.type = 'color'; input.value = menu.tagColor;
    input.style.position = 'fixed'; input.style.opacity = '0';
    document.body.appendChild(input);
    input.onchange = () => {
      api.recolorTag(menu.tagName, input.value).then(() => onRefresh()).catch(() => {});
      document.body.removeChild(input); onClose();
    };
    input.addEventListener('cancel', () => document.body.removeChild(input));
    onClose(); input.click();
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
    onSelectSegments(segs); onClose();
  };

  const handleDelete = () => {
    if (treeSelection.size > 0) {
      const resolved = resolveTreeSelection(treeSelection);
      setDeleteConfirm({ tagName: 'selected', count: resolved.size, resolved });
    } else if (menu.level === 'tag') {
      const tag = treeData.find(t => t.name === menu.tagName);
      setDeleteConfirm({ tagName: menu.tagName, count: tag?.total_segments ?? 0, level: 'tag' });
    } else {
      setDeleteConfirm({ tagName: menu.tagName, count: 1, level: menu.level, patchY: menu.patchY, patchX: menu.patchX, segmentId: menu.segmentId });
    }
  };

  const confirmDelete = () => {
    if (!deleteConfirm) return;
    if (deleteConfirm.resolved) {
      const segs: Array<{ patch_y: number; patch_x: number; segment_id: number }> = [];
      deleteConfirm.resolved.forEach(key => {
        const parts = key.split(':');
        const coords = parts[1]!.split(',').map(Number);
        segs.push({ patch_y: coords[0]!, patch_x: coords[1]!, segment_id: parseInt(parts[2]!) });
      });
      api.untagSegments({ segments: segs }).then(() => { onRefresh(); onClose(); }).catch(() => {});
    } else if (deleteConfirm.level === 'tag') {
      api.deleteTag(deleteConfirm.tagName).then(() => { onRefresh(); onClose(); }).catch(() => {});
    } else {
      api.untagSegments({ segments: [{ patch_y: deleteConfirm.patchY!, patch_x: deleteConfirm.patchX!, segment_id: deleteConfirm.segmentId! }] })
        .then(() => { onRefresh(); onClose(); }).catch(() => {});
    }
  };

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999 }}
      onClick={() => { onClose(); setDeleteConfirm(null); }}
      onContextMenu={e => { e.preventDefault(); onClose(); }}>
      <div style={{
        position: 'fixed', left: menu.x, top: menu.y,
        background: '#1e1e2e', border: '1px solid #444', borderRadius: 6,
        boxShadow: '0 4px 16px rgba(0,0,0,0.5)', padding: '4px 0', minWidth: 180, zIndex: 10000,
      }} onClick={e => e.stopPropagation()}>
        {treeSelection.size > 0 && (
          <div style={{ padding: '6px 16px', fontSize: 11, color: '#888', borderBottom: '1px solid #333' }}>
            Выбрано: {treeSelection.size} ({resolveTreeSelection(treeSelection).size} {pluralSeg(resolveTreeSelection(treeSelection).size)})
          </div>
        )}
        {renameValue !== null ? (
          <div style={{ padding: '8px 16px' }}>
            <input autoFocus value={renameValue} onChange={e => setRenameValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submitRename(); if (e.key === 'Escape') setRenameValue(null); }}
              style={{ width: '100%', background: '#16213e', border: '1px solid #4a9eff', borderRadius: 4, padding: '4px 8px', color: '#eaeaea', fontSize: 13, outline: 'none' }} />
          </div>
        ) : (
          <>
            {menu.level === 'tag' && treeSelection.size === 0 && (
              <MenuItem onClick={() => setRenameValue(menu.tagName)}>Переименовать</MenuItem>
            )}
            {treeSelection.size > 0 && (
              <MenuItem onClick={handleSelectForTag}>Назначить тег</MenuItem>
            )}
            <MenuItem onClick={handleRecolor}>Сменить цвет</MenuItem>
            {(menu.level === 'patch' || menu.level === 'segment') && (
              <MenuItem onClick={() => { onNavigate({ y: menu.patchY!, x: menu.patchX! }); onClose(); }}>Перейти</MenuItem>
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
                  <button className="btn" style={{ background: '#ff4444', color: '#fff', padding: '4px 12px', border: 'none', borderRadius: 4, cursor: 'pointer' }} onClick={confirmDelete}>Удалить</button>
                  <button className="btn btn-secondary" style={{ padding: '4px 12px' }} onClick={() => setDeleteConfirm(null)}>Отмена</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
