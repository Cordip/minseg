import os
import sys
import json
import asyncio
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from datetime import datetime

import cv2
import numpy as np
from fastapi import FastAPI, UploadFile, File, HTTPException, BackgroundTasks, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel

from aligner import Aligner
from segmentation import full_segmentation, process_mask
from undo import hex_to_bgr, _push_undo, _apply_label, _execute_undo_op, _execute_redo_op

# Create FastAPI app
app = FastAPI(title="Mineral Segmentation API")

# Enable CORS for Electron
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global state
class AppState:
    def __init__(self):
        self.images: Dict[str, np.ndarray] = {}  # ppl45, ppl90, xpl45, xpl90
        self.aligned_images: Dict[str, np.ndarray] = {}
        self.patches: Dict[str, Dict[Tuple[int, int], np.ndarray]] = {}
        self.segmentations: Dict[Tuple[int, int], dict] = {}  # (py, px) -> seg data
        self.labels: Dict[Tuple[int, int], np.ndarray] = {}  # segmentation labels
        self.patch_size: int = 1024
        self.grid_size: Tuple[int, int] = (0, 0)
        self.output_dir: Path = Path("../output")
        self.tag_colors: Dict[str, str] = {}
        self.undo_stack: list = []   # max 200 operations
        self.redo_stack: list = []
        self.segmentation_progress: Dict = {"total": 0, "completed": 0, "current": None}
        self.is_segmenting: bool = False
        self.session_id: str = ""
        self.segment_colors: Dict[Tuple[int, int, int], str] = {}
        self.seg_pending: deque = deque()  # [(py, px), ...] patches queued for segmentation
        self.seg_active: set = set()       # {(py, px), ...} patches currently in ProcessPoolExecutor

state = AppState()
if getattr(sys, 'frozen', False) or "__compiled__" in globals():
    state.output_dir = Path.home() / "MineralSegmentation" / "output"
state.output_dir.mkdir(parents=True, exist_ok=True)



# Pydantic models
class LoadProjectPathsRequest(BaseModel):
    ppl45: str
    ppl90: str
    xpl45: str
    xpl90: str

class SaveLabelRequest(BaseModel):
    patch_y: int
    patch_x: int
    segment_id: int
    tag: str
    color: str

class SaveProjectRequest(BaseModel):
    output_path: str

class RenameTagRequest(BaseModel):
    old_name: str
    new_name: str

class RecolorTagRequest(BaseModel):
    tag_name: str
    new_color: str

class DeleteTagRequest(BaseModel):
    tag_name: str

class BatchLabelSegment(BaseModel):
    patch_y: int
    patch_x: int
    segment_id: int

class BatchLabelRequest(BaseModel):
    tag_name: str
    color: str | None = None
    segments: list[BatchLabelSegment]

class UntagRequest(BaseModel):
    segments: list[BatchLabelSegment]

# Helper functions
def image_to_base64(img: np.ndarray) -> str:
    import base64
    _, buffer = cv2.imencode('.png', img)
    return base64.b64encode(buffer).decode('utf-8')


# API Endpoints
@app.get("/")
async def root():
    return {"status": "ok", "message": "Mineral Segmentation API is running"}

@app.post("/api/undo")
async def undo():
    if not state.undo_stack:
        return {"status": "nothing_to_undo"}
    op = state.undo_stack.pop()
    _execute_undo_op(state, op)
    state.redo_stack.append(op)
    return {
        "status": "success",
        "type": op["type"],
        "description": op.get("description", op["type"]),
        "can_undo": len(state.undo_stack) > 0,
        "can_redo": True,
    }

@app.post("/api/redo")
async def redo():
    if not state.redo_stack:
        return {"status": "nothing_to_redo"}
    op = state.redo_stack.pop()
    _execute_redo_op(state, op)
    state.undo_stack.append(op)
    if len(state.undo_stack) > 200:
        state.undo_stack.pop(0)
    return {
        "status": "success",
        "type": op["type"],
        "description": op.get("description", op["type"]),
        "can_undo": True,
        "can_redo": len(state.redo_stack) > 0,
    }

@app.get("/api/undo-status")
async def undo_status():
    return {
        "can_undo": len(state.undo_stack) > 0,
        "can_redo": len(state.redo_stack) > 0,
        "undo_count": len(state.undo_stack),
        "redo_count": len(state.redo_stack),
    }

