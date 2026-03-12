# Mineral Segmentation Features Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add independent layer overlays (canvas stack), segment-derived tag colors, 5-folder export, and EXE source protection to the Mineral Segmentation desktop app.

**Architecture:** Backend gains two new FastAPI endpoints (`/api/segment-color`, `/api/export`) and stores original segment colors at segmentation time. Frontend replaces a single `<img>` with three stacked canvases and gains a two-case annotation modal with live color preview. Build scripts add PyArmor + bytenode + javascript-obfuscator.

**Tech Stack:** Python 3.14 / FastAPI / uv / pytest / numpy / OpenCV — Electron 33 / React 18 (no bundler, CDN) / bytenode / javascript-obfuscator / electron-builder

---

## File Map

| File | Role | Action |
|------|------|--------|
| `backend/main.py` | FastAPI app, global state, all endpoints | Modify: add `original_colors` to `segment_patch_async`, add 2 endpoints |
| `backend/tests/test_main.py` | Backend unit tests | Create |
| `backend/tests/__init__.py` | Test package | Create (empty) |
| `frontend/public/app.html` | Electron renderer entry point | Modify: replace `<script>` with `<script src>`, add canvas markup |
| `frontend/src/app-bundle.js` | React app logic (extracted from app.html) | Create |
| `frontend/main-entry.js` | bytenode bootstrap shim | Create |
| `frontend/package.json` | Electron config | Modify: devDeps, `"main"` field, builder files |
| `build.bat` | Windows build script | Modify: add PyArmor/bytenode/obfuscator steps |
| `build.ps1` | PowerShell build script | Modify: same steps |

---

## Chunk 1: Backend — Segment Colors and Export

### Task 1: Test infrastructure

**Files:**
- Create: `backend/tests/__init__.py`
- Create: `backend/tests/test_main.py`

- [ ] **Step 1: Add pytest dev dependencies**

```bash
cd backend
uv add --dev pytest httpx pytest-asyncio
```

Expected: `pyproject.toml` updated, `uv.lock` updated.

- [ ] **Step 2: Configure pytest in pyproject.toml**

Append this section to `backend/pyproject.toml`:

```toml
[tool.pytest.ini_options]
pythonpath = ["."]
asyncio_mode = "auto"
```

`pythonpath = ["."]` makes `from main import app, state` work from `backend/tests/`.
`asyncio_mode = "auto"` means all `async def test_*` functions run as async without needing `@pytest.mark.asyncio`.

- [ ] **Step 3: Create test package**

Create `backend/tests/__init__.py` (empty file).

- [ ] **Step 4: Verify pytest works**

```bash
cd backend
uv run pytest --collect-only
```

Expected: `no tests ran` (0 items collected, no errors).

- [ ] **Step 5: Commit**

```bash
git add backend/pyproject.toml backend/uv.lock backend/tests/__init__.py
git commit -m "chore: add pytest + httpx + pytest-asyncio dev deps"
```

---

### Task 2: original_colors snapshot in segment_patch_async

**Files:**
- Create: `backend/tests/test_main.py`
- Modify: `backend/main.py:177-199`

The current `segment_patch_async` (lines 187-193 of `main.py`) stores `seg_data` without segment color info. We add `original_colors` — a dict mapping `segment_id (int)` → `"#rrggbb"` — built from `colored_segments` before any labeling.

- [ ] **Step 1: Write failing test**

Create `backend/tests/test_main.py` with this exact content (all imports at top; `asyncio_mode = "auto"` in pyproject.toml means no `@pytest.mark.asyncio` decorator needed):

```python
import json
import os
import numpy as np
import pytest
from httpx import AsyncClient, ASGITransport
from main import app, state, segment_patch_async


async def test_original_colors_populated_after_segmentation():
    """After segment_patch_async runs, seg_data must have 'original_colors' dict."""

    # Fake patch data — small 64x64 BGR images
    fake_patch = np.zeros((64, 64, 3), dtype=np.uint8)
    fake_patch[10:30, 10:30] = [100, 150, 200]  # region 1
    fake_patch[40:60, 40:60] = [50, 80, 120]    # region 2

    state.patches['xpl90'] = {(0, 0): fake_patch}
    state.patches['xpl45'] = {(0, 0): fake_patch}
    state.segmentations.clear()

    await segment_patch_async(0, 0)

    seg_data = state.segmentations.get((0, 0))
    assert seg_data is not None, "seg_data not created"
    assert 'original_colors' in seg_data, "original_colors missing from seg_data"
    assert isinstance(seg_data['original_colors'], dict)
    for seg_id, color in seg_data['original_colors'].items():
        assert isinstance(seg_id, int)
        assert color.startswith('#') and len(color) == 7, f"Bad color format: {color}"
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd backend
uv run pytest tests/test_main.py::test_original_colors_populated_after_segmentation -v
```

