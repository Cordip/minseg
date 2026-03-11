"""
FastAPI Backend for Mineral Segmentation Application
Provides API endpoints for image processing and segmentation
"""
import os
import json
import asyncio
import uuid
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from datetime import datetime

import cv2
import numpy as np
from fastapi import FastAPI, UploadFile, File, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from aligner import Aligner
from segmentation import full_segmentation, segment_patch, process_mask
import aiofiles

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
        self.grid_size: Tuple[int, int] = (0, 0)  # (rows, cols)
        self.output_dir: Path = Path("../output")
        self.color_tags: Dict[str, str] = {}  # color_hex -> tag_name
        self.tag_colors: Dict[str, str] = {}  # tag_name -> color_hex
        self.segmentation_progress: Dict = {"total": 0, "completed": 0, "current": None}
        self.is_segmenting: bool = False
        self.session_id: str = ""
        self.segment_colors: Dict[Tuple[int, int, int], str] = {}  # (py, px, segment_id) -> tag

state = AppState()

# Ensure output directory exists
state.output_dir.mkdir(parents=True, exist_ok=True)


# Pydantic models
class LoadImagesRequest(BaseModel):
    ppl45_path: str
    ppl90_path: str
    xpl45_path: str
    xpl90_path: str


class SaveLabelRequest(BaseModel):
    patch_y: int
    patch_x: int
    segment_id: int
    tag: str
    color: str


class SaveProjectRequest(BaseModel):
    output_path: str


class SetTagColorRequest(BaseModel):
    tag: str
    color: str


