import { useState, useCallback } from 'react';
import type { Api } from '../api';
import type { QuickInputState, SelectedSegment } from '../types';
import { tagColor } from '../utils';

export function useTagging(
  api: Api | null,
  selectedSegments: SelectedSegment[],
  setSelectedSegments: (segs: SelectedSegment[]) => void,
  onRefreshTree: () => void,
  onReloadPatch: () => void,
) {
  const [tags, setTags] = useState<Record<string, string>>({});
  const [quickInput, setQuickInput] = useState<QuickInputState | null>(null);
  const [quickFilter, setQuickFilter] = useState('');
  const [quickHighlight, setQuickHighlight] = useState(0);

  const refreshTags = useCallback(() => {
    if (!api) return;
    api.getTags().then(d => setTags(d.tag_colors)).catch(() => {});
  }, [api]);

  const applyTag = useCallback((tagName: string) => {
    if (!tagName.trim() || !api) return;
    const color = tags[tagName] ?? tagColor(tagName);

    if (selectedSegments.length > 0) {
      api.batchLabel({
        tag_name: tagName,
        color,
        segments: selectedSegments.map(s => ({
          patch_y: s.patchY, patch_x: s.patchX, segment_id: s.id,
        })),
      }).then(() => {
        setSelectedSegments([]);
        setQuickInput(null);
        setQuickFilter('');
        onRefreshTree();
        onReloadPatch();
        refreshTags();
      }).catch(() => {});
    } else if (quickInput) {
      api.labelSegment({
        patch_y: quickInput.patchY, patch_x: quickInput.patchX,
        segment_id: quickInput.segmentId, tag: tagName, color,
      }).then(() => {
        setQuickInput(null);
        setQuickFilter('');
        onRefreshTree();
        onReloadPatch();
        refreshTags();
      }).catch(() => {});
    }
  }, [api, quickInput, selectedSegments, tags, onRefreshTree, onReloadPatch, refreshTags, setSelectedSegments]);

  const handleUndo = useCallback(() => {
    if (!api) return;
    api.undo().then(() => {
      onRefreshTree();
      onReloadPatch();
      refreshTags();
    }).catch(() => {});
  }, [api, onRefreshTree, onReloadPatch, refreshTags]);

  const handleRedo = useCallback(() => {
    if (!api) return;
    api.redo().then(() => {
      onRefreshTree();
      onReloadPatch();
      refreshTags();
    }).catch(() => {});
  }, [api, onRefreshTree, onReloadPatch, refreshTags]);

  return {
    tags, quickInput, quickFilter, quickHighlight,
    setQuickInput, setQuickFilter, setQuickHighlight,
    applyTag, handleUndo, handleRedo, refreshTags,
  };
}
