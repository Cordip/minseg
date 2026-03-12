# Tag Tree Panel — Design Spec

## Goal

Replace the flat tag list sidebar + popup Tag Navigator modal with a VS Code-like tree panel. All tag management happens in the sidebar — no modals blocking the canvas view. Full undo/redo support for all tag operations.

## Architecture

The sidebar becomes a 3-level collapsible tree (Tag → Patch → Segment) with inline tag assignment, multi-selection at all levels, context menu actions, and a backend-driven undo/redo stack using the Command Pattern.

## What Changes

### Removed
- **Tag Navigator modal** (`tagNavData` popup) — replaced by tree navigation in sidebar
- **Annotation modal** (`showAnnotationModal` popup) — replaced by inline quick-input in sidebar
- **`color_tags` field** in `AppState` — unused inverse mapping, remove during refactor

### Modified
- **Sidebar** — from flat tag list (300px) to resizable tree panel (400px default)
- **Existing tag API endpoints** — each mutation (`label-segment`, `rename-tag`, `recolor-tag`, `delete-tag`) records an operation on the undo stack before executing

### Added
- **Tree rendering** in sidebar with 3 collapsible levels
- **Quick-input** field for inline tag assignment
- **Undo/redo** backend stack + frontend keybindings
- **New API endpoints** for undo, redo, tree data, batch labeling

---

## Sidebar Structure

### Layout (top to bottom)

1. **Header bar**: "Теги минералов (N)" + undo/redo buttons (↩ ↪)
2. **Quick-input area** (visible only when segment(s) selected): segment info + text input with autocomplete + filtered tag suggestions
3. **Tree area** (scrollable): collapsible 3-level tree

### Sizing
- Default width: **400px**
- Resizable via drag-handle on left edge (CSS `resize` or mousedown drag)
- Minimum width: 250px, maximum: 600px

### Tree Levels

```
▼ Кварц (47)                    ← Level 1: Tag
  ▼ Патч 0,0 (12)               ← Level 2: Patch
    #523                         ← Level 3: Segment
    #107
    #89
  ▶ Патч 1,2 (8)
▶ Плагиоклаз (23)
▶ Биотит (5)
```

- **All collapsed by default** — looks like a flat list until user expands
- **▶/▼ arrow** toggles expand/collapse only (no navigation)
- **Rest of the row** click: navigates camera to that patch/segment
- **Counters** on each level: total segment count for that node

---

## Interaction Flows

### Flow 1: Single Tagging (click on canvas, no modifier)

1. Click segment on canvas
2. Segment highlights on canvas
3. Sidebar shows quick-input with auto-focus: `"Сегмент #523 · Патч 0,0"` + text field
4. User types → filtered list of existing tags appears below input (substring match, max 8 suggestions, arrow keys to navigate, Tab/Enter to select)
5. Click existing tag OR type new name + Enter → **immediately applied**, no confirmation
6. Quick-input hides, tree updates
7. Esc → cancel, quick-input hides

### Flow 2: Multi-select on Canvas (Ctrl+click)

1. Ctrl+click segments — each toggles in/out of selection (current patch only — canvas shows one patch at a time)
2. Navigating to another patch preserves existing selection; Ctrl+click on new patch adds to it (cross-patch selection supported)
3. Sidebar shows: `"Выбрано: N сегментов"` with input field inactive
4. Enter or "Задать тег" button → activates input field
5. Type/select tag → Enter → applied to all selected segments (uses `POST /api/batch-label`)
6. Selection clears

### Flow 3: Multi-select in Tree (Ctrl/Shift+click in sidebar)

1. **Ctrl+click**: toggle individual items at any level (tags, patches, segments)
2. **Shift+click**: select range from last clicked to current in linear tree order
3. Selecting a tag = selecting all its segments; selecting a patch = selecting all its segments under that tag
4. Right-click → context menu with actions for all selected

### Flow 4: Navigation from Tree

- **Click on patch row** (not arrow): camera jumps to that patch
- **Click on segment row**: camera jumps to patch + zooms/pans to segment bounding box

---

