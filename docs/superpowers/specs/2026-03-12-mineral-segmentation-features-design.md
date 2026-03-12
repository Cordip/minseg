# Mineral Segmentation — Feature Design
**Date:** 2026-03-12
**Status:** Approved

---

## 1. Overview

Four feature groups for the Mineral Segmentation desktop app (Electron + FastAPI/Python):

1. **Layer system** — independent Boundaries and Segments overlays
2. **Tag-color system** — segment-derived colors for new tags, recoloring on existing tag assignment
3. **Export** — five output folders + JSON
4. **EXE protection** — source code obfuscation

**Package manager:** `uv` (project uses `pyproject.toml` + uv-managed venv; never use bare `pip`).

---

## 2. Layer System (Boundaries + Segments)

### Problem
Currently `displayImg` is a single variable; toggling either Segments or Boundaries replaces the base image. They are mutually exclusive.

### Solution: Three-canvas stack
Replace the single `<img>` with three `<canvas>` elements, all `position: absolute` inside `viewer-panel`. Only `canvas-base` has pointer events; upper canvases have `pointer-events: none`.

| Layer | Element | Z-order | Visible when | Rendering |
|-------|---------|---------|--------------|-----------|
| Base image | `canvas-base` | Bottom | Always | Full opacity |
| Segments | `canvas-segments` | Middle | `showSegments === true` | ImageData blend (see below) |
| Boundaries | `canvas-bounds` | Top | `showBounds === true` | Full opacity, no formula |

### Rendering order when both layers active
When both `showSegments` and `showBounds` are true simultaneously: blended segments are drawn on `canvas-segments` (middle), then bounds lines are drawn on `canvas-bounds` (top). Bounds are always the topmost layer — drawn at full opacity with no blending formula applied. The three canvases are independent; toggling one does not affect the others.

### Blend formula for Segments
User-specified: `result_channel = min(255, floor(2/3 × base_channel + 2/3 × seg_channel))`

Implementation — pixel-level ImageData:
1. Draw base image on offscreen canvas A → `getImageData()` → `baseData`
2. Draw segments image on offscreen canvas B → `getImageData()` → `segData`
3. For each pixel i, each RGB channel (index i, i+1, i+2; alpha i+3 = 255 always):
   `out[i] = Math.min(255, Math.floor((2/3) * baseData[i] + (2/3) * segData[i]))`
4. `putImageData(result)` onto `canvas-segments`

When `showSegments` is false: `canvas-segments` has `display: none` (blend result cached; not recomputed until base image or segments image changes).

### Hotkey mapping (unchanged from current code)
Current code and button labels: `S` → `showBounds` (Границы), `B` → `showSegments` (Сегменты). No changes.

### Rendering on patch change
1. Load base image → draw to `canvas-base`
2. Request segmentation; if ready and `showSegments` → compute blend → draw to `canvas-segments`
3. If ready and `showBounds` → draw bounds to `canvas-bounds`
4. If not yet ready: show "⏳ Обработка..." spinner overlay; hide segment and bounds canvases until ready

---

## 3. Tag-Color System

### Original color snapshot
In `segment_patch_async`, after `full_segmentation` returns `(bounds, colored_segments, labels)`, build an `original_colors` dict before storing in `seg_data`:

```python
original_colors = {}
for seg_id in np.unique(labels):
    mask = labels == seg_id
    # find first pixel belonging to this segment
    idx = np.argwhere(mask)[0]
    pixel_bgr = colored_segments[idx[0], idx[1]]
    b, g, r = int(pixel_bgr[0]), int(pixel_bgr[1]), int(pixel_bgr[2])
    original_colors[int(seg_id)] = f"#{r:02x}{g:02x}{b:02x}"

state.segmentations[(py, px)] = {
    ...existing fields...,
    'original_colors': original_colors   # never mutated after this
}
```

`label_segment` does NOT modify `original_colors`. The snapshot is permanent.

### New backend endpoint
`GET /api/segment-color/{py}/{px}/{segment_id}`

```python
seg_data = state.segmentations.get((py, px))
if not seg_data:
    raise HTTPException(404)
color = seg_data['original_colors'].get(segment_id)
if color is None:
    raise HTTPException(400)
return {"color": color}
```

### Modal behavior — two cases

