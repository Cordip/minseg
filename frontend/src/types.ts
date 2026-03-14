// Image paths for loading
export interface ImagePaths {
  ppl45: string;
  ppl90: string;
  xpl45: string;
  xpl90: string;
}

// API responses
export interface StatusResponse {
  status: string;
  message?: string;
}

export interface AlignResponse {
  status: string;
  grid_size: { rows: number; cols: number };
  image_size: { width: number; height: number };
}

export interface SegmentationData {
  status: string;
  colored_segments?: string; // base64
  bounds?: string; // base64
  borders?: string; // base64
  segment_tags?: Record<number, string>;
  total_segs?: number;
  tagged_segs?: number;
}

export interface ProgressData {
  total: number;
  completed: number;
  is_running: boolean;
  processed: number[][];
  current_active: number[][];
  pending: number[][];
}

export interface StatusData {
  images_loaded: boolean;
  images_aligned: boolean;
  grid_size: { rows: number; cols: number };
  segmented_patches: number;
  total_patches: number;
  is_segmenting: boolean;
  total_segments: number;
  tagged_segments: number;
  untagged_segments: number;
}

export interface PatchImageData {
  image: string; // base64
}

export interface MinimapData {
  image: string; // base64
  scale: number;
}

export interface SegmentInfo {
  status: string;
  segment_id: number;
  tag: string | null;
  color: string | null;
}

export interface TagColors {
  tag_colors: Record<string, string>;
}

export interface TreeTag {
  name: string;
  color: string;
  total_segments: number;
  patches: TreePatch[];
}

export interface TreePatch {
  patch_y: number;
  patch_x: number;
  count: number;
  segments: number[];
}

export interface TreeData {
  tags: TreeTag[];
}

export interface UndoRedoResponse {
  status: string;
  type?: string;
  description?: string;
  can_undo: boolean;
  can_redo: boolean;
}

export interface UndoStatus {
  can_undo: boolean;
  can_redo: boolean;
  undo_count: number;
  redo_count: number;
}

// Request types
export interface LabelRequest {
  patch_y: number;
  patch_x: number;
  segment_id: number;
  tag: string;
  color: string;
}

export interface BatchLabelRequest {
  tag_name: string;
  color: string | null;
  segments: Array<{ patch_y: number; patch_x: number; segment_id: number }>;
}

export interface UntagRequest {
  segments: Array<{ patch_y: number; patch_x: number; segment_id: number }>;
}

// App state types
export type PatchState = 'processed' | 'active' | 'pending';

export interface PatchCoord {
  y: number;
  x: number;
}

export interface SelectedSegment {
  id: number;
  patchY: number;
  patchX: number;
}