@app.post("/api/load-all-paths")
async def load_all_paths(req: LoadProjectPathsRequest):
    try:
        def load_img(path):
            img_arr = np.fromfile(path, np.uint8)
            img = cv2.imdecode(img_arr, cv2.IMREAD_COLOR)
            if img is None: raise ValueError(f"Невозможно прочитать {path}")
            return img

        state.images['ppl45'] = load_img(req.ppl45)
        state.images['ppl90'] = load_img(req.ppl90)
        state.images['xpl45'] = load_img(req.xpl45)
        state.images['xpl90'] = load_img(req.xpl90)
        
        state.session_id = datetime.now().strftime("%Y%m%d_%H%M%S")
        print(f"Images loaded. PPL45 shape: {state.images['ppl45'].shape}")
        return {"status": "success"}
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/align-images")
async def align_images(background_tasks: BackgroundTasks):
    try:
        if not state.images:
            raise HTTPException(status_code=400, detail="No images loaded")
        
        aligner = Aligner()
        
        # Получаем оригиналы
        img_ppl45 = state.images['ppl45']
        img_ppl90 = state.images['ppl90']
        img_xpl45 = state.images['xpl45']
        img_xpl90 = state.images['xpl90']

        img_xpl45 = aligner.align(img_ppl45, img_xpl45)
        img_xpl90 = aligner.align(img_ppl90, img_xpl90)
        # here 45 is aligned with 45 and 90 with 90
        # we need to align 90 with 45 now
        img_xpl90 = aligner.align_as(img_xpl90, img_ppl90, img_ppl45)
        img_ppl90 = aligner.align(img_ppl45, img_ppl90)




        # ЛОГИКА ИЗ ТВОЕГО НОУТБУКА (строго 1 в 1)
        res_xpl45 = img_xpl45
        res_xpl90 = img_xpl90
        res_xpl90 = img_xpl90
        res_ppl90 = img_ppl90

        # Сохраняем выровненные изображения
        state.aligned_images['ppl45'] = img_ppl45.copy()
        state.aligned_images['ppl90'] = res_ppl90
        state.aligned_images['xpl45'] = res_xpl45
        state.aligned_images['xpl90'] = res_xpl90
        
        # Расчет сетки патчей
        h, w = state.aligned_images['ppl45'].shape[:2]
        patch_size = state.patch_size
        rows = (h + patch_size - 1) // patch_size
        cols = (w + patch_size - 1) // patch_size
        state.grid_size = (rows, cols)
        
        state.patches = {name: {} for name in ['ppl45', 'ppl90', 'xpl45', 'xpl90']}
        state.segmentations = {}
        state.labels = {}
        state.segmentation_progress = {"total": rows * cols, "completed": 0, "current": None}
        
        for py in range(rows):
            for px in range(cols):
                y_start, x_start = py * patch_size, px * patch_size
                y_end, x_end = min(y_start + patch_size, h), min(x_start + patch_size, w)
                for name in ['ppl45', 'ppl90', 'xpl45', 'xpl90']:
                    patch = state.aligned_images[name][y_start:y_end, x_start:x_end]
                    if patch.shape[0] < patch_size or patch.shape[1] < patch_size:
                        padded = np.zeros((patch_size, patch_size, 3), dtype=np.uint8)
                        padded[:patch.shape[0], :patch.shape[1]] = patch
                        patch = padded
                    state.patches[name][(py, px)] = patch
                    
        return {
            "status": "success",
            "grid_size": {"rows": rows, "cols": cols},
            "image_size": {"width": w, "height": h}
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

def _store_segmentation_result(py, px, result):
    """Store segmentation result into global state."""
    bounds, colored_segments, labels = result
    cs = (colored_segments * 255).astype(np.uint8) if colored_segments.max() <= 1.0 else colored_segments

    original_colors: dict[int, str] = {}
    seg_count = 0
    for seg_id in np.unique(labels):
        sid = int(seg_id)
        positions = np.argwhere(labels == seg_id)
        row, col = positions[0]
        pixel_bgr = cs[row, col]
        b, g, r = int(pixel_bgr[0]), int(pixel_bgr[1]), int(pixel_bgr[2])
        original_colors[sid] = f"#{r:02x}{g:02x}{b:02x}"
        if sid > 0:
            seg_count += 1

    cs_rgba = np.zeros((cs.shape[0], cs.shape[1], 4), dtype=np.uint8)

    state.segmentations[(py, px)] = {
        'bounds': bounds,
        'colored_segments': cs_rgba,
        'labels': labels,
        'segment_tags': {},
        'original_colors': original_colors,
        'seg_count': seg_count,
        'tagged_count': 0,
    }
    state.labels[(py, px)] = labels
    state.segmentation_progress["completed"] += 1

async def segment_patch_async(py: int, px: int):
    try:
        xpl90 = state.patches['xpl90'].get((py, px))
        xpl45 = state.patches['xpl45'].get((py, px))
        if xpl90 is None or xpl45 is None: return None

        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, lambda: full_segmentation(xpl90, xpl45, thresh=20.0))
        _store_segmentation_result(py, px, result)
        return result
    except Exception as e:
        print(f"Error in segment_patch_async ({py},{px}): {e}")
        return None

