import { useReducer, useCallback, useState } from 'react';
import type { Api } from '../api';
import type { TreeAction, TreeState } from '../types';

const initialState: TreeState = {
  treeData: [],
  expandedNodes: new Set<string>(),
  treeSelection: new Set<string>(),
  lastTreeClick: null,
};

function treeReducer(state: TreeState, action: TreeAction): TreeState {
  switch (action.type) {
    case 'TOGGLE_NODE': {
      const next = new Set(state.expandedNodes);
      if (next.has(action.key)) next.delete(action.key);
      else next.add(action.key);
      return { ...state, expandedNodes: next };
    }
    case 'SET_SELECTION':
      return { ...state, treeSelection: action.selection };
    case 'CLICK':
      return { ...state, treeSelection: new Set<string>(), lastTreeClick: action.nodeKey };
    case 'SHIFT_SELECT': {
      const a = action.allKeys.indexOf(state.lastTreeClick ?? '');
      const b = action.allKeys.indexOf(action.nodeKey);
      if (a >= 0 && b >= 0) {
        const start = Math.min(a, b);
        const end = Math.max(a, b);
        return { ...state, treeSelection: new Set(action.allKeys.slice(start, end + 1)) };
      }
      return state;
    }
    case 'CLEAR_SELECTION':
      return { ...state, treeSelection: new Set<string>(), lastTreeClick: null };
    case 'REFRESH_TREE':
      return { ...state, treeData: action.data };
    default:
      return state;
  }
}

export function useTree(api: Api | null) {
  const [state, dispatch] = useReducer(treeReducer, initialState);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const fetchTree = useCallback(() => {
    if (!api) return;
    api.getTagTree().then(d => dispatch({ type: 'REFRESH_TREE', data: d.tags })).catch(() => {});
    api.getUndoStatus().then(d => {
      setCanUndo(d.can_undo);
      setCanRedo(d.can_redo);
    }).catch(() => {});
  }, [api]);

  const flattenTreeKeys = useCallback(() => {
    const keys: string[] = [];
    state.treeData.forEach(tag => {
      keys.push('tag:' + tag.name);
      if (state.expandedNodes.has('tag:' + tag.name)) {
        tag.patches.forEach(p => {
          keys.push(`patch:${tag.name}:${p.patch_y},${p.patch_x}`);
          if (state.expandedNodes.has(`patch:${tag.name}:${p.patch_y},${p.patch_x}`)) {
            p.segments.forEach(sid => {
              keys.push(`seg:${p.patch_y},${p.patch_x}:${sid}`);
            });
          }
        });
      }
    });
    return keys;
  }, [state.treeData, state.expandedNodes]);

  const resolveTreeSelection = useCallback((selection: Set<string>) => {
    const resolved = new Set<string>();
    selection.forEach(key => {
      if (key.startsWith('tag:')) {
        const tagName = key.slice(4);
        const tag = state.treeData.find(t => t.name === tagName);
        if (tag) tag.patches.forEach(p => {
          p.segments.forEach(sid => resolved.add(`seg:${p.patch_y},${p.patch_x}:${sid}`));
        });
      } else if (key.startsWith('patch:')) {
        const parts = key.split(':');
        const tName = parts[1]!;
        const coords = parts[2]!.split(',').map(Number);
        const tag = state.treeData.find(t => t.name === tName);
        if (tag) {
          const patch = tag.patches.find(p => p.patch_y === coords[0] && p.patch_x === coords[1]);
          if (patch) patch.segments.forEach(sid => resolved.add(`seg:${coords[0]},${coords[1]}:${sid}`));
        }
      } else {
        resolved.add(key);
      }
    });
    return resolved;
  }, [state.treeData]);

  const handleTreeClick = useCallback((e: React.MouseEvent, nodeKey: string) => {
    if (e.ctrlKey) {
      const next = new Set(state.treeSelection);
      if (next.has(nodeKey)) next.delete(nodeKey);
      else next.add(nodeKey);
      dispatch({ type: 'SET_SELECTION', selection: next });
    } else if (e.shiftKey && state.lastTreeClick) {
      dispatch({ type: 'SHIFT_SELECT', nodeKey, allKeys: flattenTreeKeys() });
    } else {
      dispatch({ type: 'CLICK', nodeKey });
    }
  }, [state.treeSelection, state.lastTreeClick, flattenTreeKeys]);

  return {
    treeData: state.treeData,
    expandedNodes: state.expandedNodes,
    treeSelection: state.treeSelection,
    lastTreeClick: state.lastTreeClick,
    canUndo, canRedo,
    dispatch, fetchTree, flattenTreeKeys, resolveTreeSelection, handleTreeClick,
  };
}
