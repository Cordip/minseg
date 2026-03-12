# Tag Navigator v2, Multi-Select Highlight & Build Fix

## Date: 2026-03-13

## Overview

Two independent blocks: (A) fix asar source leakage in build, (B-G) redesign tag navigator with hierarchical list, segment-focused previews, smart camera zoom, selection highlighting, tag management, and context menu.

**Note:** `app.js` (ES module source) and `app-bundle.js` (bundled runtime) must stay in sync. Backend uses global `AppState` with `state.segmentations[(py,px)]` containing `labels` (numpy ndarray of segment IDs per pixel), `segment_tags`, `colored_segments`, `original_colors`.

---

## A. Build — Exclude Source from Asar

**Problem:** `package.json` build.files includes `src/**/*` and `main.js`. After build, `npx asar extract app.asar` exposes full readable source alongside compiled `.jsc` / `.obf.js`.

**Current build.files:**
```json
["main-entry.js", "main.js", "preload.js", "src/**/*", "public/**/*", "**/*.jsc"]
```

**Solution:** Exclude unneeded source files:
```json
["main-entry.js", "preload.js", "src/app-bundle.js", "src/styles/**/*", "public/**/*", "**/*.jsc"]
```

Changes:
- Remove `main.js` — `main-entry.js` loads `main.jsc` at runtime, original source not needed
- Remove `src/**/*` wildcard — replace with explicit `src/app-bundle.js` and `src/styles/**/*`
- `src/app.js` excluded — ES module source, never loaded by `app.html`

**Files:** `frontend/package.json`

---

## B. Tag Navigator — Hierarchical List

**Problem:** Current navigator shows flat list grouped by patch. User sees one row per patch with "N сегментов" count. No way to see or act on individual segments.

**Solution:** Two-level collapsible tree (like VS Code folder browser):

```
┌─ [■ color] "alpha"  — 12 сегментов, 4 патча        [× close]
│  [rename inline]  [color picker]
│
├─ ▶ Патч 2,3 — 5 сегментов  [patch preview]  [📍 go] [✏️ tag all]
│  ├─ #14  [segment crop preview]  [📍 go+zoom] [✏️ tag]
│  ├─ #27  [segment crop preview]  [📍 go+zoom] [✏️ tag]
│  └─ ...
├─ ▶ Патч 6,1 — 3 сегмента   [patch preview]  [📍 go] [✏️ tag all]
└─ ▶ Патч 15,0 — 4 сегмента  [patch preview]  [📍 go] [✏️ tag all]
```

**Behavior:**
- Initially all patches collapsed (▶)
- Click patch row → expand/collapse (▼/▶), reveals individual segments
- Patch-level preview: whole patch, only segments of this tag highlighted in tag color, rest dimmed
- Segment-level preview: cropped around segment bounding box, segment highlighted in tag color

**Buttons:**
- **📍 on patch:** navigate to patch (zoom=1, offset=0,0)
- **📍 on segment:** navigate to segment center, zoom to fit segment at 75% viewport (see section D)
- **✏️ on patch:** open annotation modal — tag saved to ALL segments of this tag in this patch
- **✏️ on segment:** open annotation modal — tag saved to this one segment

**State:**
- `tagNavData`: `{name, color, locations: [{patch_y, patch_x, segments: [{id, bounds: {x_min,y_min,x_max,y_max,cx,cy}}]}]}`
- `expandedPatches`: `Set` of `"py-px"` strings tracking which patches are expanded

**Files:** `frontend/src/app-bundle.js`, `frontend/src/app.js`

---

## C. Backend — New Endpoints

### C1. Modify `/api/tag-locations/{tag_name}`

Current response groups by patch but returns flat `segment_ids` array. Change to include per-segment bounding box:

```json
{
  "locations": [
    {
      "patch_y": 2, "patch_x": 3,
      "segments": [
        {"id": 14, "bounds": {"x_min": 120, "y_min": 300, "x_max": 280, "y_max": 500, "cx": 200, "cy": 400}},
        {"id": 27, "bounds": {"x_min": 50, "y_min": 100, "x_max": 200, "y_max": 250, "cx": 125, "cy": 175}}
      ],
      "count": 2
    }
  ]
}
```

Bounding box computed from `labels` array:
```python
mask = labels == segment_id
positions = np.argwhere(mask)
y_min, x_min = positions.min(axis=0)
y_max, x_max = positions.max(axis=0)
cx, cy = int((x_min + x_max) // 2), int((y_min + y_max) // 2)
```

### C2. `GET /api/patch-tag-preview/{py}/{px}/{tag_name}`

Returns 128×128 JPEG thumbnail of the patch with only segments of given tag highlighted in tag color, rest of image darkened (50% opacity overlay on non-tag pixels).

Implementation:
1. Get patch image from `state.patches[image_type][(py,px)]`
2. Build combined mask: `OR` of `(labels == sid)` for all segment_ids with this tag
3. Darken non-mask pixels (multiply by 0.4)
4. Tint mask pixels with tag color at 40% blend
5. Resize to 128×128, return JPEG

### C3. `GET /api/segment-preview/{py}/{px}/{segment_id}`

Returns JPEG thumbnail cropped around segment bounding box with padding (20% of bbox size, min 16px), segment highlighted in its tag color. Long side scaled to 96px.

Implementation:
1. Compute bounding box from `labels`
2. Add padding, clamp to image bounds
3. Crop patch image to padded bbox
4. Overlay segment color at 40% blend on segment pixels within crop
5. Resize so longest side = 96px, return JPEG