def _run_segmentation(xpl90, xpl45, thresh):
    """Run full_segmentation in a worker thread."""
    return full_segmentation(xpl90, xpl45, thresh=thresh)

@app.post("/api/start-segmentation")
async def start_segmentation():
    if state.is_segmenting: return {"status": "already_running"}
    state.is_segmenting = True
    max_workers = min(4, os.cpu_count() or 2)
    rows, cols = state.grid_size
    state.seg_pending = deque(
        (py, px) for py in range(rows) for px in range(cols)
        if (py, px) not in state.segmentations
    )
    state.segmentation_progress["total"] = rows * cols
    state.segmentation_progress["completed"] = len(state.segmentations)

    async def run_seg():
        loop = asyncio.get_event_loop()
        active: dict[tuple, asyncio.Future] = {}

        # ThreadPoolExecutor works in frozen/AppImage builds (no process spawning).
        # numpy/OpenCV/scikit-image release the GIL, so threads get real parallelism.
        pool = ThreadPoolExecutor(max_workers=max_workers)
        try:
            while (state.seg_pending or active) and state.is_segmenting:
                while len(active) < max_workers and state.seg_pending:
                    py, px = state.seg_pending.popleft()
                    if (py, px) in state.segmentations:
                        continue
                    xpl90 = state.patches['xpl90'].get((py, px))
                    xpl45 = state.patches['xpl45'].get((py, px))
                    if xpl90 is None or xpl45 is None:
                        continue
                    state.seg_active.add((py, px))
                    state.segmentation_progress["current"] = (py, px)
                    fut = loop.run_in_executor(pool, _run_segmentation, xpl90, xpl45, 20.0)
                    active[(py, px)] = fut

                if not active:
                    break

                done, _ = await asyncio.wait(
                    active.values(), return_when=asyncio.FIRST_COMPLETED
                )
                for completed_fut in done:
                    patch_key = None
                    for key, fut in active.items():
                        if fut is completed_fut:
                            patch_key = key
                            break
                    if patch_key is None:
                        continue
                    del active[patch_key]
                    state.seg_active.discard(patch_key)
                    try:
                        result = completed_fut.result()
                        _store_segmentation_result(patch_key[0], patch_key[1], result)
                    except Exception as e:
                        print(f"Error in segment batch {patch_key}: {e}")
        except Exception as e:
            print(f"run_seg failed: {e}")
        finally:
            pool.shutdown(wait=False)
            state.is_segmenting = False
            state.seg_active.clear()
            state.segmentation_progress["current"] = None

    asyncio.create_task(run_seg())
    return {"status": "started"}

@app.post("/api/segment-patch/{py}/{px}")
async def segment_single_patch(py: int, px: int):
    if (py, px) in state.segmentations:
        return {"status": "already_ready"}

    if state.is_segmenting:
        if (py, px) in state.seg_active:
            return {"status": "processing"}
        try:
            state.seg_pending.remove((py, px))
        except ValueError:
            pass
        state.seg_pending.appendleft((py, px))
        return {"status": "queued"}

    await segment_patch_async(py, px)
    return {"status": "success"}

