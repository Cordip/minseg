# UI Fixes & Features Design

## Date: 2026-03-13

## Overview

Eight UI improvements for the Mineral Segmentation editor: hotkey fixes, new features, a tag navigator panel, and multi-select tagging.

**Note:** The editor has two source files: `app.js` (source, uses ES imports) and `app-bundle.js` (bundled runtime, loaded by `app.html`). Both must be kept in sync. The bundled version uses an input-buffered hotkey system (200ms ticker, odd/even toggle counting). New keyboard features must integrate with this system.

## Changes

### 1. Fix Ctrl+'+' Zoom (bugfix)

**Problem:** Ctrl+'+' does not zoom in, while Ctrl+'-' works.

**Solution:** Handle Ctrl+= / Ctrl+- **outside** the buffer system (immediate, in the `keydown` listener), because zoom is multiplicative and stateful. Same pattern as wheel zoom.
- `Ctrl+=` / `Ctrl+Shift+=` (plus key) -> zoom * 1.2
- `Ctrl+-` -> zoom * 0.8
- `e.preventDefault()` to suppress browser zoom
- Zoom toward center of `viewer-panel` bounding rect
- Clamp zoom to [0.1, 10] range (existing limits)
- Update `zoomRef.current` and recalculate offset for center-of-viewport zoom

**Files:** `frontend/src/app.js`, `frontend/src/app-bundle.js`

### 2. Hotkey `U` for Untagged Segments

**Problem:** The untagged overlay toggle button exists, but has no keyboard shortcut.

**Note:** `showUntagged` state, the API call to `/api/untagged-mask`, and the canvas overlay rendering already exist. This item ONLY adds the `U` hotkey.

**Solution:** Wire `U` into the buffer system:
- Add `u: 0` to `keyBufferRef` initialization
- Add `else if (k === 'u') buf.u++` in the keydown handler
- In the ticker drain: `if (buf.u % 2 !== 0)` toggle `showUntagged` and trigger the API fetch when toggling on (same logic as the existing button onClick)

**Files:** `frontend/src/app.js`, `frontend/src/app-bundle.js`

### 3. Help Modal (`H` + `?` button)

**Solution:** Modal listing all hotkeys. Bypasses buffer system (immediate open/close) because the modal must suppress all other hotkeys while visible.

- Trigger: hotkey `H` (immediate in keydown, not buffered) or `?` button in toolbar (right side)
- Close: `Esc`, click outside, or `H` again
- While open: all other hotkeys suppressed (early return in keydown handler)
- Content — actual key-to-action mapping:

| Key | Action |
|-----|--------|
| `S` | Toggle segment boundaries (Границы) |
| `B` | Toggle colored segments (Сегменты) |
| `X` | Toggle 45/90 degree angle |
| `P` | Toggle PPL/XPL mode |
| `U` | Toggle untagged highlight |
| `H` | Show/hide this help |
| `Arrows` | Navigate between patches |
| `Ctrl+=` | Zoom in |
| `Ctrl+-` | Zoom out |

**Files:** `frontend/src/app.js`, `frontend/src/app-bundle.js`

### 4. Remove DevTools on Startup

**Problem:** Debug panel opens when app launches (main.js line 136).

**Solution:** Guard `openDevTools()`:
```javascript
if (process.argv.includes('--dev') || process.env.DEV === '1') {
    mainWindow.webContents.openDevTools();
}
```

**File:** `frontend/main.js`

### 5. Increase Stats Font Size

**Problem:** "Глобально: 0/24 (0%)" and "В этом квадрате: 0/0" text too small (currently 11px).

**Solution:** Increase `fontSize` from `'11px'` to `'15px'`, add `fontWeight: '500'`.

**Files:** `frontend/src/app.js`, `frontend/src/app-bundle.js` (two inline style objects near stats rendering)

### 6. Tag Navigator (click tag in right panel)

**Problem:** Clicking a tag in TagsPanel only shows a toast. No way to find where tags are used.

**Backend:** New endpoint `GET /api/tag-locations/{tag_name}`
- Iterates `state.segmentations`, finds patches where `segment_tags` contains `tag_name`
- Returns: `{"locations": [{patch_y, patch_x, segment_ids: [int], count: int}]}`

**Frontend:** `TagNavigator` popup component:
- Opens on tag click in `TagsPanel` (replaces current toast)
- Header: tag name + color swatch + close button
- Scrollable list of patches where tag is used
- Each item shows:
  - Patch coordinate label (e.g., "Патч 2,3")
  - Small thumbnail (fetch `/api/patch/{py}/{px}?image_type=...`, scale down client-side to ~100px)
  - Thumbnail updates when user toggles view mode (xpl/ppl 45/90) while navigator is open
  - "Go" icon-button: sets `currentPatch`, resets camera (zoom=1, offset={0,0}). If `showUntagged` is active, refreshes untagged mask for new patch.
  - "Edit" icon-button: opens `AnnotationModal` for the lowest segment_id with that tag in that specific patch. Modal opens blank (no pre-populated tag name).
- After tag reassignment via Edit: refresh navigator list (re-fetch `/api/tag-locations`)
- Closes on `Esc` or click outside

**Files:** `frontend/src/app.js`, `frontend/src/app-bundle.js`, `backend/main.py`

### 7. Esc Closes Annotation Modal Globally

**Problem:** Pressing `Esc` only closes the annotation modal when the tag input field is focused (onKeyDown on the input element). If focus is elsewhere, Esc does nothing.

**Solution:** Add global `Esc` handling in the `keydown` listener (immediate, not buffered):
- If `showAnnotationModal` is true and `Esc` is pressed, close the modal
- Uses `showAnnotationRef` to avoid stale closure (same pattern as help modal)
- Check annotation modal BEFORE help modal in priority order
- Existing input-level Esc handler remains as a fast path

**Files:** `frontend/src/app.js`, `frontend/src/app-bundle.js`

### 8. Ctrl+Click Multi-Select Segments

**Problem:** Only one segment can be selected at a time. Users want to select multiple segments and assign one tag to all at once.

**Frontend:**
- New state: `selectedSegments` array of `{id, patchY, patchX}` (replaces single `selectedSegment` for multi-select mode)
- `handleImageClick` modification:
  - If `Ctrl` held (`e.ctrlKey`): add/toggle segment in `selectedSegments` array
  - If no `Ctrl`: clear array, set single selection (existing behavior)
- Visual feedback: highlight all selected segments on canvas (re-use existing segment highlight approach)
- Annotation modal changes:
  - Header shows count when multi-select: "Тег для N сегментов"
  - `saveTag` iterates over all `selectedSegments`, posts `/api/label-segment` for each
  - After all saved, refresh segmentation overlay and tags

**Backend:** No new endpoints needed. Frontend calls existing `/api/label-segment` once per selected segment.

**Files:** `frontend/src/app.js`, `frontend/src/app-bundle.js`

## Files Summary

| File | Changes |
|------|---------|
| `frontend/src/app.js` | Items 1-3, 5-8 (source) |
| `frontend/src/app-bundle.js` | Items 1-3, 5-8 (bundled runtime) |
| `frontend/src/styles/main.css` | Items 3, 6 (new component styles) |
| `frontend/main.js` | Item 4 (DevTools guard) |
| `backend/main.py` | Item 6 (new endpoint) |

## Out of Scope

- No changes to segmentation algorithm
- No changes to build scripts
