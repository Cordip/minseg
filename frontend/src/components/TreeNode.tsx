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

function TreeNodeInner({ treeData, expandedNodes, treeSelection, onToggleNode, onTreeClick, onNavigate, onContextMenu }: Props) {
  return (
    <div className="tags-list">
      {treeData.map(tag => (
        <div key={tag.name}>
          <div className={`tree-node tree-level-1${treeSelection.has('tag:' + tag.name) ? ' selected' : ''}`}
            onContextMenu={e => { e.preventDefault(); onContextMenu({ x: e.clientX, y: e.clientY, tagName: tag.name, tagColor: tag.color, level: 'tag' }); }}
            onClick={e => { if (e.ctrlKey || e.shiftKey) { onTreeClick(e, 'tag:' + tag.name); return; } onToggleNode('tag:' + tag.name); }}>
            <span className="tree-node-arrow" onClick={e => { e.stopPropagation(); onToggleNode('tag:' + tag.name); }}>
              {expandedNodes.has('tag:' + tag.name) ? '▼' : '▶'}
            </span>
            <span className="tree-node-color" style={{ backgroundColor: tag.color }} />
            <span className="tree-node-label">{tag.name}</span>
            <span className="tree-node-count">{tag.total_segments}</span>
          </div>
          {expandedNodes.has('tag:' + tag.name) && tag.patches.map(patch => {
            const patchKey = `patch:${tag.name}:${patch.patch_y},${patch.patch_x}`;
            return (
              <div key={patchKey}>
                <div className="tree-node tree-level-2"
                  onClick={e => { if (e.ctrlKey || e.shiftKey) { onTreeClick(e, patchKey); return; } onNavigate({ y: patch.patch_y, x: patch.patch_x }); }}
                  onContextMenu={e => { e.preventDefault(); onContextMenu({ x: e.clientX, y: e.clientY, tagName: tag.name, tagColor: tag.color, level: 'patch', patchY: patch.patch_y, patchX: patch.patch_x }); }}>
                  <span className="tree-node-arrow" onClick={e => { e.stopPropagation(); onToggleNode(patchKey); }}>
                    {expandedNodes.has(patchKey) ? '▼' : '▶'}
                  </span>
                  <span className="tree-node-label">Патч {patch.patch_y},{patch.patch_x}</span>
                  <span className="tree-node-count">{patch.count}</span>
                </div>
                {expandedNodes.has(patchKey) && patch.segments.map(sid => {
                  const segKey = `seg:${patch.patch_y},${patch.patch_x}:${sid}`;
                  return (
                    <div key={sid} className={`tree-node tree-level-3${treeSelection.has(segKey) ? ' selected' : ''}`}
                      onClick={e => { if (e.ctrlKey || e.shiftKey) { onTreeClick(e, segKey); return; } onNavigate({ y: patch.patch_y, x: patch.patch_x }); }}
                      onContextMenu={e => { e.preventDefault(); onContextMenu({ x: e.clientX, y: e.clientY, tagName: tag.name, tagColor: tag.color, level: 'segment', patchY: patch.patch_y, patchX: patch.patch_x, segmentId: sid }); }}>
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