@app.get("/api/segmentation-progress")
async def get_segmentation_progress():
    processed = [[py, px] for (py, px) in state.segmentations.keys()]
    current_active = [[py, px] for (py, px) in state.seg_active]
    pending = [[py, px] for (py, px) in state.seg_pending]
    return {
        **state.segmentation_progress,
        "is_running": state.is_segmenting,
        "processed": processed,
        "current_active": current_active,
        "pending": pending,
    }

@app.get("/api/patch/{py}/{px}")
async def get_patch(py: int, px: int, image_type: str = "xpl45"):
    patch = state.patches.get(image_type, {}).get((py, px))
    if patch is None: raise HTTPException(status_code=404)
    return {"image": image_to_base64(patch)}

@app.get("/api/segmentation/{py}/{px}")
async def get_segmentation(py: int, px: int):
    seg_data = state.segmentations.get((py, px))
    if seg_data is None: return {"status": "not_ready"}
    # Cache borders — compute only once
    labels = seg_data['labels']
    if 'borders_cache' not in seg_data:
        borders_img = np.ones((*labels.shape[:2], 3), dtype=np.uint8) * 255
        for dy, dx in [(-1,0),(1,0),(0,-1),(0,1)]:
            shifted = np.roll(np.roll(labels, dy, axis=0), dx, axis=1)
            borders_img[labels != shifted] = [0, 0, 0]
        seg_data['borders_cache'] = image_to_base64(borders_img)
        
    unique_vals = np.unique(labels)
    seg_ids = set(int(s) for s in unique_vals if int(s) > 0)
    total_segs_patch = len(seg_ids)
    tagged_ids = set(int(k) for k in seg_data.get('segment_tags', {}).keys())
    tagged_segs_patch = len(seg_ids & tagged_ids)
    print(f"DEBUG [seg]: patch ({py},{px}) total={total_segs_patch} tagged={tagged_segs_patch} labels_range=[{unique_vals.min()},{unique_vals.max()}] unique_count={len(unique_vals)}")
    
    return {
        "status": "ready",
        "colored_segments": image_to_base64(seg_data['colored_segments']),
        "bounds": image_to_base64(seg_data['bounds']),
        "borders": seg_data['borders_cache'],
        "segment_tags": seg_data.get('segment_tags', {}),
        "total_segs": total_segs_patch,
        "tagged_segs": tagged_segs_patch
    }

@app.get("/api/untagged-mask/{py}/{px}")
async def get_untagged_mask(py: int, px: int):
    seg_data = state.segmentations.get((py, px))
    if seg_data is None: raise HTTPException(status_code=404)
    labels = seg_data['labels']
    tagged_ids = set(seg_data.get('segment_tags', {}).keys())
    # Create red overlay for untagged segments (skip background label 0 and 1)
    mask_img = np.zeros((*labels.shape[:2], 4), dtype=np.uint8)
    for seg_id in np.unique(labels):
        if int(seg_id) <= 1: continue
        if int(seg_id) not in tagged_ids:
            mask_img[labels == seg_id] = [0, 0, 255, 180]  # red with alpha
    return {"image": image_to_base64(mask_img[:,:,:3]), "has_untagged": bool(np.any(mask_img[:,:,3] > 0))}

@app.get("/api/minimap")
async def get_minimap(image_type: str = "xpl45"):
    img = state.aligned_images.get(image_type)
    if img is None: raise HTTPException(status_code=404)
    scale = min(400 / img.shape[1], 1.0)
    minimap = cv2.resize(img, (int(img.shape[1]*scale), int(img.shape[0]*scale)))
    return {"image": image_to_base64(minimap), "scale": scale}

@app.post("/api/label-segment")
async def label_segment(request: SaveLabelRequest):
    seg_data = state.segmentations.get((request.patch_y, request.patch_x))
    if not seg_data: raise HTTPException(status_code=404)
    old_tag = seg_data['segment_tags'].get(request.segment_id)
    old_color = state.tag_colors.get(old_tag) if old_tag else None
    _push_undo(state, {
        "type": "label_segment",
        "patch_y": request.patch_y,
        "patch_x": request.patch_x,
        "segment_id": request.segment_id,
        "old_tag": old_tag,
        "old_color": old_color,
        "new_tag": request.tag,
        "new_color": request.color,
        "description": f"Label segment {request.segment_id} as {request.tag}",
    })
    seg_data['segment_tags'][request.segment_id] = request.tag
    seg_data['tagged_count'] = len(seg_data['segment_tags'])
    state.tag_colors[request.tag] = request.color
    mask = seg_data['labels'] == request.segment_id
    b, g, r = hex_to_bgr(request.color)
    seg_data['colored_segments'][mask] = [b, g, r, 180] # 180 alpha to remove darkening
    state.segment_colors[(request.patch_y, request.patch_x, request.segment_id)] = request.tag
    return {"status": "success"}