**Case A: Segment has no existing tag** (`r.tag` is null/empty in `patch-segment-at-point` response)
1. Call `GET /api/segment-color` → receive `segColor` (#rrggbb)
2. Compute `darkColor`: `r_dark = Math.floor(r/2)`, same for g, b, convert back to hex
3. Modal opens: text input (empty), color preview swatch showing `darkColor`
4. **Live preview update (onChange handler):** on each keystroke, check `tags[inputValue]`:
   - If `inputValue` matches an existing tag name → preview swatch shows `tags[inputValue]`
   - If no match → preview swatch shows `darkColor`
5. On OK: `resolvedColor = tags[inputValue] ?? darkColor` → `POST /api/label-segment` with `resolvedColor`

**Case B: Segment already has a tag** (`r.tag` is non-null)
1. No `/api/segment-color` call
2. Modal opens: text input pre-filled with `r.tag`, preview swatch shows `tags[r.tag]`
3. Same onChange live preview as Case A
4. On OK: `resolvedColor = tags[inputValue] ?? darkColor_from_prev_case_A_call` — but since Case B didn't call segment-color, if user changes to a new name in Case B, fall back to a random color (same behavior as before for this edge case, since no segment color was fetched)

### Existing tag — right panel
Click a tag → calls existing `saveTag(name)` with `tags[name]` color. No modal. Unchanged.

### State field for tags
`state.tag_colors: Dict[str, str]` is the authoritative tag→color map (populated by `label_segment`). This is the field used everywhere — in exports, in the tags endpoint, and in the modal resolution.

---

## 4. Export

### New endpoint
`POST /api/export` with body `{"output_path": "..."}` (reuses `SaveProjectRequest` model).

Coexists with `/api/save-project`. New toolbar button **"📤 Экспорт"** calls `/api/export`; existing "💾 Сохранить" calls `/api/save-project` (unchanged).

### Output structure
```
output_path/
├── xpl45/    patch_{row:03d}_{col:03d}.png  (all patches)
├── xpl90/    ...
├── ppl45/    ...
├── ppl90/    ...
├── segments/ patch_{row:03d}_{col:03d}.png  (colored_segments per patch)
└── tags.json
```

### `segments/` content
Each file is the current `colored_segments` numpy array for that patch, saved as PNG via `cv2.imwrite`. Tagged segments show their tag color; untagged segments show their original algorithmic color. Pixel colors encode the annotation state — this is the primary export deliverable.

**Unprocessed patches (segmentation not yet run):** the file is **skipped** (not written). The folder will have fewer files than the other four folders if annotation is incomplete. No black placeholder PNGs.

### `tags.json` format
```json
{
  "Кварц": "#4a3b2c",
  "Полевой шпат": "#2a1f3d"
}
```
Written from `state.tag_colors` directly (flat dict, already `{tag_name: color_hex}`). Intentionally different from `/api/save-project` format which wraps in `{"tag_colors": ..., "session": ...}`.

---

## 5. EXE Protection

**Package manager: `uv`** — use `uv add` to add dependencies to `pyproject.toml`.

### Python backend — PyArmor 8 + uv

```bat
uv add --dev pyarmor
cd backend
uv run pyarmor gen main.py aligner.py segmentation.py
:: outputs obfuscated files + pyarmor_runtime_* folder to dist/pyarmor_dist/
```

Then PyInstaller (via existing `backend.spec`) must be updated to include the runtime:
- After `pyarmor gen`, a folder named `pyarmor_runtime_XXXXXXXX` is created in `dist/pyarmor_dist/`
- Add `--hidden-import pyarmor_runtime_XXXXXXXX` to `backend.spec` (or add a `collect_all` entry)
- The build script reads the folder name dynamically:
  ```bat
  for /d %%d in (dist\pyarmor_dist\pyarmor_runtime_*) do set RUNTIME=%%~nd
  :: then patch backend.spec or pass --hidden-import %RUNTIME%
  uv run pyinstaller --clean --noconfirm --hidden-import %RUNTIME% backend.spec
  ```

### Electron main process — bytenode

```bat
npm install bytenode
npx bytenode -c frontend/main.js    :: → frontend/main.jsc
npx bytenode -c frontend/preload.js :: → frontend/preload.jsc
```

Create `frontend/main-entry.js` (3 lines, committed to repo):
```js
require('bytenode');
require('./main.jsc');
```

Update `frontend/package.json`:
- `"main"`: `"main-entry.js"`
- electron-builder `"files"` array: add `"**/*.jsc"`, `"main-entry.js"`

`main.js` and `preload.js` source files remain in repo unchanged; `.jsc` files are build artifacts (add to `.gitignore`).

### Electron renderer — javascript-obfuscator

Renderer runs in Chromium — bytenode does not apply.

1. Extract entire `<script>` block from `frontend/public/app.html` → `frontend/src/app-bundle.js`. **Remove** the inline `<script>` block from `app.html` entirely.
2. Add `<script src="../src/app-bundle.obf.js"></script>` in its place in `app.html`.
3. Build step: `npx javascript-obfuscator frontend/src/app-bundle.js --output frontend/src/app-bundle.obf.js --compact true --string-array true --string-array-encoding base64`
4. `app-bundle.obf.js` is a build artifact (add to `.gitignore`); `app-bundle.js` is committed.

### Build script order (`build.bat` / `build.ps1`)
```
1. uv add --dev pyarmor  (idempotent, updates pyproject.toml once)
2. uv run pyarmor gen backend sources → dist/pyarmor_dist/
3. Read pyarmor_runtime_XXXXXXXX folder name dynamically
4. uv run pyinstaller --hidden-import <runtime> backend.spec
5. npm install  (installs bytenode, javascript-obfuscator)
6. npx bytenode -c main.js && npx bytenode -c preload.js
7. npx javascript-obfuscator app-bundle.js --output app-bundle.obf.js ...
8. npx electron-builder  (asar:true, files includes *.jsc)
```

---

## 6. Files Changed

| File | Change |
|------|--------|
| `frontend/public/app.html` | Replace `<img>` with 3-canvas stack; two-case modal logic with live preview; export button; remove inline `<script>` → `<script src="../src/app-bundle.obf.js">` |
| `frontend/src/app-bundle.js` | New: extracted React app code (source; obfuscated at build time) |
| `backend/main.py` | `original_colors` snapshot in `segment_patch_async`; `GET /api/segment-color`; `POST /api/export` |
| `build.bat` | Full build pipeline with uv, pyarmor, bytenode, javascript-obfuscator, electron-builder |
| `build.ps1` | Same as build.bat (PowerShell equivalent) |
| `frontend/package.json` | Add `bytenode`, `javascript-obfuscator` devDeps; `"main"` → `"main-entry.js"`; files array with `*.jsc` |
| `frontend/main-entry.js` | New: bytenode loader shim (3 lines) |
| `frontend/main.js` | No source changes; compiled to `.jsc` at build time |
| `frontend/preload.js` | No source changes; compiled to `.jsc` at build time |
| `backend/pyproject.toml` | `pyarmor` added as dev dependency via `uv add --dev` |

---

## 7. Out of Scope
- Changing the segmentation algorithm or alignment logic
- Re-importable project format (export is output-only)
- Any UI changes beyond those listed