Expected: `FAILED` — `assert 'original_colors' in seg_data`.

- [ ] **Step 3: Implement original_colors in segment_patch_async**

In `backend/main.py`, modify `segment_patch_async` (lines 177-199). Replace lines 188-193:

```python
# BEFORE (lines 188-193):
        bounds, colored_segments, labels = result
        state.segmentations[(py, px)] = {
            'bounds': bounds,
            'colored_segments': (colored_segments * 255).astype(np.uint8) if colored_segments.max() <= 1.0 else colored_segments,
            'labels': labels,
            'segment_tags': {}
        }
```

```python
# AFTER:
        bounds, colored_segments, labels = result
        cs = (colored_segments * 255).astype(np.uint8) if colored_segments.max() <= 1.0 else colored_segments

        # Snapshot original algorithmic colors BEFORE any labeling
        original_colors: dict[int, str] = {}
        for seg_id in np.unique(labels):
            positions = np.argwhere(labels == seg_id)
            row, col = positions[0]
            pixel_bgr = cs[row, col]
            b, g, r = int(pixel_bgr[0]), int(pixel_bgr[1]), int(pixel_bgr[2])
            original_colors[int(seg_id)] = f"#{r:02x}{g:02x}{b:02x}"

        state.segmentations[(py, px)] = {
            'bounds': bounds,
            'colored_segments': cs,
            'labels': labels,
            'segment_tags': {},
            'original_colors': original_colors,   # immutable after this point
        }
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd backend
uv run pytest tests/test_main.py::test_original_colors_populated_after_segmentation -v
```

Expected: `PASSED`.

- [ ] **Step 5: Commit**

```bash
git add backend/main.py backend/tests/test_main.py
git commit -m "feat: snapshot original segment colors at segmentation time"
```

---

### Task 3: GET /api/segment-color endpoint

**Files:**
- Modify: `backend/main.py` (add endpoint after `/api/patch-segment-at-point`)
- Modify: `backend/tests/test_main.py` (add tests)

- [ ] **Step 1: Write failing tests**

Append to `backend/tests/test_main.py`:

```python
async def test_segment_color_returns_color():
    """GET /api/segment-color returns the original color for a known segment."""
    # Manually plant known seg_data
    state.segmentations[(1, 1)] = {
        'original_colors': {5: '#aabbcc', 7: '#001122'},
        'bounds': None,
        'colored_segments': None,
        'labels': None,
        'segment_tags': {},
    }

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get("/api/segment-color/1/1/5")
    assert r.status_code == 200
    assert r.json() == {"color": "#aabbcc"}


async def test_segment_color_404_if_patch_not_ready():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get("/api/segment-color/99/99/1")
    assert r.status_code == 404


async def test_segment_color_400_if_segment_id_missing():
    state.segmentations[(2, 2)] = {
        'original_colors': {3: '#ffffff'},
        'bounds': None, 'colored_segments': None, 'labels': None, 'segment_tags': {},
    }
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get("/api/segment-color/2/2/999")
    assert r.status_code == 400
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd backend
uv run pytest tests/test_main.py::test_segment_color_returns_color tests/test_main.py::test_segment_color_404_if_patch_not_ready tests/test_main.py::test_segment_color_400_if_segment_id_missing -v
```