@app.get("/api/tags")
async def get_tags():
    return {"tag_colors": state.tag_colors}

@app.get("/api/tag-tree")
async def get_tag_tree():
    tree: dict[str, dict] = {}
    for (py, px), seg_data in state.segmentations.items():
        for sid, tag in seg_data.get('segment_tags', {}).items():
            if tag not in tree:
                tree[tag] = {"name": tag, "color": state.tag_colors.get(tag, "#888888"), "total_segments": 0, "patches": {}}
            node = tree[tag]
            patch_key = (py, px)
            if patch_key not in node["patches"]:
                node["patches"][patch_key] = {"patch_y": py, "patch_x": px, "count": 0, "segments": []}
            node["patches"][patch_key]["segments"].append(int(sid))
            node["patches"][patch_key]["count"] += 1
            node["total_segments"] += 1
    tags = []
    for tag_data in sorted(tree.values(), key=lambda t: t["name"]):
        tag_data["patches"] = sorted(tag_data["patches"].values(), key=lambda p: (p["patch_y"], p["patch_x"]))
        tags.append(tag_data)
    return {"tags": tags}

@app.post("/api/batch-label")
async def batch_label(request: BatchLabelRequest):
    color = request.color or state.tag_colors.get(request.tag_name, "#888888")
    entries = []
    for seg in request.segments:
        seg_data = state.segmentations.get((seg.patch_y, seg.patch_x))
        if not seg_data:
            continue
        old_tag = seg_data['segment_tags'].get(seg.segment_id)
        old_color = state.tag_colors.get(old_tag) if old_tag else None
        entries.append({
            "patch_y": seg.patch_y, "patch_x": seg.patch_x,
            "segment_id": seg.segment_id,
            "old_tag": old_tag, "old_color": old_color,
        })
    _push_undo(state, {
        "type": "batch_label",
        "new_tag": request.tag_name, "color": color,
        "entries": entries,
        "description": f"batch tag {len(entries)} segments as {request.tag_name}",
    })
    state.tag_colors[request.tag_name] = color
    b, g, r = hex_to_bgr(color)
    for seg in request.segments:
        seg_data = state.segmentations.get((seg.patch_y, seg.patch_x))
        if not seg_data:
            continue
        seg_data['segment_tags'][seg.segment_id] = request.tag_name
        mask = seg_data['labels'] == seg.segment_id
        seg_data['colored_segments'][mask] = [b, g, r, 180]
        state.segment_colors[(seg.patch_y, seg.patch_x, seg.segment_id)] = request.tag_name
        seg_data['tagged_count'] = len(seg_data['segment_tags'])
    return {"status": "success"}

@app.post("/api/untag-segments")
async def untag_segments(request: UntagRequest):
    entries = []
    for seg in request.segments:
        seg_data = state.segmentations.get((seg.patch_y, seg.patch_x))
        if not seg_data:
            continue
        old_tag = seg_data['segment_tags'].get(seg.segment_id)
        old_color = state.tag_colors.get(old_tag) if old_tag else None
        if old_tag:
            entries.append({
                "patch_y": seg.patch_y, "patch_x": seg.patch_x,
                "segment_id": seg.segment_id,
                "old_tag": old_tag, "old_color": old_color,
            })
    if not entries:
        return {"status": "nothing_to_untag"}
    _push_undo(state, {
        "type": "batch_label",
        "new_tag": None, "color": None,
        "entries": entries,
        "description": f"untag {len(entries)} segments",
    })
    for seg in request.segments:
        _apply_label(state, seg.patch_y, seg.patch_x, seg.segment_id, None, None)
    return {"status": "success"}