# Helper functions
def image_to_base64(img: np.ndarray) -> str:
    """Convert numpy image to base64 string."""
    import base64
    _, buffer = cv2.imencode('.png', cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
    return base64.b64encode(buffer).decode('utf-8')


def base64_to_image(b64: str) -> np.ndarray:
    """Convert base64 string to numpy image."""
    import base64
    img_bytes = base64.b64decode(b64)
    nparr = np.frombuffer(img_bytes, np.uint8)
    return cv2.imdecode(nparr, cv2.IMREAD_COLOR)


def generate_color() -> str:
    """Generate a random distinct color in hex format."""
    import colorsys
    hue = np.random.random()
    saturation = 0.6 + np.random.random() * 0.4
    value = 0.7 + np.random.random() * 0.3
    rgb = colorsys.hsv_to_rgb(hue, saturation, value)
    return '#{:02x}{:02x}{:02x}'.format(int(rgb[0]*255), int(rgb[1]*255), int(rgb[2]*255))


def hex_to_bgr(hex_color: str) -> Tuple[int, int, int]:
    """Convert hex color to BGR tuple."""
    hex_color = hex_color.lstrip('#')
    r = int(hex_color[0:2], 16)
    g = int(hex_color[2:4], 16)
    b = int(hex_color[4:6], 16)
    return (b, g, r)


def bgr_to_hex(bgr: Tuple[int, int, int]) -> str:
    """Convert BGR tuple to hex color."""
    b, g, r = bgr
    return '#{:02x}{:02x}{:02x}'.format(r, g, b)


# API Endpoints
@app.get("/")
async def root():
    return {"status": "ok", "message": "Mineral Segmentation API is running"}


@app.post("/api/load-images")
async def load_images(
    ppl45: UploadFile = File(...),
    ppl90: UploadFile = File(...),
    xpl45: UploadFile = File(...),
    xpl90: UploadFile = File(...)
):
    """Load and align images from uploaded files."""
    try:
        # Read images
        def read_upload(f):
            contents = asyncio.run(f.read())
            nparr = np.frombuffer(contents, np.uint8)
            return cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        # Read all images
        ppl45_bytes = await ppl45.read()
        ppl90_bytes = await ppl90.read()
        xpl45_bytes = await xpl45.read()
        xpl90_bytes = await xpl90.read()
        
        state.images['ppl45'] = cv2.imdecode(np.frombuffer(ppl45_bytes, np.uint8), cv2.IMREAD_COLOR)
        state.images['ppl90'] = cv2.imdecode(np.frombuffer(ppl90_bytes, np.uint8), cv2.IMREAD_COLOR)
        state.images['xpl45'] = cv2.imdecode(np.frombuffer(xpl45_bytes, np.uint8), cv2.IMREAD_COLOR)
        state.images['xpl90'] = cv2.imdecode(np.frombuffer(xpl90_bytes, np.uint8), cv2.IMREAD_COLOR)
        
        # Validate all images loaded
        for name, img in state.images.items():
            if img is None:
                raise HTTPException(status_code=400, detail=f"Failed to load {name}")
        
        # Generate session ID
        state.session_id = datetime.now().strftime("%Y%m%d_%H%M%S")
        
        return {"status": "success", "message": "Images loaded successfully"}
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/align-images")
async def align_images(background_tasks: BackgroundTasks):
    """Align all loaded images to ppl45 reference."""
    try:
        if not state.images:
            raise HTTPException(status_code=400, detail="No images loaded")
        
        aligner = Aligner()
        
        # ppl45 is the reference image - stays as is
        state.aligned_images['ppl45'] = state.images['ppl45'].copy()
        
        # Align all other images directly to ppl45
        # This ensures all images are in the same coordinate system
        
        # Align xpl45 to ppl45
        print("Aligning xpl45 to ppl45...")
        state.aligned_images['xpl45'] = aligner.align(state.images['ppl45'], state.images['xpl45'])
        
        # Align ppl90 to ppl45
        print("Aligning ppl90 to ppl45...")
        state.aligned_images['ppl90'] = aligner.align(state.images['ppl45'], state.images['ppl90'])
        
        # Align xpl90 to ppl45
        print("Aligning xpl90 to ppl45...")
        state.aligned_images['xpl90'] = aligner.align(state.images['ppl45'], state.images['xpl90'])
        
        print("Alignment complete!")
        
        # Calculate grid size
        h, w = state.aligned_images['ppl45'].shape[:2]
        patch_size = state.patch_size
        
        rows = (h + patch_size - 1) // patch_size
        cols = (w + patch_size - 1) // patch_size
        state.grid_size = (rows, cols)
        
        # Initialize patches dictionaries
        state.patches = {name: {} for name in ['ppl45', 'ppl90', 'xpl45', 'xpl90']}
        state.segmentations = {}
        state.labels = {}
        state.segmentation_progress = {"total": rows * cols, "completed": 0, "current": None}
        
        # Create patches
        for py in range(rows):
            for px in range(cols):
                y_start = py * patch_size
                x_start = px * patch_size
                y_end = min(y_start + patch_size, h)
                x_end = min(x_start + patch_size, w)
                
                for name in ['ppl45', 'ppl90', 'xpl45', 'xpl90']:
                    patch = state.aligned_images[name][y_start:y_end, x_start:x_end]
                    # Pad if necessary
                    if patch.shape[0] < patch_size or patch.shape[1] < patch_size:
                        padded = np.zeros((patch_size, patch_size, 3), dtype=np.uint8)
                        padded[:patch.shape[0], :patch.shape[1]] = patch
                        patch = padded
                    state.patches[name][(py, px)] = patch
        
        return {
            "status": "success",
            "grid_size": {"rows": rows, "cols": cols},
            "image_size": {"width": w, "height": h},
            "patch_size": patch_size
        }
    
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


async def segment_patch_async(py: int, px: int):
    """Segment a single patch asynchronously."""
    try:
        xpl90 = state.patches['xpl90'].get((py, px))
        xpl45 = state.patches['xpl45'].get((py, px))
        
        if xpl90 is None or xpl45 is None:
            return None
        
        # Run segmentation (this is CPU-bound, so we run in executor)
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None, 
            lambda: full_segmentation(xpl90, xpl45, thresh=20.0)
        )
        
        bounds, colored_segments, labels = result
        
        # Store results
        state.segmentations[(py, px)] = {
            'bounds': bounds,
            'colored_segments': colored_segments,
            'labels': labels,
            'segment_tags': {}  # segment_id -> tag
        }
        state.labels[(py, px)] = labels
        
        # Update progress
        state.segmentation_progress["completed"] += 1
        state.segmentation_progress["current"] = (py, px)
        
        return result
    
    except Exception as e:
        print(f"Error segmenting patch ({py}, {px}): {e}")
        return None