Expected: `FAILED` — 404 for all (endpoint doesn't exist yet).

- [ ] **Step 3: Add endpoint to main.py**

Insert after the `/api/patch-segment-at-point` endpoint (after line 289 of `main.py`):

```python
@app.get("/api/segment-color/{py}/{px}/{segment_id}")
async def get_segment_color(py: int, px: int, segment_id: int):
    seg_data = state.segmentations.get((py, px))
    if not seg_data:
        raise HTTPException(status_code=404, detail="Patch not ready")
    color = seg_data.get('original_colors', {}).get(segment_id)
    if color is None:
        raise HTTPException(status_code=400, detail="Segment ID not found")
    return {"color": color}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd backend
uv run pytest tests/test_main.py::test_segment_color_returns_color tests/test_main.py::test_segment_color_404_if_patch_not_ready tests/test_main.py::test_segment_color_400_if_segment_id_missing -v
```

Expected: all `PASSED`.

- [ ] **Step 5: Commit**

```bash
git add backend/main.py backend/tests/test_main.py
git commit -m "feat: add GET /api/segment-color endpoint"
```

---

### Task 4: POST /api/export endpoint

**Files:**
- Modify: `backend/main.py` (add endpoint after `/api/save-project`)
- Modify: `backend/tests/test_main.py` (add tests)

- [ ] **Step 1: Write failing test**

Append to `backend/tests/test_main.py`:

```python
async def test_export_creates_folder_structure(tmp_path):
    """POST /api/export creates 5 subfolders and tags.json."""
    # Setup: fake patches and one segmented patch
    state.tag_colors = {"Кварц": "#aabbcc"}
    state.grid_size = (1, 1)

    fake_img = np.zeros((64, 64, 3), dtype=np.uint8)
    for name in ['ppl45', 'ppl90', 'xpl45', 'xpl90']:
        state.patches[name] = {(0, 0): fake_img}

    fake_seg = np.zeros((64, 64, 3), dtype=np.uint8)
    fake_seg[10:20, 10:20] = [255, 0, 0]
    state.segmentations[(0, 0)] = {
        'colored_segments': fake_seg,
        'bounds': fake_img,
        'labels': np.zeros((64, 64), dtype=np.int32),
        'segment_tags': {},
        'original_colors': {},
    }

    out = str(tmp_path / "export_test")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.post("/api/export", json={"output_path": out})
    assert r.status_code == 200

    for folder in ['xpl45', 'xpl90', 'ppl45', 'ppl90', 'segments']:
        assert os.path.isdir(os.path.join(out, folder)), f"Missing folder: {folder}"

    # Check patch file naming
    assert os.path.isfile(os.path.join(out, 'xpl45', 'patch_000_000.png'))
    assert os.path.isfile(os.path.join(out, 'segments', 'patch_000_000.png'))

    # Check tags.json — flat format
    with open(os.path.join(out, 'tags.json')) as f:
        data = json.load(f)
    assert data == {"Кварц": "#aabbcc"}


async def test_export_skips_unsegmented_patches(tmp_path):
    """Patches without segmentation data are skipped in segments/ folder."""
    state.tag_colors = {}
    state.grid_size = (1, 2)  # two patches, only one segmented

    fake_img = np.zeros((64, 64, 3), dtype=np.uint8)
    for name in ['ppl45', 'ppl90', 'xpl45', 'xpl90']:
        state.patches[name] = {(0, 0): fake_img, (0, 1): fake_img}

    # Only patch (0,0) is segmented; (0,1) is not
    state.segmentations.clear()
    state.segmentations[(0, 0)] = {
        'colored_segments': fake_img.copy(),
        'bounds': fake_img, 'labels': np.zeros((64, 64), dtype=np.int32),
        'segment_tags': {}, 'original_colors': {},
    }

    out = str(tmp_path / "export_skip")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.post("/api/export", json={"output_path": out})
    assert r.status_code == 200

    # patch (0,1) must NOT appear in segments/
    assert os.path.isfile(os.path.join(out, 'segments', 'patch_000_000.png'))
    assert not os.path.isfile(os.path.join(out, 'segments', 'patch_000_001.png'))
    # But patch (0,1) DOES appear in raw image folders
    assert os.path.isfile(os.path.join(out, 'xpl45', 'patch_000_001.png'))
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd backend
uv run pytest tests/test_main.py::test_export_creates_folder_structure tests/test_main.py::test_export_skips_unsegmented_patches -v
```

Expected: `FAILED` — 404 (endpoint doesn't exist).

- [ ] **Step 3: Add /api/export to main.py**

Insert after the `/api/save-project` endpoint (after line 300 of `main.py`):

```python
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
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd backend
uv run pytest tests/test_main.py::test_export_creates_folder_structure tests/test_main.py::test_export_skips_unsegmented_patches -v
```

Expected: all `PASSED`.

- [ ] **Step 5: Run full test suite**

```bash
cd backend
uv run pytest tests/ -v
```

Expected: all tests `PASSED`.

- [ ] **Step 6: Commit**

```bash
git add backend/main.py backend/tests/test_main.py
git commit -m "feat: add POST /api/export endpoint with 5-folder output"
```

---

## Chunk 2: Frontend — Canvas Stack, Modal, Export Button

### Task 5: Extract app-bundle.js from app.html

**Files:**
- Create: `frontend/src/app-bundle.js`
- Modify: `frontend/public/app.html`

This task has no automated tests — verify manually by launching the app.

- [ ] **Step 1: Create frontend/src/app-bundle.js**

Copy the entire content of the `<script>` block from `frontend/public/app.html` (lines 24-277, starting with `function initApp()` and ending with `window.onload = initApp;`) into `frontend/src/app-bundle.js`. The file should start directly with `function initApp()` — no `<script>` tags.

- [ ] **Step 2: Update app.html**

In `frontend/public/app.html`:

Replace lines 24-278 (the entire `<script>...</script>` block) with:
```html
    <script src="../src/app-bundle.js"></script>
```

The final lines of `app.html` before `</body>` should look like:
```html
    <script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
    <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
    <script src="../src/app-bundle.js"></script>
</body>
</html>
```

- [ ] **Step 3: Manual verification**

Launch the app:
```bash
cd frontend
npm start
```
Expected: app loads normally, editor opens, patch navigation and annotation work.

- [ ] **Step 4: Commit**

```bash
git add frontend/public/app.html frontend/src/app-bundle.js
git commit -m "refactor: extract React app from inline script to app-bundle.js"
```

---

### Task 6: Three-canvas layer stack

**Files:**
- Modify: `frontend/src/app-bundle.js`

Replace the single `<img>` display with three stacked canvases. All edits are inside `app-bundle.js`.

**Background:** Current code (in `App()` function):
- State: `showSegments`, `showBounds`, `currentImage`, `segmentsImage`, `boundsImage`
- Display: `let displayImg = currentImage; if (showSegments && segmentsImage) displayImg = segmentsImage; if (showBounds && boundsImage) displayImg = boundsImage;`
- Render: single `React.createElement('img', {src:'data:image/png;base64,'+displayImg, ...})`

**New approach:** three canvas refs, drawn with useEffect when images or visibility change.

- [ ] **Step 1: Add canvas refs and blend helper**

Inside the `App()` function, after existing `useRef` calls, add:

```js
const canvasBaseRef = useRef(null);
const canvasSegRef  = useRef(null);
const canvasBoundsRef = useRef(null);
```

Add this standalone helper function OUTSIDE the `App()` function (at the top of `initApp`, before `function App()`):

```js
function blendToCanvas(baseDataUrl, segDataUrl, targetCanvas) {
    const W = 1024, H = 1024;
    targetCanvas.width = W;
    targetCanvas.height = H;

    const offA = document.createElement('canvas');
    const offB = document.createElement('canvas');
    offA.width = offB.width = W;
    offA.height = offB.height = H;

    const imgA = new Image();
    const imgB = new Image();
    let loadedCount = 0;

    function onBothLoaded() {
        const ctxA = offA.getContext('2d');
        const ctxB = offB.getContext('2d');
        ctxA.drawImage(imgA, 0, 0);
        ctxB.drawImage(imgB, 0, 0);

        const basePixels = ctxA.getImageData(0, 0, W, H);
        const segPixels  = ctxB.getImageData(0, 0, W, H);
        const result = ctxA.createImageData(W, H);
        const d = result.data;
        const bd = basePixels.data;
        const sd = segPixels.data;

        for (let i = 0; i < d.length; i += 4) {
            d[i]   = Math.min(255, Math.floor(bd[i]   * 2/3 + sd[i]   * 2/3));
            d[i+1] = Math.min(255, Math.floor(bd[i+1] * 2/3 + sd[i+1] * 2/3));
            d[i+2] = Math.min(255, Math.floor(bd[i+2] * 2/3 + sd[i+2] * 2/3));
            d[i+3] = 255;
        }
        targetCanvas.getContext('2d').putImageData(result, 0, 0);
    }

    imgA.onload = imgB.onload = () => { if (++loadedCount === 2) onBothLoaded(); };
    imgA.src = 'data:image/png;base64,' + baseDataUrl;
    imgB.src = 'data:image/png;base64,' + segDataUrl;
}

function drawToCanvas(dataUrl, canvas) {
    const img = new Image();
    img.onload = () => {
        canvas.width = img.width;
        canvas.height = img.height;
        canvas.getContext('2d').drawImage(img, 0, 0);
    };
    img.src = 'data:image/png;base64,' + dataUrl;
}
```

- [ ] **Step 2: Add useEffects to draw canvases**

Remove the three lines starting with `let displayImg = ...` (current lines 194-196 in the original app.html, now in app-bundle.js).

Add these useEffects inside `App()`, after the existing useEffects:

```js
// Draw base image to canvas-base whenever currentImage changes
useEffect(() => {
    if (currentImage && canvasBaseRef.current) {
        drawToCanvas(currentImage, canvasBaseRef.current);
    }
}, [currentImage]);

// Blend segments onto canvas-segments
useEffect(() => {
    const canvas = canvasSegRef.current;
    if (!canvas) return;
    if (showSegments && currentImage && segmentsImage) {
        canvas.style.display = 'block';
        blendToCanvas(currentImage, segmentsImage, canvas);
    } else {
        canvas.style.display = 'none';
    }
}, [showSegments, currentImage, segmentsImage]);

// Draw bounds onto canvas-bounds
useEffect(() => {
    const canvas = canvasBoundsRef.current;
    if (!canvas) return;
    if (showBounds && boundsImage) {
        canvas.style.display = 'block';
        drawToCanvas(boundsImage, canvas);
    } else {
        canvas.style.display = 'none';
    }
}, [showBounds, boundsImage]);
```

- [ ] **Step 3: Replace the viewer render**

Find the viewer section in the `return` statement. Replace:

```js
React.createElement('img', {src:'data:image/png;base64,'+displayImg, draggable:false}),
```

With three canvas elements:

```js
React.createElement('canvas', {
    ref: canvasBaseRef,
    width: 1024, height: 1024,
    style: {display: 'block', position: 'absolute', top: 0, left: 0},
    draggable: false
}),
React.createElement('canvas', {
    ref: canvasSegRef,
    width: 1024, height: 1024,
    style: {display: 'none', position: 'absolute', top: 0, left: 0, pointerEvents: 'none'}
}),
React.createElement('canvas', {
    ref: canvasBoundsRef,
    width: 1024, height: 1024,
    style: {display: 'none', position: 'absolute', top: 0, left: 0, pointerEvents: 'none'}
}),
```

Also update the `viewer-canvas` div to have `position: 'relative'` so absolute children position correctly:

```js
React.createElement('div', {
    className:'viewer-canvas',
    style:{position:'relative', transform:`translate(${offset.x}px, ${offset.y}px) scale(${zoom})`},
    onMouseDown:handleMouseDown, ...
},
```

- [ ] **Step 4: Fix handleImageClick coordinates**

The click handler uses `e.currentTarget.getBoundingClientRect()`. With the canvas stack, clicks land on `canvas-base` (bottom layer, the one with pointer events). Update `handleImageClick` to compute coordinates relative to `canvasBaseRef.current`:

```js
const handleImageClick = (e) => {
    if (!patchReady || window.isPanning) return;
    const canvas = canvasBaseRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) / zoom);
    const y = Math.floor((e.clientY - rect.top) / zoom);
    if (x >= 0 && y >= 0 && x < 1024 && y < 1024) {
        api.get(`/api/patch-segment-at-point/${currentPatch.y}/${currentPatch.x}?x=${x}&y=${y}`).then(r => {
            if (r.status === 'success' && r.segment_id > 1) {
                setSelectedSegment({id: r.segment_id, tag: r.tag});
                setShowAnnotationModal(true);
            }
        });
    }
};
```

- [ ] **Step 5: Manual verification**

```bash
cd frontend && npm start
```

Load images → go to editor. Verify:
- Base image always visible
- Pressing B toggles segments (with 2/3+2/3 additive blend visible on a colored region)
- Pressing S toggles boundaries
- Both can be active simultaneously (boundaries drawn on top of blended segments)
- Clicking a segment still opens annotation modal

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app-bundle.js
git commit -m "feat: replace img display with three-canvas layer stack (2/3+2/3 blend)"
```

---

### Task 7: Two-case annotation modal with live color preview

**Files:**
- Modify: `frontend/src/app-bundle.js`

- [ ] **Step 1: Add segmentDarkColor state**

Inside `App()`, add a new state variable after the existing state declarations:

```js
const [segmentDarkColor, setSegmentDarkColor] = useState(null); // "#rrggbb" for Case A
```

- [ ] **Step 2: Replace modal open logic (handleImageClick callback)**

In `handleImageClick`, when a segment is clicked:

```js
api.get(`/api/patch-segment-at-point/${currentPatch.y}/${currentPatch.x}?x=${x}&y=${y}`).then(r => {
    if (r.status === 'success' && r.segment_id > 1) {
        const segInfo = {id: r.segment_id, tag: r.tag || null};
        setSelectedSegment(segInfo);

        if (!r.tag) {
            // Case A: no existing tag — fetch original segment color, darken it
            api.get(`/api/segment-color/${currentPatch.y}/${currentPatch.x}/${r.segment_id}`).then(cr => {
                const hex = cr.color.replace('#', '');
                const rd = Math.floor(parseInt(hex.slice(0,2), 16) / 2);
                const gd = Math.floor(parseInt(hex.slice(2,4), 16) / 2);
                const bd = Math.floor(parseInt(hex.slice(4,6), 16) / 2);
                const dark = '#' + [rd, gd, bd].map(v => v.toString(16).padStart(2,'0')).join('');
                setSegmentDarkColor(dark);
                setShowAnnotationModal(true);
            });
        } else {
            // Case B: segment already has a tag
            setSegmentDarkColor(null);
            setShowAnnotationModal(true);
        }
    }
});
```

- [ ] **Step 3: Replace saveTag to use color resolution**

Replace the existing `saveTag` function:

```js
const saveTag = (tagName, forcedColor) => {
    if (!tagName) return;
    // Resolution order: forcedColor > existing tag color > segmentDarkColor > random
    const color = forcedColor
        || tags[tagName]
        || segmentDarkColor
        || ('#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0'));
    api.post('/api/label-segment', {
        patch_y: currentPatch.y, patch_x: currentPatch.x,
        segment_id: selectedSegment.id, tag: tagName, color: color
    }).then(() => {
        setShowAnnotationModal(false);
        api.get(`/api/segmentation/${currentPatch.y}/${currentPatch.x}`).then(d => {
            if (d.status === 'ready') setSegmentsImage(d.colored_segments);
        });
        api.get('/api/tags').then(d => setTags(d.tag_colors || {}));
    });
};
```

- [ ] **Step 4: Replace modal render with two-case UI**

Replace the existing modal `React.createElement` block with:

```js
showAnnotationModal && React.createElement('div', {className:'modal-overlay', onClick:()=>setShowAnnotationModal(false)},
    React.createElement('div', {className:'modal', onClick:e=>e.stopPropagation()},
        React.createElement('h3', null, selectedSegment && selectedSegment.tag ? 'Изменить тег' : 'Новый тег'),

        // Color preview swatch + input row
        React.createElement('div', {style:{display:'flex', alignItems:'center', gap:'8px', marginBottom:'8px'}},
            React.createElement('div', {
                id: 'modal-color-swatch',
                style: {
                    width: '24px', height: '24px', borderRadius: '4px', border: '1px solid #555',
                    backgroundColor: (() => {
                        // initial swatch color — will be updated by onChange
                        if (selectedSegment && selectedSegment.tag) return tags[selectedSegment.tag] || '#888';
                        return segmentDarkColor || '#888';
                    })()
                }
            }),
            React.createElement('input', {
                id: 'tag-input',
                className: 'modal-input',
                style: {flex: 1},
                placeholder: 'Название...',
                defaultValue: (selectedSegment && selectedSegment.tag) ? selectedSegment.tag : '',
                autoFocus: true,
                onChange: (e) => {
                    const val = e.target.value;
                    const swatch = document.getElementById('modal-color-swatch');
                    if (!swatch) return;
                    // Live preview: existing tag color OR segment dark color
                    swatch.style.backgroundColor = tags[val] || segmentDarkColor || '#888';
                },
                onKeyDown: e => {
                    if (e.key === 'Enter') saveTag(e.target.value);
                }
            })
        ),

        React.createElement('div', {className:'modal-buttons'},
            React.createElement('button', {className:'btn btn-secondary', onClick:()=>setShowAnnotationModal(false)}, 'Отмена'),
            React.createElement('button', {className:'btn btn-primary', onClick:()=> {
                saveTag(document.getElementById('tag-input').value);
            }}, 'ОК')
        )
    )
)
```

- [ ] **Step 5: Manual verification**

Launch the app and test:
1. Click an untagged segment → modal opens with empty input and colored swatch (darkened segment color)
2. Type a new tag name → swatch stays as dark segment color
3. Type an existing tag name → swatch changes to that tag's color
4. Click OK → segment recolors to the swatch color
5. Click an already-tagged segment → modal opens with pre-filled name and that tag's color in swatch

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app-bundle.js
git commit -m "feat: two-case annotation modal with live segment color preview"
```

---

### Task 8: Export button in toolbar

**Files:**
- Modify: `frontend/src/app-bundle.js`

- [ ] **Step 1: Add export button to toolbar**

In the `return` statement, find the "💾 Сохранить" button:

```js
React.createElement('button', {className:'btn btn-primary', onClick:()=> {
    window.electronAPI.selectOutputFolder().then(r => { if(!r.canceled) api.post('/api/save-project', {output_path: r.path}); });
}}, '💾 Сохранить')
```

After it, add a divider and the export button:

```js
React.createElement('div', {className:'toolbar-divider'}),
React.createElement('button', {className:'btn btn-secondary', onClick:()=> {
    window.electronAPI.selectOutputFolder().then(r => {
        if (!r.canceled) {
            api.post('/api/export', {output_path: r.path}).then(res => {
                if (res.status === 'success') alert('Экспорт завершён: ' + r.path);
            });
        }
    });
}}, '📤 Экспорт')
```

- [ ] **Step 2: Manual verification**

Launch app → load images → annotate at least one segment → click "📤 Экспорт" → select a folder → verify the 5 subfolders and `tags.json` are created.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app-bundle.js
git commit -m "feat: add export button wired to /api/export"
```

---

## Chunk 3: EXE Protection — Build Infrastructure

### Task 9: main-entry.js bytenode shim + package.json updates

**Files:**
- Create: `frontend/main-entry.js`
- Modify: `frontend/package.json`

- [ ] **Step 1: Create frontend/main-entry.js**

```js
require('bytenode');
require('./main.jsc');
```

- [ ] **Step 2: Update frontend/package.json**

Change `"main": "main.js"` to `"main": "main-entry.js"`.

Add `bytenode` and `javascript-obfuscator` to `devDependencies`:

```json
"devDependencies": {
    "electron": "^33.0.0",
    "electron-builder": "^25.0.0",
    "bytenode": "^1.5.0",
    "javascript-obfuscator": "^4.1.0"
}
```

Update the electron-builder `"files"` array:

```json
"files": [
    "main-entry.js",
    "main.js",
    "preload.js",
    "src/**/*",
    "public/**/*",
    "**/*.jsc"
]
```

- [ ] **Step 3: Install new deps**

```bash
cd frontend
npm install
```

Expected: `bytenode` and `javascript-obfuscator` installed, `package-lock.json` updated.

- [ ] **Step 4: Verify bytenode compiles main.js**

```bash
cd frontend
npx bytenode -c main.js
```

Expected: `main.jsc` created in `frontend/`.

- [ ] **Step 5: Test that main-entry.js can load main.jsc**

```bash
cd frontend
npm start
```

Expected: app starts normally (Electron loads `main-entry.js` which loads `main.jsc`).

- [ ] **Step 6: Add .jsc to .gitignore**

Create `frontend/.gitignore` (or append to root `.gitignore`):
```
*.jsc
frontend/src/app-bundle.obf.js
```

- [ ] **Step 7: Commit**

```bash
git add frontend/main-entry.js frontend/package.json frontend/package-lock.json .gitignore
git commit -m "feat: add bytenode shim and obfuscator dev dependencies"
```

---

### Task 10: Update build.bat with full protection pipeline

**Files:**
- Modify: `build.bat`
- Modify: `build.ps1` (if exists)

- [ ] **Step 1: Add PyArmor dev dep to backend**

```bash
cd backend
uv add --dev pyarmor
```

Expected: `pyproject.toml` has `pyarmor` in dev deps.

- [ ] **Step 2: Rewrite build.bat**

Replace the contents of `build.bat` with:

```bat
@echo off
setlocal enabledelayedexpansion
echo ================================================
echo   Mineral Segmentation App - Protected Build
echo ================================================
echo.

where uv >nul 2>&1
if errorlevel 1 ( echo ERROR: uv not found! && pause && exit /b 1 )
where node >nul 2>&1
if errorlevel 1 ( echo ERROR: Node.js not found! && pause && exit /b 1 )

:: Step 1: Obfuscate Python backend with PyArmor
echo [1/6] Obfuscating Python backend (PyArmor 8)...
cd backend
if exist dist\pyarmor_dist rmdir /s /q dist\pyarmor_dist
uv run pyarmor gen -O dist\pyarmor_dist main.py aligner.py segmentation.py
if errorlevel 1 ( echo ERROR: PyArmor failed && cd .. && pause && exit /b 1 )

:: Find runtime package name (pyarmor_runtime_XXXXXXXX)
set RUNTIME=
for /d %%d in (dist\pyarmor_dist\pyarmor_runtime_*) do set RUNTIME=%%~nd
if "!RUNTIME!"=="" ( echo ERROR: pyarmor_runtime_* folder not found && cd .. && pause && exit /b 1 )
echo Found runtime: !RUNTIME!

:: Step 2: Build backend exe with PyInstaller
echo [2/6] Building backend exe (PyInstaller)...
if exist build rmdir /s /q build
if exist dist\backend.exe del dist\backend.exe
uv run pyinstaller --clean --noconfirm --hidden-import !RUNTIME! backend.spec
if not exist "dist\backend.exe" (
    echo Trying dist\backend\backend.exe path...
    if not exist "dist\backend\backend.exe" (
        echo ERROR: backend.exe not found after PyInstaller
        cd .. && pause && exit /b 1
    )
    copy "dist\backend\backend.exe" "dist\backend.exe"
)
echo Backend built.
cd ..

:: Step 3: Install frontend dependencies
echo [3/6] Installing frontend dependencies...
cd frontend
if not exist node_modules call npm install --silent
cd ..

:: Step 4: Compile Electron main process with bytenode
echo [4/6] Compiling main.js and preload.js with bytenode...
cd frontend
npx bytenode -c main.js
if errorlevel 1 ( echo ERROR: bytenode compile main.js failed && cd .. && pause && exit /b 1 )
npx bytenode -c preload.js
if errorlevel 1 ( echo ERROR: bytenode compile preload.js failed && cd .. && pause && exit /b 1 )
cd ..

:: Step 5: Obfuscate renderer with javascript-obfuscator
echo [5/6] Obfuscating renderer (javascript-obfuscator)...
cd frontend
npx javascript-obfuscator src\app-bundle.js ^
    --output src\app-bundle.obf.js ^
    --compact true ^
    --string-array true ^
    --string-array-encoding base64
if errorlevel 1 ( echo ERROR: javascript-obfuscator failed && cd .. && pause && exit /b 1 )

:: Update app.html to use obfuscated bundle
powershell -Command "(Get-Content public\app.html) -replace 'app-bundle\.js', 'app-bundle.obf.js' | Set-Content public\app.html"

:: Step 6: Package with Electron Builder
echo [6/6] Building Electron app...
call npm run build
if errorlevel 1 ( echo ERROR: electron-builder failed && cd .. && pause && exit /b 1 )

:: Restore app.html to dev version
powershell -Command "(Get-Content public\app.html) -replace 'app-bundle\.obf\.js', 'app-bundle.js' | Set-Content public\app.html"

cd ..
echo.
echo ================================================
echo   BUILD COMPLETE — Output in frontend\dist\
echo ================================================
dir frontend\dist\*.exe 2>nul
pause
```

- [ ] **Step 3: Manual build test**

```bat
build.bat
```

Expected: `frontend\dist\` contains the installer `.exe` and/or portable `.exe`.

- [ ] **Step 4: Verify protection**

After build, inspect the installed app's resources:
- Python `.py` files should NOT be readable in the installed backend (obfuscated .pyc with runtime)
- `resources\app.asar` can be extracted with `npx asar extract`, but `app-bundle.obf.js` should be mangled and unreadable
- `main.jsc` and `preload.jsc` should be binary V8 bytecode

- [ ] **Step 5: Commit**

```bash
git add build.bat backend/pyproject.toml backend/uv.lock frontend/main-entry.js
git commit -m "feat: add full EXE protection pipeline (PyArmor + bytenode + js-obfuscator)"
```

---

## Summary

| Chunk | Tasks | Key outcomes |
|-------|-------|-------------|
| 1 (Backend) | 1–4 | `/api/segment-color` + `/api/export` with full test coverage |
| 2 (Frontend) | 5–8 | Canvas layer stack, two-case modal, export button |
| 3 (Build) | 9–10 | Protected EXE with PyArmor + bytenode + javascript-obfuscator |