@app.post("/api/rename-tag")
async def rename_tag(request: RenameTagRequest):
    if request.new_name in state.tag_colors and request.new_name != request.old_name:
        raise HTTPException(status_code=400, detail="Tag name already exists")
    _push_undo(state, {
        "type": "rename_tag",
        "old_name": request.old_name,
        "new_name": request.new_name,
        "description": f"Rename tag {request.old_name} to {request.new_name}",
    })
    color = state.tag_colors.pop(request.old_name, None)
    if color:
        state.tag_colors[request.new_name] = color
    for (py, px), seg_data in state.segmentations.items():
        seg_tags = seg_data.get('segment_tags', {})
        for sid, tag in list(seg_tags.items()):
            if tag == request.old_name:
                seg_tags[sid] = request.new_name
    for key, tag in list(state.segment_colors.items()):
        if tag == request.old_name:
            state.segment_colors[key] = request.new_name
    return {"status": "success"}

@app.post("/api/recolor-tag")
async def recolor_tag(request: RecolorTagRequest):
    old_color = state.tag_colors.get(request.tag_name, '#888888')
    _push_undo(state, {
        "type": "recolor_tag",
        "tag_name": request.tag_name,
        "old_color": old_color,
        "new_color": request.new_color,
        "description": f"Recolor tag {request.tag_name}",
    })
    state.tag_colors[request.tag_name] = request.new_color
    b, g, r = hex_to_bgr(request.new_color)
    for (py, px), seg_data in state.segmentations.items():
        seg_tags = seg_data.get('segment_tags', {})
        labels = seg_data.get('labels')
        cs = seg_data.get('colored_segments')
        if labels is None or cs is None:
            continue
        for sid_str, tag in seg_tags.items():
            if tag == request.tag_name:
                mask = labels == int(sid_str)
                cs[mask] = [b, g, r, 180]
    return {"status": "success"}

@app.post("/api/delete-tag")
async def delete_tag(request: DeleteTagRequest):
    tag_color = state.tag_colors.get(request.tag_name, '#888888')
    segments_snapshot = []
    for (py, px), seg_data in state.segmentations.items():
        seg_tags = seg_data.get('segment_tags', {})
        for sid, tag in seg_tags.items():
            if tag == request.tag_name:
                segments_snapshot.append({"patch_y": py, "patch_x": px, "segment_id": sid})
    _push_undo(state, {
        "type": "delete_tag",
        "tag_name": request.tag_name,
        "tag_color": tag_color,
        "segments": segments_snapshot,
        "description": f"Delete tag {request.tag_name}",
    })
    state.tag_colors.pop(request.tag_name, None)
    for (py, px), seg_data in state.segmentations.items():
        seg_tags = seg_data.get('segment_tags', {})
        labels = seg_data.get('labels')
        cs = seg_data.get('colored_segments')
        for sid_str, tag in list(seg_tags.items()):
            if tag == request.tag_name:
                del seg_tags[sid_str]
                if labels is not None and cs is not None:
                    mask = labels == int(sid_str)
                    cs[mask] = [0, 0, 0, 0]
        seg_data['tagged_count'] = len(seg_tags)
    for key, tag in list(state.segment_colors.items()):
        if tag == request.tag_name:
            del state.segment_colors[key]
    return {"status": "success"}

@app.get("/api/tag-locations/{tag_name}")
async def get_tag_locations(tag_name: str, image_type: str = "xpl45"):
    locations = []
    for (py, px), seg_data in state.segmentations.items():
        seg_tags = seg_data.get('segment_tags', {})
        labels = seg_data.get('labels')
        matching = []
        for sid_str, tag in seg_tags.items():
            if tag == tag_name:
                sid = int(sid_str)
                positions = np.argwhere(labels == sid)
                if len(positions) == 0:
                    continue
                y_min, x_min = positions.min(axis=0).tolist()
                y_max, x_max = positions.max(axis=0).tolist()
                matching.append({
                    "id": sid,
                    "bounds": {
                        "x_min": x_min, "y_min": y_min,
                        "x_max": x_max, "y_max": y_max,
                        "cx": (x_min + x_max) // 2,
                        "cy": (y_min + y_max) // 2
                    }
                })
        if matching:
            locations.append({
                "patch_y": py, "patch_x": px,
                "segments": matching,
                "count": len(matching)
            })
    return {"locations": locations}