@app.post("/api/start-segmentation")
async def start_segmentation(background_tasks: BackgroundTasks):
    """Start background segmentation of all patches."""
    if state.is_segmenting:
        return {"status": "already_running"}
    
    state.is_segmenting = True
    state.segmentation_progress["completed"] = 0
    
    async def run_segmentation():
        rows, cols = state.grid_size
        for py in range(rows):
            for px in range(cols):
                state.segmentation_progress["current"] = (py, px)
                await segment_patch_async(py, px)
        state.is_segmenting = False
    
    background_tasks.add_task(run_segmentation)
    
    return {"status": "started", "total_patches": state.grid_size[0] * state.grid_size[1]}


@app.get("/api/segmentation-progress")
async def get_segmentation_progress():
    """Get current segmentation progress."""
    return {
        "total": state.segmentation_progress["total"],
        "completed": state.segmentation_progress["completed"],
        "current": state.segmentation_progress["current"],
        "is_running": state.is_segmenting
    }


@app.get("/api/patch/{py}/{px}")
async def get_patch(py: int, px: int, image_type: str = "xpl45"):
    """Get a specific patch image."""
    try:
        if image_type not in ['ppl45', 'ppl90', 'xpl45', 'xpl90']:
            raise HTTPException(status_code=400, detail="Invalid image type")
        
        patch = state.patches.get(image_type, {}).get((py, px))
        if patch is None:
            raise HTTPException(status_code=404, detail="Patch not found")
        
        return {"image": image_to_base64(patch)}
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/segmentation/{py}/{px}")
async def get_segmentation(py: int, px: int):
    """Get segmentation data for a specific patch."""
    try:
        seg_data = state.segmentations.get((py, px))
        if seg_data is None:
            return {"status": "not_ready", "message": "Segmentation not yet complete"}
        
        # Get unique segment IDs
        labels = seg_data['labels']
        unique_labels = np.unique(labels)
        unique_labels = unique_labels[unique_labels > 0]  # Exclude background (label 1)
        
        return {
            "status": "ready",
            "colored_segments": image_to_base64(seg_data['colored_segments']),
            "bounds": image_to_base64(seg_data['bounds']),
            "labels": labels.tolist(),
            "segment_ids": unique_labels.tolist(),
            "segment_tags": seg_data.get('segment_tags', {})
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/overlay/{py}/{px}")
async def get_overlay(py: int, px: int, mode: str = "segments"):
    """Get overlay image combining segmentation with original."""
    try:
        seg_data = state.segmentations.get((py, px))
        if seg_data is None:
            return {"status": "not_ready"}
        
        # Get xpl45 as base image
        xpl45 = state.patches['xpl45'].get((py, px))
        
        if mode == "segments":
            # Create overlay with segments
            overlay = seg_data['colored_segments'].astype(np.float32) / 255 * 0.5
            overlay += xpl45.astype(np.float32) / 255 * 0.5
            overlay = (overlay * 255).astype(np.uint8)
            return {"image": image_to_base64(overlay)}
        
        elif mode == "bounds":
            bounds = seg_data['bounds']
            overlay = xpl45.copy().astype(np.float32)
            overlay += bounds * 255 * 0.5
            overlay = np.clip(overlay, 0, 255).astype(np.uint8)
            return {"image": image_to_base64(overlay)}
        
        elif mode == "both":
            overlay = seg_data['colored_segments'].astype(np.float32) / 255 * 0.33
            overlay += xpl45.astype(np.float32) / 255 * 0.67
            # Add bounds
            bounds_mask = np.any(seg_data['bounds'] > 0.1, axis=2)
            overlay[bounds_mask] = [0, 1, 1]  # Yellow bounds
            overlay = (overlay * 255).astype(np.uint8)
            return {"image": image_to_base64(overlay)}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/minimap")
async def get_minimap(image_type: str = "xpl45"):
    """Get minimap image (downscaled full image)."""
    try:
        img = state.aligned_images.get(image_type)
        if img is None:
            raise HTTPException(status_code=404, detail="Image not found")
        
        # Downscale to max 400px width
        scale = min(400 / img.shape[1], 1.0)
        new_width = int(img.shape[1] * scale)
        new_height = int(img.shape[0] * scale)
        
        minimap = cv2.resize(img, (new_width, new_height))
        
        return {
            "image": image_to_base64(minimap),
            "scale": scale,
            "original_size": {"width": img.shape[1], "height": img.shape[0]},
            "scaled_size": {"width": new_width, "height": new_height}
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/label-segment")
async def label_segment(request: SaveLabelRequest):
    """Label a segment with a tag."""
    try:
        py, px = request.patch_y, request.patch_x
        seg_data = state.segmentations.get((py, px))
        
        if seg_data is None:
            raise HTTPException(status_code=404, detail="Patch not segmented")
        
        # Store the tag for this segment
        seg_data['segment_tags'][request.segment_id] = request.tag
        
        # Update global color-tag mapping
        state.tag_colors[request.tag] = request.color
        state.color_tags[request.color] = request.tag
        
        # Recolor the segment in colored_segments
        labels = seg_data['labels']
        mask = labels == request.segment_id
        
        bgr_color = hex_to_bgr(request.color)
        seg_data['colored_segments'][mask] = bgr_color
        
        # Also store in segment_colors for persistence
        state.segment_colors[(py, px, request.segment_id)] = request.tag
        
        return {
            "status": "success",
            "tag": request.tag,
            "color": request.color,
            "pixel_count": np.sum(mask)
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/tags")
async def get_tags():
    """Get all defined tags and their colors."""
    return {
        "tag_colors": state.tag_colors,
        "color_tags": state.color_tags
    }


@app.post("/api/set-tag-color")
async def set_tag_color(request: SetTagColorRequest):
    """Set or update a tag's color."""
    # If tag already exists with different color, update
    old_color = state.tag_colors.get(request.tag)
    if old_color:
        del state.color_tags[old_color]
    
    state.tag_colors[request.tag] = request.color
    state.color_tags[request.color] = request.tag
    
    # Update all segments with this tag
    for (py, px, seg_id), tag in state.segment_colors.items():
        if tag == request.tag:
            seg_data = state.segmentations.get((py, px))
            if seg_data:
                labels = seg_data['labels']
                mask = labels == seg_id
                bgr_color = hex_to_bgr(request.color)
                seg_data['colored_segments'][mask] = bgr_color
    
    return {"status": "success"}


@app.get("/api/segment-info/{py}/{px}/{segment_id}")
async def get_segment_info(py: int, px: int, segment_id: int):
    """Get information about a specific segment."""
    try:
        seg_data = state.segmentations.get((py, px))
        if seg_data is None:
            raise HTTPException(status_code=404, detail="Patch not segmented")
        
        labels = seg_data['labels']
        mask = labels == segment_id
        
        if not np.any(mask):
            raise HTTPException(status_code=404, detail="Segment not found")
        
        # Calculate centroid
        y_coords, x_coords = np.where(mask)
        centroid_y = int(np.mean(y_coords))
        centroid_x = int(np.mean(x_coords))
        
        return {
            "segment_id": segment_id,
            "pixel_count": int(np.sum(mask)),
            "centroid": {"x": centroid_x, "y": centroid_y},
            "tag": seg_data['segment_tags'].get(segment_id),
            "color": state.tag_colors.get(seg_data['segment_tags'].get(segment_id, ""))
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/save-project")
async def save_project(request: SaveProjectRequest):
    """Save the entire project with proper structure."""
    try:
        output_path = Path(request.output_path)
        output_path.mkdir(parents=True, exist_ok=True)
        
        rows, cols = state.grid_size
        patch_size = state.patch_size
        
        # ===== 1. Create folder structure =====
        # Main folders
        patches_segmented_dir = output_path / "patches_segmented"
        patches_ppl45_dir = output_path / "patches_ppl45"
        patches_ppl90_dir = output_path / "patches_ppl90"
        patches_xpl45_dir = output_path / "patches_xpl45"
        patches_xpl90_dir = output_path / "patches_xpl90"
        
        for d in [patches_segmented_dir, patches_ppl45_dir, patches_ppl90_dir, 
                  patches_xpl45_dir, patches_xpl90_dir]:
            d.mkdir(parents=True, exist_ok=True)
        
        # ===== 2. Save tags-color dictionary JSON =====
        tags_data = {
            "tag_colors": state.tag_colors,  # tag_name -> color_hex
            "session_id": state.session_id,
            "grid_size": {"rows": rows, "cols": cols},
            "patch_size": patch_size
        }
        
        with open(output_path / "tags.json", "w", encoding="utf-8") as f:
            json.dump(tags_data, f, indent=2, ensure_ascii=False)
        
        # ===== 3. Calculate full image dimensions =====
        if state.aligned_images and 'ppl45' in state.aligned_images:
            full_h, full_w = state.aligned_images['ppl45'].shape[:2]
        else:
            # Fallback: calculate from grid
            full_h = rows * patch_size
            full_w = cols * patch_size
        
        # ===== 4. Create full segmented image with colors =====
        # Initialize with white color (areas without tags)
        full_segmented = np.ones((full_h, full_w, 3), dtype=np.uint8) * 255
        
        # ===== 5. Process each patch =====
        for py in range(rows):
            for px in range(cols):
                y_start = py * patch_size
                x_start = px * patch_size
                y_end = min(y_start + patch_size, full_h)
                x_end = min(x_start + patch_size, full_w)
                
                seg_data = state.segmentations.get((py, px))
                
                # Create colored segmentation for this patch
                if seg_data is not None:
                    labels = seg_data['labels']
                    segment_tags = seg_data.get('segment_tags', {})
                    
                    # Create patch segmentation image with white background
                    patch_seg = np.ones((patch_size, patch_size, 3), dtype=np.uint8) * 255
                    
                    # Color each segment according to its tag
                    for segment_id, tag in segment_tags.items():
                        color_hex = state.tag_colors.get(tag)
                        if color_hex:
                            bgr_color = hex_to_bgr(color_hex)
                            mask = labels == segment_id
                            patch_seg[mask] = bgr_color
                    
                    # Place in full image
                    actual_h = y_end - y_start
                    actual_w = x_end - x_start
                    full_segmented[y_start:y_end, x_start:x_end] = patch_seg[:actual_h, :actual_w]
                    
                    # Save individual segmented patch
                    cv2.imwrite(str(patches_segmented_dir / f"patch_{py:03d}_{px:03d}.png"), patch_seg[:actual_h, :actual_w])
                
                # ===== 6. Save original patches =====
                for img_type, patches_dir in [
                    ('ppl45', patches_ppl45_dir),
                    ('ppl90', patches_ppl90_dir),
                    ('xpl45', patches_xpl45_dir),
                    ('xpl90', patches_xpl90_dir)
                ]:
                    patch = state.patches.get(img_type, {}).get((py, px))
                    if patch is not None:
                        actual_h = y_end - y_start
                        actual_w = x_end - x_start
                        cv2.imwrite(str(patches_dir / f"patch_{py:03d}_{px:03d}.png"), patch[:actual_h, :actual_w])
        
        # ===== 7. Save full segmented image =====
        cv2.imwrite(str(output_path / "segmented_full.png"), full_segmented)
        
        # ===== 8. Save full aligned images =====
        for img_type in ['ppl45', 'ppl90', 'xpl45', 'xpl90']:
            img = state.aligned_images.get(img_type)
            if img is not None:
                cv2.imwrite(str(output_path / f"{img_type}_aligned.png"), img)
        
        # ===== 9. Save segment annotations per patch =====
        annotations_dir = output_path / "annotations"
        annotations_dir.mkdir(parents=True, exist_ok=True)
        
        for (py, px), seg_data in state.segmentations.items():
            segment_tags = seg_data.get('segment_tags', {})
            if segment_tags:
                annotation_file = {
                    "patch_y": py,
                    "patch_x": px,
                    "segments": {str(k): v for k, v in segment_tags.items()}
                }
                with open(annotations_dir / f"patch_{py:03d}_{px:03d}.json", "w", encoding="utf-8") as f:
                    json.dump(annotation_file, f, indent=2, ensure_ascii=False)
        
        return {
            "status": "success",
            "output_path": str(output_path),
            "patches_saved": len(state.segmentations),
            "files_structure": {
                "tags_json": "tags.json",
                "segmented_full": "segmented_full.png",
                "aligned_images": [f"{t}_aligned.png" for t in ['ppl45', 'ppl90', 'xpl45', 'xpl90']],
                "patch_folders": [
                    "patches_segmented",
                    "patches_ppl45", 
                    "patches_ppl90",
                    "patches_xpl45",
                    "patches_xpl90"
                ],
                "annotations_folder": "annotations"
            }
        }
    
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/load-project")
async def load_project(project_path: str):
    """Load a previously saved project."""
    try:
        project_dir = Path(project_path)
        
        if not project_dir.exists():
            raise HTTPException(status_code=404, detail="Project not found")
        
        # Load tags
        tags_file = project_dir / "tags.json"
        if tags_file.exists():
            with open(tags_file, "r", encoding="utf-8") as f:
                tags_data = json.load(f)
            state.tag_colors = tags_data.get("tag_colors", {})
            state.color_tags = tags_data.get("color_tags", {})
            state.session_id = tags_data.get("session_id", "")
        
        return {"status": "success", "tags_loaded": len(state.tag_colors)}
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/status")
async def get_status():
    """Get current application status."""
    return {
        "images_loaded": len(state.images) > 0,
        "images_aligned": len(state.aligned_images) > 0,
        "grid_size": state.grid_size,
        "patches_segmented": len(state.segmentations),
        "total_patches": state.grid_size[0] * state.grid_size[1] if state.grid_size[0] > 0 else 0,
        "tags_defined": len(state.tag_colors),
        "is_segmenting": state.is_segmenting
    }


@app.get("/api/patch-segment-at-point/{py}/{px}")
async def get_segment_at_point(py: int, px: int, x: int, y: int):
    """Get segment ID at a specific point in a patch."""
    try:
        seg_data = state.segmentations.get((py, px))
        if seg_data is None:
            return {"status": "not_ready"}
        
        labels = seg_data['labels']
        
        if y >= labels.shape[0] or x >= labels.shape[1]:
            raise HTTPException(status_code=400, detail="Coordinates out of bounds")
        
        segment_id = int(labels[y, x])
        
        return {
            "status": "success",
            "segment_id": segment_id,
            "tag": seg_data['segment_tags'].get(segment_id),
            "color": state.tag_colors.get(seg_data['segment_tags'].get(segment_id, ""))
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
