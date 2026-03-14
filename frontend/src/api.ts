import type {
  ImagePaths, StatusResponse, AlignResponse, SegmentationData,
  ProgressData, StatusData, PatchImageData, MinimapData, SegmentInfo,
  TagColors, TreeData, UndoRedoResponse, UndoStatus,
  LabelRequest, BatchLabelRequest, UntagRequest,
} from './types';

export function createApi(baseUrl: string) {
  async function get<T>(endpoint: string, signal?: AbortSignal): Promise<T> {
    const res = await fetch(`${baseUrl}${endpoint}`, signal ? { signal } : {});
    if (!res.ok) throw new Error(`API ${res.status}: ${endpoint}`);
    return res.json();
  }

  async function post<T>(endpoint: string, data?: unknown): Promise<T> {
    const res = await fetch(`${baseUrl}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: data ? JSON.stringify(data) : undefined,
    });
    if (!res.ok) throw new Error(`API ${res.status}: ${endpoint}`);
    return res.json();
  }

  return {
    // Images
    loadPaths: (paths: ImagePaths) =>
      post<StatusResponse>('/api/load-all-paths', paths),
    alignImages: () =>
      post<AlignResponse>('/api/align-images'),

    // Segmentation
    startSegmentation: () =>
      post<StatusResponse>('/api/start-segmentation'),
    getSegmentation: (py: number, px: number, signal?: AbortSignal) =>
      get<SegmentationData>(`/api/segmentation/${py}/${px}`, signal),
    requestPatchPriority: (py: number, px: number) =>
      post<StatusResponse>(`/api/segment-patch/${py}/${px}`),
    getProgress: () =>
      get<ProgressData>('/api/segmentation-progress'),
    getStatus: () =>
      get<StatusData>('/api/status'),

    // Viewing
    getPatch: (py: number, px: number, imageType: string) =>
      get<PatchImageData>(`/api/patch/${py}/${px}?image_type=${imageType}`),
    getMinimap: (imageType: string) =>
      get<MinimapData>(`/api/minimap?image_type=${imageType}`),
    getSegmentAtPoint: (py: number, px: number, x: number, y: number) =>
      get<SegmentInfo>(`/api/patch-segment-at-point/${py}/${px}?x=${x}&y=${y}`),
    getSelectionMask: (py: number, px: number, ids: number[]) =>
      get<PatchImageData>(`/api/selection-mask/${py}/${px}?ids=${ids.join(',')}`),
    getUntaggedMask: (py: number, px: number) =>
      get<PatchImageData>(`/api/untagged-mask/${py}/${px}`),

    // Tagging
    labelSegment: (req: LabelRequest) =>
      post<StatusResponse>('/api/label-segment', req),
    batchLabel: (req: BatchLabelRequest) =>
      post<StatusResponse>('/api/batch-label', req),
    untagSegments: (req: UntagRequest) =>
      post<StatusResponse>('/api/untag-segments', req),

    // Tag management
    getTags: () =>
      get<TagColors>('/api/tags'),
    getTagTree: () =>
      get<TreeData>('/api/tag-tree'),
    renameTag: (oldName: string, newName: string) =>
      post<StatusResponse>('/api/rename-tag', { old_name: oldName, new_name: newName }),
    recolorTag: (tagName: string, newColor: string) =>
      post<StatusResponse>('/api/recolor-tag', { tag_name: tagName, new_color: newColor }),
    deleteTag: (tagName: string) =>
      post<StatusResponse>('/api/delete-tag', { tag_name: tagName }),

    // Undo/Redo
    undo: () =>
      post<UndoRedoResponse>('/api/undo'),
    redo: () =>
      post<UndoRedoResponse>('/api/redo'),
    getUndoStatus: () =>
      get<UndoStatus>('/api/undo-status'),

    // Export
    saveProject: (outputPath: string) =>
      post<StatusResponse>('/api/save-project', { output_path: outputPath }),
    exportProject: (outputPath: string) =>
      post<StatusResponse>('/api/export', { output_path: outputPath }),
  };
}

export type Api = ReturnType<typeof createApi>;