@app.get("/api/patch-thumbnail/{py}/{px}")
async def get_patch_thumbnail(py: int, px: int, image_type: str = "xpl45"):
    patch = state.patches.get(image_type, {}).get((py, px))
    if patch is None:
        raise HTTPException(status_code=404)
    thumb = cv2.resize(patch, (128, 128))
    return Response(content=cv2.imencode('.jpg', thumb)[1].tobytes(), media_type="image/jpeg")

@app.get("/api/patch-tag-preview/{py}/{px}/{tag_name}")
async def get_patch_tag_preview(py: int, px: int, tag_name: str, image_type: str = "xpl45"):
    patch = state.patches.get(image_type, {}).get((py, px))
    seg_data = state.segmentations.get((py, px))
    if patch is None or seg_data is None:
        raise HTTPException(status_code=404)
    labels = seg_data['labels']
    seg_tags = seg_data.get('segment_tags', {})
    tag_mask = np.zeros(labels.shape[:2], dtype=bool)
    for sid_str, tag in seg_tags.items():
        if tag == tag_name:
            tag_mask |= (labels == int(sid_str))
    img = patch.copy().astype(np.float32)
    img[~tag_mask] *= 0.4
    color_hex = state.tag_colors.get(tag_name, "#ffffff")
    b, g, r = hex_to_bgr(color_hex)
    overlay = np.zeros_like(img)
    overlay[tag_mask] = [b, g, r]
    img[tag_mask] = img[tag_mask] * 0.6 + overlay[tag_mask] * 0.4
    img = np.clip(img, 0, 255).astype(np.uint8)
    thumb = cv2.resize(img, (128, 128))
    return Response(content=cv2.imencode('.jpg', thumb)[1].tobytes(), media_type="image/jpeg")

@app.get("/api/segment-preview/{py}/{px}/{segment_id}")
async def get_segment_preview(py: int, px: int, segment_id: int, image_type: str = "xpl45"):
    patch = state.patches.get(image_type, {}).get((py, px))
    seg_data = state.segmentations.get((py, px))
    if patch is None or seg_data is None:
        raise HTTPException(status_code=404)
    labels = seg_data['labels']
    mask = labels == segment_id
    positions = np.argwhere(mask)
    if len(positions) == 0:
        raise HTTPException(status_code=404)
    y_min, x_min = positions.min(axis=0)
    y_max, x_max = positions.max(axis=0)
    h, w = y_max - y_min, x_max - x_min
    pad = max(16, int(max(h, w) * 0.2))
    y0 = max(0, y_min - pad)
    x0 = max(0, x_min - pad)
    y1 = min(patch.shape[0], y_max + pad)
    x1 = min(patch.shape[1], x_max + pad)
    crop = patch[y0:y1, x0:x1].copy().astype(np.float32)
    crop_mask = mask[y0:y1, x0:x1]
    crop[~crop_mask] *= 0.4
    seg_tags = seg_data.get('segment_tags', {})
    tag = seg_tags.get(segment_id, seg_tags.get(str(segment_id)))
    color_hex = state.tag_colors.get(tag, "#ffffff") if tag else "#ffffff"
    b, g, r = hex_to_bgr(color_hex)
    overlay = np.zeros_like(crop)
    overlay[crop_mask] = [b, g, r]
    crop[crop_mask] = crop[crop_mask] * 0.6 + overlay[crop_mask] * 0.4
    crop = np.clip(crop, 0, 255).astype(np.uint8)
    ch, cw = crop.shape[:2]
    scale = 96 / max(ch, cw)
    thumb = cv2.resize(crop, (max(1, int(cw * scale)), max(1, int(ch * scale))))
    return Response(content=cv2.imencode('.jpg', thumb)[1].tobytes(), media_type="image/jpeg")

@app.get("/api/selection-mask/{py}/{px}")
async def get_selection_mask(py: int, px: int, ids: str = ""):
    seg_data = state.segmentations.get((py, px))
    if not seg_data:
        raise HTTPException(status_code=404)
    labels = seg_data['labels']
    id_list = [int(x) for x in ids.split(',') if x.strip()]
    mask = np.zeros(labels.shape[:2], dtype=bool)
    for sid in id_list:
        mask |= (labels == sid)
    rgba = np.zeros((*labels.shape[:2], 4), dtype=np.uint8)
    rgba[mask] = [255, 255, 255, 255]
    return {"image": image_to_base64(rgba)}