### C4. `POST /api/rename-tag`

Request: `{"old_name": "alpha", "new_name": "beta"}`

- Iterate all `state.segmentations` → `segment_tags`: replace values matching `old_name` with `new_name`
- Update `state.tag_colors`: move color from old key to new key
- Update `state.segment_colors` cache
- Return `{"status": "success"}`

### C5. `POST /api/recolor-tag`

Request: `{"tag_name": "alpha", "new_color": "#ff0000"}`

- Update `state.tag_colors[tag_name]`
- Iterate all segmentations, for each segment with this tag: update `colored_segments` RGBA with new color
- Return `{"status": "success"}`

### C6. `POST /api/delete-tag`

Request: `{"tag_name": "alpha"}`

- Iterate all `state.segmentations` → `segment_tags`: remove entries with this tag
- Remove from `state.tag_colors`
- Clear `colored_segments` pixels for affected segments (set RGBA to 0)
- Clean up `state.segment_colors` cache
- Return `{"status": "success"}`

### C7. `GET /api/selection-mask/{py}/{px}`

Query param: `ids=14,27,42` (comma-separated segment IDs)

Returns: base64-encoded PNG mask where selected segment pixels are white, rest transparent. Frontend draws this with green stripe pattern.

**Files:** `backend/main.py`

---

## D. Camera — Zoom to Segment

When clicking 📍 on a segment in the navigator:

1. Frontend already has `bounds: {x_min, y_min, x_max, y_max, cx, cy}` from tag-locations response
2. Set `currentPatch` to segment's patch
3. Calculate segment dimensions: `segW = x_max - x_min`, `segH = y_max - y_min`
4. Get viewer dimensions: `viewerRef.current.getBoundingClientRect()`
5. Calculate zoom: `Math.min(viewW / segW, viewH / segH) * 0.75`
6. Clamp zoom to [0.5, 10] (don't zoom too far on tiny segments)
7. Calculate offset to center segment: `offset = {x: viewW/2 - cx*zoom, y: viewH/2 - cy*zoom}`
8. Apply zoom and offset via refs and state

**Files:** `frontend/src/app-bundle.js`, `frontend/src/app.js`

---

## E. Multi-Select — Green Striped Highlight

**Problem:** Ctrl+click selected segments have no visual feedback.

**Solution:** New canvas layer `canvasSelectionRef` at zIndex 6 (above untagged, below loading overlay).

**Flow:**
1. On each Ctrl+click that modifies `selectedSegments`, fetch selection mask:
   `GET /api/selection-mask/{py}/{px}?ids=14,27,42`
2. Draw mask on `canvasSelectionRef` with green diagonal stripe pattern:
   - Create CanvasPattern from a small 8×8 canvas with 45° green (#00ff00) stripes, 2px wide, 4px gap
   - Use mask as clip path, fill with pattern at 50% opacity
3. Clear canvas when `selectedSegments` becomes empty or on patch change

**Canvas setup:**
```javascript
const canvasSelectionRef = useRef(null);
// ... in canvas stack, after canvasUntaggedRef:
// zIndex: 6, opacity: selectedSegments.length > 0 ? 0.5 : 0, pointerEvents: 'none'
```

**Files:** `frontend/src/app-bundle.js`, `frontend/src/app.js`, `backend/main.py`

---

## F. Tag Management (Navigator Header)

In the Tag Navigator header:

- **Color swatch** → clickable, opens native `<input type="color">` positioned near swatch. On change: `POST /api/recolor-tag`, refresh navigator + current patch segments.
- **Tag name** → double-click enters inline edit mode (input replaces h3). Enter saves via `POST /api/rename-tag`, Esc cancels. After rename: refresh tags, refresh navigator with new name.

**Files:** `frontend/src/app-bundle.js`, `frontend/src/app.js`

---

## G. Context Menu on Tags (ПКМ in TagsPanel)

Right-click on tag in TagsPanel → custom context menu:

| Item | Action |
|------|--------|
| 🔍 Найти на карте | Open Tag Navigator for this tag |
| ✏️ Переименовать | Inline rename (small modal with input + OK/Cancel) |
| 🎨 Сменить цвет | Open color picker |
| 🗑️ Удалить тег | Confirmation dialog → `POST /api/delete-tag` |

**Behavior:**
- Suppress native context menu (`e.preventDefault()` on `onContextMenu`)
- Position menu at cursor (`e.clientX`, `e.clientY`)
- Close on click outside, Esc, or any action
- After any mutation: refresh tags list + current patch

**State:**
- `contextMenu`: `{x, y, tagName, tagColor}` or `null`

**Files:** `frontend/src/app-bundle.js`, `frontend/src/app.js`, `frontend/src/styles/main.css`

---

## Files Summary

| File | Changes |
|------|---------|
| `frontend/package.json` | A (build files) |
| `frontend/src/app-bundle.js` | B, D, E, F, G (navigator, zoom, selection, tag mgmt, context menu) |
| `frontend/src/app.js` | B, D, E, F, G (same, keep in sync) |
| `frontend/src/styles/main.css` | B, G (navigator tree styles, context menu styles) |
| `backend/main.py` | C (7 endpoint changes: tag-locations modify, 6 new endpoints) |

## Out of Scope

- No changes to segmentation algorithm
- No changes to build scripts (build.sh / build.bat)
- No changes to bytenode/pyarmor obfuscation pipeline