## Context Menu (Right-click)

### Single Element

| Action | Level 1 (Tag) | Level 2 (Patch) | Level 3 (Segment) |
|--------|--------------|-----------------|-------------------|
| ✏️ Переименовать | Rename tag globally — `rename_tag` undo op | Reassign all segments in this patch to new tag — `batch_label` undo op | Reassign this segment to new tag — `label_segment` undo op |
| 🎨 Сменить цвет | Change tag color | Change tag color | Change tag color |
| 📍 Перейти | — | Navigate to patch | Navigate to segment |
| 🗑️ Удалить тег | Remove tag from all segments (confirmation) | Remove tag from segments in this patch (confirmation) | Remove tag from this segment (confirmation) |

### Multi-select Context Menu

Shows at top: `"Выбрано: N элементов (M сегментов)"`

Actions:
- ✏️ Назначить тег → input field, applies to all resolved segments
- 🎨 Сменить цвет → color picker, applies to tags of selected items
- 🗑️ Удалить тег → confirmation dialog, removes tags from all resolved segments

### Delete Confirmation

Inline confirmation in context menu area:
```
Удалить тег "Кварц" у 47 сегментов?
[Удалить] [Отмена]
```

---

## Undo/Redo System

### Architecture: Backend Command Pattern

Two lists on `AppState`:
```python
undo_stack: list[dict] = []   # operations that can be undone (max 200)
redo_stack: list[dict] = []   # operations that were undone
```

Stack size limit: **200 operations**. Oldest entries are dropped when the limit is exceeded. This is sufficient for a session — state is ephemeral and lost on restart anyway.

Every mutating tag operation:
1. Records the operation with rollback data onto `undo_stack`
2. Clears `redo_stack` (new action invalidates redo history)
3. Executes the mutation (including updating `segment_tags`, `tag_colors`, `segment_colors`, `colored_segments` overlay, `tagged_count`)

**Important:** All undo/redo operations must maintain consistency across all related data structures: `segment_tags`, `tag_colors`, `segment_colors`, `colored_segments` RGBA overlay, and cached `seg_count`/`tagged_count`.

### Operation Types

| Type | Stored Data | Undo Action |
|------|------------|-------------|
| `label_segment` | patch, segment_id, old_tag, new_tag | Restore old_tag (or remove if null) + repaint colored_segments overlay + update segment_colors |
| `batch_label` | entries: [{patch, segment_id, old_tag}], new_tag | Restore each segment's old_tag + repaint each segment's overlay + update segment_colors |
| `rename_tag` | old_name, new_name | Rename back in segment_tags, tag_colors, segment_colors |
| `recolor_tag` | tag_name, old_color, new_color | Restore old_color in tag_colors |
| `delete_tag` | tag_name, tag_color, segments: [{patch, segment_id}] | Recreate tag in tag_colors + reassign all segment_tags + repaint colored_segments overlays + restore segment_colors entries |

### Undo Flow

1. User presses Ctrl+Z → frontend calls `POST /api/undo`
2. Backend pops from `undo_stack`, executes reverse action, pushes to `redo_stack`
3. Returns `{status, type, description, can_undo, can_redo}`
4. Frontend refreshes tree + canvas overlays

### Redo Flow

Same but `POST /api/redo`, pops from `redo_stack`, pushes to `undo_stack`.

---

## New API Endpoints

### `POST /api/undo`
- Undoes the last operation
- Returns: `{status: "success"|"nothing_to_undo", type: str, description: str, can_undo: bool, can_redo: bool}`

### `POST /api/redo`
- Redoes the last undone operation
- Returns: same shape as undo

### `GET /api/undo-status`
- Returns: `{can_undo: bool, can_redo: bool, undo_count: int, redo_count: int}`

### `GET /api/tag-tree`
- Returns the full tree structure for sidebar rendering
- Built by iterating `state.segmentations` and grouping by `segment_tags` — no extra storage needed
- For typical images (24 patches, ~50 tags, ~500 segments), response is <50KB — acceptable without pagination
- Response:
```json
{
  "tags": [
    {
      "name": "Кварц",
      "color": "#e8a838",
      "total_segments": 47,
      "patches": [
        {
          "patch_y": 0,
          "patch_x": 0,
          "count": 12,
          "segments": [523, 107, 89, 45]
        }
      ]
    }
  ]
}
```