@app.get("/api/status")
async def get_status():
    total_segs = sum(seg.get('seg_count', 0) for seg in state.segmentations.values())
    tagged_segs = sum(seg.get('tagged_count', 0) for seg in state.segmentations.values())
    print(f"DEBUG [status]: total_patches={len(state.segmentations)} total_segs={total_segs} tagged_segs={tagged_segs}")
    return {
        "images_loaded": len(state.images) > 0,
        "images_aligned": len(state.aligned_images) > 0,
        "grid_size": {"rows": state.grid_size[0], "cols": state.grid_size[1]},
        "segmented_patches": len(state.segmentations),
        "total_patches": state.grid_size[0] * state.grid_size[1],
        "is_segmenting": state.is_segmenting,
        "total_segments": total_segs,
        "tagged_segments": tagged_segs,
        "untagged_segments": total_segs - tagged_segs
    }

@app.get("/api/patch-segment-at-point/{py}/{px}")
async def get_segment_at_point(py: int, px: int, x: int, y: int):
    seg_data = state.segmentations.get((py, px))
    if not seg_data: return {"status": "not_ready"}
    if y >= seg_data['labels'].shape[0] or x >= seg_data['labels'].shape[1]:
        raise HTTPException(status_code=400)
    segment_id = int(seg_data['labels'][y, x])
    return {
        "status": "success",
        "segment_id": segment_id,
        "tag": seg_data['segment_tags'].get(segment_id),
        "color": state.tag_colors.get(seg_data['segment_tags'].get(segment_id, ""))
    }

@app.get("/api/segment-color/{py}/{px}/{segment_id}")
async def get_segment_color(py: int, px: int, segment_id: int):
    seg_data = state.segmentations.get((py, px))
    if not seg_data:
        raise HTTPException(status_code=404, detail="Patch not ready")
    color = seg_data.get('original_colors', {}).get(segment_id)
    if color is None:
        raise HTTPException(status_code=400, detail="Segment ID not found")
    return {"color": color}

@app.post("/api/save-project")
async def save_project(request: SaveProjectRequest):
    out = Path(request.output_path)
    out.mkdir(parents=True, exist_ok=True)
    with open(out / "tags.json", "w", encoding="utf-8") as f:
        json.dump({"tag_colors": state.tag_colors, "session": state.session_id}, f, indent=2)
    for t in ['ppl45', 'ppl90', 'xpl45', 'xpl90']:
        if t in state.aligned_images:
            cv2.imwrite(str(out / f"{t}_aligned.png"), state.aligned_images[t])
    return {"status": "success"}

@app.post("/api/export")
async def export_project(request: SaveProjectRequest):
    out = Path(request.output_path)
    rows, cols = state.grid_size

    # Create all 5 subdirectories
    for folder in ['xpl45', 'xpl90', 'ppl45', 'ppl90', 'segments']:
        (out / folder).mkdir(parents=True, exist_ok=True)

    # Save raw image patches (all 4 polarization types)
    for name in ['xpl45', 'xpl90', 'ppl45', 'ppl90']:
        patch_dict = state.patches.get(name, {})
        for py in range(rows):
            for px in range(cols):
                patch = patch_dict.get((py, px))
                if patch is not None:
                    fname = f"patch_{py:03d}_{px:03d}.png"
                    cv2.imwrite(str(out / name / fname), patch)

    # Save colored segment patches (only where segmentation has run)
    for py in range(rows):
        for px in range(cols):
            seg_data = state.segmentations.get((py, px))
            if seg_data is None:
                continue  # skip unprocessed patches
            fname = f"patch_{py:03d}_{px:03d}.png"
            cv2.imwrite(str(out / 'segments' / fname), seg_data['colored_segments'])

    # Save tags.json — flat {tag_name: color_hex}
    with open(out / "tags.json", "w", encoding="utf-8") as f:
        json.dump(state.tag_colors, f, indent=2, ensure_ascii=False)

    return {"status": "success"}

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", "8001"))
    uvicorn.run(app, host="127.0.0.1", port=port)