### `POST /api/batch-label`
- Assigns a tag to multiple segments at once (single undo operation)
- Body: `{tag_name: str, color: str|null, segments: [{patch_y, patch_x, segment_id}]}`
- If `color` is null and tag exists, backend uses `state.tag_colors[tag_name]`
- If `color` is provided and tag is new, backend creates it in `state.tag_colors`
- Records one `batch_label` operation on undo stack

### Modified Existing Endpoints

All existing mutation endpoints now record operations on the undo stack:
- `POST /api/label-segment` → records `label_segment`
- `POST /api/rename-tag` → records `rename_tag`
- `POST /api/recolor-tag` → records `recolor_tag`
- `POST /api/delete-tag` → records `delete_tag`

---

## Frontend Changes

### State Changes

**Remove:**
- `tagNavData` — no more popup navigator
- `showAnnotationModal`, `selectedSegment`, `segmentDarkColor`, `segmentOriginalColor` — no more annotation modal

**Add:**
- `treeData` — tag tree from `/api/tag-tree`
- `expandedNodes` — Set of expanded node keys (`"tag:Кварц"`, `"patch:Кварц:0,0"`)
- `treeSelection` — Set of selected node keys for multi-select
- `lastTreeClick` — last clicked node key (for Shift+click range)
- `quickInput` — `{visible, patchY, patchX, segmentId, value}` or null
- `canUndo`, `canRedo` — from undo-status
- `sidebarWidth` — persisted sidebar width

**Modify:**
- `selectedSegments` — remains for canvas multi-select, feeds into tree selection

### Keyboard Shortcuts

- `Ctrl+Z` → `POST /api/undo` + refresh
- `Ctrl+Y` → `POST /api/redo` + refresh
- `Esc` → close quick-input / clear selection
- `Enter` (when multi-selected) → activate quick-input

### Canvas Click Handler Changes

- **Click** (no modifier): set `quickInput` with segment info, auto-focus input
- **Ctrl+Click**: toggle segment in `selectedSegments` (no auto-focus)
- Remove: `setShowAnnotationModal(true)` call

---

## Data Flow

```
Canvas click → quickInput visible → type/select tag
                                          ↓
                              POST /api/label-segment
                              (records undo op)
                                          ↓
                              GET /api/tag-tree → update treeData
                              GET /api/undo-status → update canUndo/canRedo
                              Refresh canvas overlays
```

```
Ctrl+Z → POST /api/undo → backend rolls back
                                ↓
                   GET /api/tag-tree → update treeData
                   Refresh canvas overlays
```

---

## File Changes Summary

### Backend (`backend/main.py`)
- Add `undo_stack: list` and `redo_stack: list` to `AppState`
- Add helper functions: `_push_undo()`, `_execute_undo()`, `_execute_redo()`
- Add endpoints: `/api/undo`, `/api/redo`, `/api/undo-status`, `/api/tag-tree`, `/api/batch-label`
- Modify: `/api/label-segment`, `/api/rename-tag`, `/api/recolor-tag`, `/api/delete-tag` to record operations

### Frontend (`frontend/src/app-bundle.js`, `frontend/src/app.js`)
- Remove: Tag Navigator modal rendering, Annotation modal rendering
- Add: Tree component rendering, quick-input component, resize handle
- Modify: canvas click handler, keyboard shortcuts, polling (include undo-status)

### Tests (`backend/tests/`)
- Add: `test_undo_redo.py` — undo/redo for all 5 operation types
- Add: `test_tag_tree.py` — tree endpoint, batch label
- Modify: `conftest.py` — reset `state.undo_stack = []`, `state.redo_stack = []`; remove `state.color_tags`

### CSS (`frontend/src/styles/main.css`)
- Remove: `.tag-navigator` styles
- Add: tree node styles, quick-input styles, resize handle styles
