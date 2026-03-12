# Tag Tree Panel Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace flat tag sidebar + popup modals with VS Code-like tree panel, inline quick-input, and full undo/redo.

**Architecture:** Backend Command Pattern undo/redo stack with 5 operation types. Frontend collapsible 3-level tree (Tag → Patch → Segment) in resizable sidebar. All tag assignment via inline quick-input, no modals. Multi-select at all levels with Ctrl/Shift+click.

**Tech Stack:** Python/FastAPI (backend), React.createElement without JSX (frontend), pytest-asyncio (tests)

**Spec:** `docs/superpowers/specs/2026-03-14-tag-tree-panel-design.md`

**Important notes:**
- Two frontend files must stay in sync: `app-bundle.js` (production monolithic) and `app.js` (component-based dev)
- Frontend uses `React.createElement` — no JSX
- Backend state is in-memory `AppState` singleton at `backend/main.py`
- Tests use `pytest-asyncio` with `asyncio_mode = "auto"` and httpx `AsyncClient`
- `state.segment_colors` maps `(py, px, seg_id)` tuple → tag name
- `state.segmentations[(py,px)]['segment_tags']` maps `seg_id` → tag name
- `state.segmentations[(py,px)]['colored_segments']` is RGBA overlay array
- `state.tag_colors` maps tag name → hex color

---

## Chunk 1: Backend — Undo/Redo + New Endpoints

### Task 1: Undo/Redo Infrastructure

**Files:**
- Modify: `backend/main.py:34-52` (AppState), `backend/main.py:65-70` (models)
- Modify: `backend/tests/conftest.py:9-26` (reset_state)
- Test: `backend/tests/test_undo_redo.py` (create)

- [ ] **Step 1: Add undo/redo fields to AppState**

In `backend/main.py`, add to `AppState.__init__` (after line 52):
```python
self.undo_stack: list = []   # max 200 operations
self.redo_stack: list = []
```

Remove the unused field (line 44):
```python
self.color_tags: Dict[str, str] = {}  # DELETE THIS LINE
```

- [ ] **Step 2: Add undo helper function**

In `backend/main.py`, add after AppState class (before endpoints, ~line 55):
```python
def _push_undo(op: dict):
    """Record an operation for undo. Clears redo stack."""
    state.undo_stack.append(op)
    if len(state.undo_stack) > 200:
        state.undo_stack.pop(0)
    state.redo_stack.clear()
```

- [ ] **Step 3: Add undo/redo execution functions**

In `backend/main.py`, after `_push_undo`:
```python
def _apply_label(patch_y, patch_x, segment_id, tag, color):
    """Apply or remove a tag from a segment. If tag is None, removes it."""
    seg_data = state.segmentations.get((patch_y, patch_x))
    if not seg_data:
        return
    if tag is None:
        seg_data['segment_tags'].pop(segment_id, None)
        mask = seg_data['labels'] == segment_id
        seg_data['colored_segments'][mask] = [0, 0, 0, 0]
        state.segment_colors.pop((patch_y, patch_x, segment_id), None)
    else:
        seg_data['segment_tags'][segment_id] = tag
        if color is None:
            color = state.tag_colors.get(tag, '#888888')
        b, g, r = hex_to_bgr(color)
        mask = seg_data['labels'] == segment_id
        seg_data['colored_segments'][mask] = [b, g, r, 180]
        state.segment_colors[(patch_y, patch_x, segment_id)] = tag
    seg_data['tagged_count'] = len(seg_data['segment_tags'])


def _execute_undo_op(op: dict):
    """Execute the reverse of an operation."""
    t = op['type']
    if t == 'label_segment':
        old_tag = op['old_tag']
        old_color = op.get('old_color')
        _apply_label(op['patch_y'], op['patch_x'], op['segment_id'], old_tag, old_color)
    elif t == 'batch_label':
        for entry in op['entries']:
            old_tag = entry['old_tag']
            old_color = entry.get('old_color')
            _apply_label(entry['patch_y'], entry['patch_x'], entry['segment_id'], old_tag, old_color)
    elif t == 'rename_tag':
        old_name, new_name = op['old_name'], op['new_name']
        color = state.tag_colors.pop(new_name, None)
        if color:
            state.tag_colors[old_name] = color
        for seg_data in state.segmentations.values():
            for sid, tag in list(seg_data.get('segment_tags', {}).items()):
                if tag == new_name:
                    seg_data['segment_tags'][sid] = old_name
        for key, tag in list(state.segment_colors.items()):
            if tag == new_name:
                state.segment_colors[key] = old_name
    elif t == 'recolor_tag':
        state.tag_colors[op['tag_name']] = op['old_color']
        b, g, r = hex_to_bgr(op['old_color'])
        for seg_data in state.segmentations.values():
            for sid, tag in seg_data.get('segment_tags', {}).items():
                if tag == op['tag_name']:
                    mask = seg_data['labels'] == int(sid)
                    seg_data['colored_segments'][mask] = [b, g, r, 180]
    elif t == 'delete_tag':
        state.tag_colors[op['tag_name']] = op['tag_color']
        b, g, r = hex_to_bgr(op['tag_color'])
        for entry in op['segments']:
            py, px, sid = entry['patch_y'], entry['patch_x'], entry['segment_id']
            seg_data = state.segmentations.get((py, px))
            if seg_data:
                seg_data['segment_tags'][sid] = op['tag_name']
                mask = seg_data['labels'] == sid
                seg_data['colored_segments'][mask] = [b, g, r, 180]
                seg_data['tagged_count'] = len(seg_data['segment_tags'])
                state.segment_colors[(py, px, sid)] = op['tag_name']


def _execute_redo_op(op: dict):
    """Re-execute a previously undone operation."""
    t = op['type']
    if t == 'label_segment':
        new_color = op.get('new_color')
        _apply_label(op['patch_y'], op['patch_x'], op['segment_id'], op['new_tag'], new_color)
        if op['new_tag'] and new_color:
            state.tag_colors[op['new_tag']] = new_color
    elif t == 'batch_label':
        color = op.get('color')
        if op['new_tag'] and color:
            state.tag_colors[op['new_tag']] = color
        for entry in op['entries']:
            _apply_label(entry['patch_y'], entry['patch_x'], entry['segment_id'], op['new_tag'], color)
    elif t == 'rename_tag':
        old_name, new_name = op['old_name'], op['new_name']
        color = state.tag_colors.pop(old_name, None)
        if color:
            state.tag_colors[new_name] = color
        for seg_data in state.segmentations.values():
            for sid, tag in list(seg_data.get('segment_tags', {}).items()):
                if tag == old_name:
                    seg_data['segment_tags'][sid] = new_name
        for key, tag in list(state.segment_colors.items()):
            if tag == old_name:
                state.segment_colors[key] = new_name
    elif t == 'recolor_tag':
        state.tag_colors[op['tag_name']] = op['new_color']
        b, g, r = hex_to_bgr(op['new_color'])
        for seg_data in state.segmentations.values():
            for sid, tag in seg_data.get('segment_tags', {}).items():
                if tag == op['tag_name']:
                    mask = seg_data['labels'] == int(sid)
                    seg_data['colored_segments'][mask] = [b, g, r, 180]
    elif t == 'delete_tag':
        state.tag_colors.pop(op['tag_name'], None)
        for entry in op['segments']:
            py, px, sid = entry['patch_y'], entry['patch_x'], entry['segment_id']
            seg_data = state.segmentations.get((py, px))
            if seg_data:
                seg_data['segment_tags'].pop(sid, None)
                mask = seg_data['labels'] == sid
                seg_data['colored_segments'][mask] = [0, 0, 0, 0]
                seg_data['tagged_count'] = len(seg_data['segment_tags'])
                state.segment_colors.pop((py, px, sid), None)
```

- [ ] **Step 4: Add undo/redo/status endpoints**

In `backend/main.py`, add after the helper functions:
```python
@app.post("/api/undo")
async def undo():
    if not state.undo_stack:
        return {"status": "nothing_to_undo"}
    op = state.undo_stack.pop()
    _execute_undo_op(op)
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
    _execute_redo_op(op)
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
```

- [ ] **Step 5: Update conftest.py**

In `backend/tests/conftest.py`, modify `reset_state` fixture:
- Add: `state.undo_stack = []` and `state.redo_stack = []`
- Remove: `state.color_tags = {}`

- [ ] **Step 6: Write tests for undo/redo infrastructure**

Create `backend/tests/test_undo_redo.py`:
```python
import pytest
from main import state

class TestUndoRedo:
    async def test_undo_empty_stack(self, client):
        r = await client.post("/api/undo")
        assert r.json()["status"] == "nothing_to_undo"

    async def test_redo_empty_stack(self, client):
        r = await client.post("/api/redo")
        assert r.json()["status"] == "nothing_to_redo"

    async def test_undo_status_empty(self, client):
        r = await client.get("/api/undo-status")
        d = r.json()
        assert d["can_undo"] is False
        assert d["can_redo"] is False

    async def test_label_then_undo(self, client, setup_segmented_patch):
        # Label segment 2
        r = await client.post("/api/label-segment", json={
            "patch_y": 0, "patch_x": 0, "segment_id": 2,
            "tag": "Quartz", "color": "#e8a838"
        })
        assert r.json()["status"] == "success"
        assert state.segmentations[(0, 0)]['segment_tags'][2] == "Quartz"

        # Undo
        r = await client.post("/api/undo")
        assert r.json()["status"] == "success"
        assert 2 not in state.segmentations[(0, 0)]['segment_tags']

        # Redo
        r = await client.post("/api/redo")
        assert r.json()["status"] == "success"
        assert state.segmentations[(0, 0)]['segment_tags'][2] == "Quartz"

    async def test_rename_then_undo(self, client, setup_segmented_patch):
        # Label first
        await client.post("/api/label-segment", json={
            "patch_y": 0, "patch_x": 0, "segment_id": 2,
            "tag": "Quartz", "color": "#e8a838"
        })
        # Rename
        await client.post("/api/rename-tag", json={
            "old_name": "Quartz", "new_name": "Feldspar"
        })
        assert state.segmentations[(0, 0)]['segment_tags'][2] == "Feldspar"
        assert "Feldspar" in state.tag_colors

        # Undo rename
        await client.post("/api/undo")
        assert state.segmentations[(0, 0)]['segment_tags'][2] == "Quartz"
        assert "Quartz" in state.tag_colors
        assert "Feldspar" not in state.tag_colors

    async def test_recolor_then_undo(self, client, setup_segmented_patch):
        await client.post("/api/label-segment", json={
            "patch_y": 0, "patch_x": 0, "segment_id": 2,
            "tag": "Quartz", "color": "#e8a838"
        })
        await client.post("/api/recolor-tag", json={
            "tag_name": "Quartz", "new_color": "#ff0000"
        })
        assert state.tag_colors["Quartz"] == "#ff0000"

        await client.post("/api/undo")
        assert state.tag_colors["Quartz"] == "#e8a838"

    async def test_delete_then_undo(self, client, setup_segmented_patch):
        await client.post("/api/label-segment", json={
            "patch_y": 0, "patch_x": 0, "segment_id": 2,
            "tag": "Quartz", "color": "#e8a838"
        })
        await client.post("/api/delete-tag", json={"tag_name": "Quartz"})
        assert "Quartz" not in state.tag_colors
        assert 2 not in state.segmentations[(0, 0)]['segment_tags']
        assert (0, 0, 2) not in state.segment_colors

        await client.post("/api/undo")
        assert "Quartz" in state.tag_colors
        assert state.segmentations[(0, 0)]['segment_tags'][2] == "Quartz"
        assert state.segment_colors[(0, 0, 2)] == "Quartz"

    async def test_undo_stack_limit(self, client, setup_segmented_patch):
        for i in range(210):
            state.undo_stack.append({"type": "recolor_tag", "tag_name": "t", "old_color": "#000", "new_color": "#fff"})
        assert len(state.undo_stack) == 210
        # Push one more through the helper
        await client.post("/api/label-segment", json={
            "patch_y": 0, "patch_x": 0, "segment_id": 2,
            "tag": "Test", "color": "#000000"
        })
        # Stack should be trimmed
        assert len(state.undo_stack) <= 200

    async def test_new_action_clears_redo(self, client, setup_segmented_patch):
        await client.post("/api/label-segment", json={
            "patch_y": 0, "patch_x": 0, "segment_id": 2,
            "tag": "A", "color": "#111111"
        })
        await client.post("/api/undo")
        assert len(state.redo_stack) == 1

        # New action clears redo
        await client.post("/api/label-segment", json={
            "patch_y": 0, "patch_x": 0, "segment_id": 3,
            "tag": "B", "color": "#222222"
        })
        assert len(state.redo_stack) == 0
```

- [ ] **Step 7: Run tests**

Run: `cd backend && uv run pytest tests/test_undo_redo.py -v`
Expected: all tests pass

- [ ] **Step 8: Commit**

```bash
git add backend/main.py backend/tests/conftest.py backend/tests/test_undo_redo.py
git commit -m "feat: add undo/redo infrastructure with Command Pattern"
```

---

### Task 2: Record Undo in Existing Endpoints

**Files:**
- Modify: `backend/main.py:401-468` (label_segment, rename_tag, recolor_tag, delete_tag)
- Test: `backend/tests/test_undo_redo.py` (tests from Task 1 validate this)

- [ ] **Step 1: Modify label_segment endpoint**

Replace `backend/main.py:401-412` with:
```python
@app.post("/api/label-segment")
async def label_segment(request: SaveLabelRequest):
    seg_data = state.segmentations.get((request.patch_y, request.patch_x))
    if not seg_data: raise HTTPException(status_code=404)
    old_tag = seg_data['segment_tags'].get(request.segment_id)
    old_color = state.tag_colors.get(old_tag) if old_tag else None
    _push_undo({
        "type": "label_segment",
        "patch_y": request.patch_y, "patch_x": request.patch_x,
        "segment_id": request.segment_id,
        "old_tag": old_tag, "old_color": old_color,
        "new_tag": request.tag, "new_color": request.color,
        "description": f"tag #{request.segment_id} as {request.tag}",
    })
    seg_data['segment_tags'][request.segment_id] = request.tag
    seg_data['tagged_count'] = len(seg_data['segment_tags'])
    state.tag_colors[request.tag] = request.color
    mask = seg_data['labels'] == request.segment_id
    b, g, r = hex_to_bgr(request.color)
    seg_data['colored_segments'][mask] = [b, g, r, 180]
    state.segment_colors[(request.patch_y, request.patch_x, request.segment_id)] = request.tag
    return {"status": "success"}
```

- [ ] **Step 2: Modify rename_tag endpoint**

Replace `backend/main.py:418-433` with:
```python
@app.post("/api/rename-tag")
async def rename_tag(request: RenameTagRequest):
    if request.new_name in state.tag_colors and request.new_name != request.old_name:
        raise HTTPException(status_code=400, detail="Tag name already exists")
    _push_undo({
        "type": "rename_tag",
        "old_name": request.old_name, "new_name": request.new_name,
        "description": f"rename {request.old_name} → {request.new_name}",
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
```

- [ ] **Step 3: Modify recolor_tag endpoint**

Replace `backend/main.py:435-449` with:
```python
@app.post("/api/recolor-tag")
async def recolor_tag(request: RecolorTagRequest):
    old_color = state.tag_colors.get(request.tag_name)
    _push_undo({
        "type": "recolor_tag",
        "tag_name": request.tag_name,
        "old_color": old_color, "new_color": request.new_color,
        "description": f"recolor {request.tag_name}",
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
```

- [ ] **Step 4: Modify delete_tag endpoint**

Replace `backend/main.py:451-468` with:
```python
@app.post("/api/delete-tag")
async def delete_tag(request: DeleteTagRequest):
    tag_color = state.tag_colors.get(request.tag_name)
    segments = []
    for (py, px), seg_data in state.segmentations.items():
        seg_tags = seg_data.get('segment_tags', {})
        for sid_str, tag in list(seg_tags.items()):
            if tag == request.tag_name:
                segments.append({"patch_y": py, "patch_x": px, "segment_id": int(sid_str)})
    _push_undo({
        "type": "delete_tag",
        "tag_name": request.tag_name,
        "tag_color": tag_color,
        "segments": segments,
        "description": f"delete tag {request.tag_name} ({len(segments)} segments)",
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
```

- [ ] **Step 5: Run all tests**

Run: `cd backend && uv run pytest tests/ -v`
Expected: all tests pass (existing + new undo tests)

- [ ] **Step 6: Commit**

```bash
git add backend/main.py
git commit -m "feat: record undo operations in all tag mutation endpoints"
```

---

### Task 3: Tag Tree Endpoint

**Files:**
- Modify: `backend/main.py` (add endpoint)
- Test: `backend/tests/test_tag_tree.py` (create)

- [ ] **Step 1: Write tests**

Create `backend/tests/test_tag_tree.py`:
```python
import pytest
from main import state

class TestTagTree:
    async def test_empty_tree(self, client):
        r = await client.get("/api/tag-tree")
        assert r.json()["tags"] == []

    async def test_tree_with_tags(self, client, setup_segmented_patch):
        # Label segments
        await client.post("/api/label-segment", json={
            "patch_y": 0, "patch_x": 0, "segment_id": 2,
            "tag": "Quartz", "color": "#e8a838"
        })
        await client.post("/api/label-segment", json={
            "patch_y": 0, "patch_x": 0, "segment_id": 3,
            "tag": "Quartz", "color": "#e8a838"
        })
        r = await client.get("/api/tag-tree")
        tags = r.json()["tags"]
        assert len(tags) == 1
        assert tags[0]["name"] == "Quartz"
        assert tags[0]["color"] == "#e8a838"
        assert tags[0]["total_segments"] == 2
        assert len(tags[0]["patches"]) == 1
        assert tags[0]["patches"][0]["patch_y"] == 0
        assert tags[0]["patches"][0]["patch_x"] == 0
        assert tags[0]["patches"][0]["count"] == 2
        assert set(tags[0]["patches"][0]["segments"]) == {2, 3}

    async def test_tree_multiple_tags(self, client, setup_segmented_patch):
        await client.post("/api/label-segment", json={
            "patch_y": 0, "patch_x": 0, "segment_id": 2,
            "tag": "Quartz", "color": "#e8a838"
        })
        await client.post("/api/label-segment", json={
            "patch_y": 0, "patch_x": 0, "segment_id": 3,
            "tag": "Biotite", "color": "#d35d6e"
        })
        r = await client.get("/api/tag-tree")
        tags = r.json()["tags"]
        assert len(tags) == 2
        names = {t["name"] for t in tags}
        assert names == {"Quartz", "Biotite"}
```

- [ ] **Step 2: Implement tag-tree endpoint**

In `backend/main.py`, add after `get_tags` endpoint:
```python
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
```

- [ ] **Step 3: Run tests**

Run: `cd backend && uv run pytest tests/test_tag_tree.py -v`
Expected: all pass

- [ ] **Step 4: Commit**

```bash
git add backend/main.py backend/tests/test_tag_tree.py
git commit -m "feat: add GET /api/tag-tree endpoint"
```

---

### Task 4: Batch Label Endpoint

**Files:**
- Modify: `backend/main.py` (add model + endpoint)
- Test: `backend/tests/test_tag_tree.py` (add tests)

- [ ] **Step 1: Write tests**

Add to `backend/tests/test_tag_tree.py`:
```python
class TestBatchLabel:
    async def test_batch_label(self, client, setup_segmented_patch):
        r = await client.post("/api/batch-label", json={
            "tag_name": "Quartz", "color": "#e8a838",
            "segments": [
                {"patch_y": 0, "patch_x": 0, "segment_id": 2},
                {"patch_y": 0, "patch_x": 0, "segment_id": 3},
            ]
        })
        assert r.json()["status"] == "success"
        assert state.segmentations[(0, 0)]['segment_tags'][2] == "Quartz"
        assert state.segmentations[(0, 0)]['segment_tags'][3] == "Quartz"

    async def test_batch_label_undo(self, client, setup_segmented_patch):
        # Label seg 2 first
        await client.post("/api/label-segment", json={
            "patch_y": 0, "patch_x": 0, "segment_id": 2,
            "tag": "Biotite", "color": "#d35d6e"
        })
        # Batch label both as Quartz
        await client.post("/api/batch-label", json={
            "tag_name": "Quartz", "color": "#e8a838",
            "segments": [
                {"patch_y": 0, "patch_x": 0, "segment_id": 2},
                {"patch_y": 0, "patch_x": 0, "segment_id": 3},
            ]
        })
        # Undo batch — seg 2 goes back to Biotite, seg 3 back to untagged
        await client.post("/api/undo")
        assert state.segmentations[(0, 0)]['segment_tags'][2] == "Biotite"
        assert 3 not in state.segmentations[(0, 0)]['segment_tags']

    async def test_batch_label_undo_redo(self, client, setup_segmented_patch):
        await client.post("/api/batch-label", json={
            "tag_name": "Quartz", "color": "#e8a838",
            "segments": [
                {"patch_y": 0, "patch_x": 0, "segment_id": 2},
                {"patch_y": 0, "patch_x": 0, "segment_id": 3},
            ]
        })
        await client.post("/api/undo")
        assert 2 not in state.segmentations[(0, 0)]['segment_tags']
        assert 3 not in state.segmentations[(0, 0)]['segment_tags']
        await client.post("/api/redo")
        assert state.segmentations[(0, 0)]['segment_tags'][2] == "Quartz"
        assert state.segmentations[(0, 0)]['segment_tags'][3] == "Quartz"

    async def test_batch_label_null_color(self, client, setup_segmented_patch):
        state.tag_colors["Quartz"] = "#e8a838"
        r = await client.post("/api/batch-label", json={
            "tag_name": "Quartz", "color": None,
            "segments": [{"patch_y": 0, "patch_x": 0, "segment_id": 2}]
        })
        assert r.json()["status"] == "success"
```

- [ ] **Step 2: Add BatchLabelRequest model and endpoint**

In `backend/main.py`, add the model (near other models):
```python
class BatchLabelSegment(BaseModel):
    patch_y: int
    patch_x: int
    segment_id: int

class BatchLabelRequest(BaseModel):
    tag_name: str
    color: str | None = None
    segments: list[BatchLabelSegment]
```

Add the endpoint:
```python
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
    _push_undo({
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
```

- [ ] **Step 3: Add untag-segments endpoint**

This endpoint removes tags from specific segments (used by context menu delete at patch/segment level).

```python
class UntagRequest(BaseModel):
    segments: list[BatchLabelSegment]

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
    _push_undo({
        "type": "batch_label",
        "new_tag": None, "color": None,
        "entries": entries,
        "description": f"untag {len(entries)} segments",
    })
    for seg in request.segments:
        _apply_label(seg.patch_y, seg.patch_x, seg.segment_id, None, None)
    return {"status": "success"}
```

Add a test:
```python
    async def test_untag_segments(self, client, setup_segmented_patch):
        await client.post("/api/label-segment", json={
            "patch_y": 0, "patch_x": 0, "segment_id": 2,
            "tag": "Quartz", "color": "#e8a838"
        })
        r = await client.post("/api/untag-segments", json={
            "segments": [{"patch_y": 0, "patch_x": 0, "segment_id": 2}]
        })
        assert r.json()["status"] == "success"
        assert 2 not in state.segmentations[(0, 0)]['segment_tags']
        # Undo restores
        await client.post("/api/undo")
        assert state.segmentations[(0, 0)]['segment_tags'][2] == "Quartz"
```

- [ ] **Step 4: Run all tests**

Run: `cd backend && uv run pytest tests/ -v`
Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add backend/main.py backend/tests/test_tag_tree.py
git commit -m "feat: add POST /api/batch-label and POST /api/untag-segments endpoints"
```

---

## Chunk 2: Frontend — Tree Panel + Quick Input

### Task 5: CSS — Tree Styles, Remove Navigator Styles

**Files:**
- Modify: `frontend/src/styles/main.css:373-436` (tags panel), `783-860` (navigator)

- [ ] **Step 1: Replace .tags-panel width and add tree styles**

In `frontend/src/styles/main.css`:

Change `.tags-panel` (line 373) `width: 300px` → `width: 400px; min-width: 250px; max-width: 600px; position: relative;`

Add new styles after `.tag-count` (after line 436):
```css
/* Resize handle */
.sidebar-resize {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 4px;
    cursor: col-resize;
    background: transparent;
    z-index: 10;
}
.sidebar-resize:hover, .sidebar-resize.active {
    background: var(--accent-primary);
}

/* Tree nodes */
.tree-node {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 8px;
    cursor: pointer;
    user-select: none;
    font-size: 13px;
    border-radius: 3px;
}
.tree-node:hover {
    background: rgba(255,255,255,0.05);
}
.tree-node.selected {
    background: rgba(74, 158, 255, 0.2);
}
.tree-node-arrow {
    width: 16px;
    text-align: center;
    font-size: 10px;
    color: var(--text-secondary);
    flex-shrink: 0;
}
.tree-node-color {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    flex-shrink: 0;
}
.tree-node-label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.tree-node-count {
    font-size: 11px;
    color: var(--text-secondary);
}
.tree-level-1 { padding-left: 8px; }
.tree-level-2 { padding-left: 28px; }
.tree-level-3 { padding-left: 48px; }

/* Quick input */
.quick-input {
    padding: 8px 12px;
    background: var(--bg-tertiary);
    border-bottom: 1px solid var(--border-color);
}
.quick-input-label {
    font-size: 11px;
    color: var(--accent-primary);
    margin-bottom: 4px;
}
.quick-input input {
    width: 100%;
    background: var(--bg-secondary);
    border: 1px solid var(--accent-primary);
    border-radius: 4px;
    padding: 6px 8px;
    color: var(--text-primary);
    font-size: 13px;
    outline: none;
}
.quick-input-hint {
    font-size: 11px;
    color: var(--text-secondary);
    margin-top: 4px;
}
.quick-input-suggestions {
    max-height: 200px;
    overflow-y: auto;
}
.quick-input-suggestion {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 8px;
    cursor: pointer;
    border-radius: 4px;
    font-size: 13px;
}
.quick-input-suggestion:hover, .quick-input-suggestion.highlighted {
    background: rgba(74, 158, 255, 0.2);
}
```

- [ ] **Step 2: Remove .tag-navigator styles**

Delete lines 783-860 of `main.css` (the entire `.tag-navigator`, `.tag-nav-header`, `.tag-nav-list`, `.tag-nav-item`, `.tag-nav-patch-group`, `.tag-nav-patch-row`, `.tag-nav-expand`, `.tag-nav-seg-row`, `.tag-nav-thumb`, `.tag-nav-seg-thumb` block).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/styles/main.css
git commit -m "feat: add tree panel CSS, remove tag navigator styles"
```

---

### Task 6: Tree Panel Rendering (app-bundle.js)

**Files:**
- Modify: `frontend/src/app-bundle.js:51-61` (state), `753-777` (tags panel render)

This is the largest frontend task. It replaces the flat tag list with a collapsible tree.

- [ ] **Step 1: Add new state variables**

In `frontend/src/app-bundle.js`, replace/add near the state declarations (lines 51-61):

Add after existing state:
```javascript
const [treeData, setTreeData] = useState([]);
const [expandedNodes, setExpandedNodes] = useState(new Set());
const [treeSelection, setTreeSelection] = useState(new Set());
const [lastTreeClick, setLastTreeClick] = useState(null);
const [quickInput, setQuickInput] = useState(null); // {patchY, patchX, segmentId, value}
const [quickFilter, setQuickFilter] = useState('');
const [quickHighlight, setQuickHighlight] = useState(0);
const [canUndo, setCanUndo] = useState(false);
const [canRedo, setCanRedo] = useState(false);
const [sidebarWidth, setSidebarWidth] = useState(400);
const [zoomToSegment, setZoomToSegment] = useState(null); // segment ID to zoom to after patch load
const quickInputRef = useRef(null);
// Russian plural for "сегмент": 1→сегмент, 2-4→сегмента, 5+→сегментов (handles 11-14)
const pluralSeg = (n) => { const m=n%100, d=n%10; return d===1&&m!==11?'сегмент':d>=2&&d<=4&&(m<12||m>14)?'сегмента':'сегментов'; };
```

Remove these state declarations:
```javascript
// DELETE: const [tagNavData, setTagNavData] = useState(null);
// DELETE: const [showAnnotationModal, setShowAnnotationModal] = useState(false);
// DELETE: const [selectedSegment, setSelectedSegment] = useState(null);
// DELETE: const [segmentDarkColor, setSegmentDarkColor] = useState(null);
// DELETE: const [segmentOriginalColor, setSegmentOriginalColor] = useState(null);
// DELETE: const [expandedPatches, setExpandedPatches] = useState(new Set());
```

- [ ] **Step 2: Add tree data fetching**

Add a `fetchTree` function and useEffect:
```javascript
const fetchTree = useCallback(() => {
    if (!api) return;
    api.get('/api/tag-tree').then(d => setTreeData(d.tags || [])).catch(() => {});
    api.get('/api/undo-status').then(d => {
        setCanUndo(d.can_undo);
        setCanRedo(d.can_redo);
    }).catch(() => {});
}, [api]);

useEffect(() => {
    if (api && imagesAligned) fetchTree();
}, [api, imagesAligned, fetchTree]);
```

- [ ] **Step 3: Add quick-input handlers**

```javascript
const applyTag = useCallback((tagName) => {
    if (!tagName.trim() || !api) return;
    const color = tags[tagName] || tagColor(tagName);
    if (selectedSegments.length > 0) {
        api.post('/api/batch-label', {
            tag_name: tagName, color,
            segments: selectedSegments.map(s => ({patch_y: s.patchY, patch_x: s.patchX, segment_id: s.id}))
        }).then(() => {
            setSelectedSegments([]);
            setQuickInput(null);
            setQuickFilter('');
            fetchTree();
            loadSegmentationData();
            api.get('/api/tags').then(d => setTags(d.tag_colors || {}));
        });
    } else if (quickInput) {
        api.post('/api/label-segment', {
            patch_y: quickInput.patchY, patch_x: quickInput.patchX,
            segment_id: quickInput.segmentId, tag: tagName, color
        }).then(() => {
            setQuickInput(null);
            setQuickFilter('');
            fetchTree();
            loadSegmentationData();
            api.get('/api/tags').then(d => setTags(d.tag_colors || {}));
        });
    }
}, [api, quickInput, selectedSegments, tags, fetchTree, loadSegmentationData]);
```

- [ ] **Step 4: Add undo/redo handlers**

```javascript
const handleUndo = useCallback(() => {
    if (!api || !canUndo) return;
    api.post('/api/undo').then(d => {
        setCanUndo(d.can_undo);
        setCanRedo(d.can_redo);
        fetchTree();
        loadSegmentationData();
        api.get('/api/tags').then(t => setTags(t.tag_colors || {}));
    });
}, [api, canUndo, fetchTree, loadSegmentationData]);

const handleRedo = useCallback(() => {
    if (!api || !canRedo) return;
    api.post('/api/redo').then(d => {
        setCanUndo(d.can_undo);
        setCanRedo(d.can_redo);
        fetchTree();
        loadSegmentationData();
        api.get('/api/tags').then(t => setTags(t.tag_colors || {}));
    });
}, [api, canRedo, fetchTree, loadSegmentationData]);
```

- [ ] **Step 5: Add Ctrl+Z/Y to keyboard handler**

In the existing keyboard handler (handleKeyDown), add before other shortcuts:
```javascript
if (e.ctrlKey && e.key === 'z') { e.preventDefault(); handleUndo(); return; }
if (e.ctrlKey && e.key === 'y') { e.preventDefault(); handleRedo(); return; }
if (e.key === 'Escape') { setQuickInput(null); setQuickFilter(''); setSelectedSegments([]); setTreeSelection(new Set()); return; }
if (e.key === 'Enter' && selectedSegments.length > 0 && !quickInputRef.current?.matches(':focus')) {
    e.preventDefault(); setTimeout(() => quickInputRef.current?.focus(), 50); return;
}
```

- [ ] **Step 6: Replace tags panel rendering**

Replace the tags-panel section (lines 753-777) with the tree rendering. The tree panel should be a `div` with `style: {width: sidebarWidth + 'px'}` and className `tags-panel`.

The tree panel structure:
```javascript
// Tags panel with tree
React.createElement('div', {className: 'tags-panel', style: {width: sidebarWidth + 'px'}},
    // Resize handle
    React.createElement('div', {className: 'sidebar-resize', onMouseDown: startResize}),
    // Header
    React.createElement('div', {className: 'tags-header'},
        React.createElement('span', null, 'Теги минералов ', React.createElement('span', {style:{color:'#888',fontWeight:400}}, `(${treeData.length})`)),
        React.createElement('div', {style:{display:'flex',gap:'4px'}},
            React.createElement('button', {className:'btn btn-secondary', style:{padding:'2px 6px',fontSize:'11px',opacity:canUndo?1:0.3}, onClick:handleUndo, disabled:!canUndo, title:'Undo (Ctrl+Z)'}, '↩'),
            React.createElement('button', {className:'btn btn-secondary', style:{padding:'2px 6px',fontSize:'11px',opacity:canRedo?1:0.3}, onClick:handleRedo, disabled:!canRedo, title:'Redo (Ctrl+Y)'}, '↪')
        )
    ),
    // Quick input
    (quickInput || selectedSegments.length > 0) && React.createElement('div', {className:'quick-input'},
        // Russian plural helper: 1→сегмент, 2-4→сегмента, 5+→сегментов (handles 11-14 exception)
        // const pluralSeg = (n) => { const m=n%100, d=n%10; return d===1&&m!==11?'сегмент':d>=2&&d<=4&&(m<12||m>14)?'сегмента':'сегментов'; };
        React.createElement('div', {className:'quick-input-label'},
            selectedSegments.length > 0
                ? `Выбрано: ${selectedSegments.length} ${pluralSeg(selectedSegments.length)}`
                : quickInput ? `Сегмент #${quickInput.segmentId} · Патч ${quickInput.patchY},${quickInput.patchX}` : ''
        ),
        React.createElement('input', {
            ref: quickInputRef,
            placeholder: 'Название минерала...',
            value: quickFilter,
            onChange: e => { setQuickFilter(e.target.value); setQuickHighlight(0); },
            onKeyDown: e => {
                if (e.key === 'Enter') {
                    const filtered = Object.keys(tags).filter(n => n.toLowerCase().includes(quickFilter.toLowerCase()));
                    const chosen = filtered[quickHighlight] || quickFilter;
                    if (chosen.trim()) applyTag(chosen);
                } else if (e.key === 'Escape') {
                    setQuickInput(null); setQuickFilter(''); setSelectedSegments([]);
                } else if (e.key === 'ArrowDown') {
                    e.preventDefault(); setQuickHighlight(h => h + 1);
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault(); setQuickHighlight(h => Math.max(0, h - 1));
                } else if (e.key === 'Tab') {
                    e.preventDefault();
                    const filtered = Object.keys(tags).filter(n => n.toLowerCase().includes(quickFilter.toLowerCase()));
                    if (filtered[quickHighlight]) setQuickFilter(filtered[quickHighlight]);
                }
            }
        }),
        React.createElement('div', {className:'quick-input-hint'}, 'Enter — применить · Esc — отмена'),
        quickFilter && React.createElement('div', {className:'quick-input-suggestions'},
            Object.entries(tags).filter(([n]) => n.toLowerCase().includes(quickFilter.toLowerCase())).slice(0, 8).map(([n, c], i) =>
                React.createElement('div', {
                    key: n,
                    className: 'quick-input-suggestion' + (i === quickHighlight ? ' highlighted' : ''),
                    onClick: () => applyTag(n)
                },
                    React.createElement('span', {style:{width:12,height:12,borderRadius:'50%',background:c,display:'inline-block'}}),
                    React.createElement('span', null, n)
                )
            )
        ),
        selectedSegments.length > 1 && !quickInputRef.current?.matches(':focus') && React.createElement('button', {
            className:'btn btn-primary', style:{marginTop:'4px',width:'100%',padding:'4px'},
            onClick: () => quickInputRef.current?.focus()
        }, 'Задать тег')
    ),
    // Tree
    React.createElement('div', {className:'tags-list'},
        treeData.map(tag => React.createElement(React.Fragment, {key: tag.name},
            // Level 1: Tag
            React.createElement('div', {
                className: 'tree-node tree-level-1' + (treeSelection.has('tag:'+tag.name) ? ' selected' : ''),
                onContextMenu: e => { e.preventDefault(); setContextMenu({x:e.clientX,y:e.clientY,tagName:tag.name,tagColor:tag.color,level:'tag'}); }
            },
                React.createElement('span', {className:'tree-node-arrow', onClick: e => {
                    e.stopPropagation();
                    setExpandedNodes(prev => {
                        const next = new Set(prev);
                        const key = 'tag:'+tag.name;
                        next.has(key) ? next.delete(key) : next.add(key);
                        return next;
                    });
                }}, expandedNodes.has('tag:'+tag.name) ? '▼' : '▶'),
                React.createElement('span', {className:'tree-node-color', style:{backgroundColor:tag.color}}),
                React.createElement('span', {className:'tree-node-label'}, tag.name),
                React.createElement('span', {className:'tree-node-count'}, tag.total_segments)
            ),
            // Level 2: Patches (if expanded)
            expandedNodes.has('tag:'+tag.name) && tag.patches.map(patch =>
                React.createElement(React.Fragment, {key:`${patch.patch_y},${patch.patch_x}`},
                    React.createElement('div', {
                        className: 'tree-node tree-level-2',
                        onClick: () => { setCurrentPatch({y:patch.patch_y, x:patch.patch_x}); setPatchReady(false); },
                        onContextMenu: e => { e.preventDefault(); setContextMenu({x:e.clientX,y:e.clientY,tagName:tag.name,tagColor:tag.color,level:'patch',patchY:patch.patch_y,patchX:patch.patch_x}); }
                    },
                        React.createElement('span', {className:'tree-node-arrow', onClick: e => {
                            e.stopPropagation();
                            setExpandedNodes(prev => {
                                const next = new Set(prev);
                                const key = `patch:${tag.name}:${patch.patch_y},${patch.patch_x}`;
                                next.has(key) ? next.delete(key) : next.add(key);
                                return next;
                            });
                        }}, expandedNodes.has(`patch:${tag.name}:${patch.patch_y},${patch.patch_x}`) ? '▼' : '▶'),
                        React.createElement('span', {className:'tree-node-label'}, `Патч ${patch.patch_y},${patch.patch_x}`),
                        React.createElement('span', {className:'tree-node-count'}, patch.count)
                    ),
                    // Level 3: Segments
                    expandedNodes.has(`patch:${tag.name}:${patch.patch_y},${patch.patch_x}`) && patch.segments.map(sid =>
                        React.createElement('div', {
                            key: sid,
                            className: 'tree-node tree-level-3' + (treeSelection.has(`seg:${patch.patch_y},${patch.patch_x}:${sid}`) ? ' selected' : ''),
                            onClick: () => {
                                setCurrentPatch({y:patch.patch_y, x:patch.patch_x});
                                setPatchReady(false);
                                // TODO: after patch loads, zoom/pan canvas to segment bounding box
                                // Store target segment for post-load zoom
                                setZoomToSegment(sid);
                            },
                            onContextMenu: e => { e.preventDefault(); setContextMenu({x:e.clientX,y:e.clientY,tagName:tag.name,tagColor:tag.color,level:'segment',patchY:patch.patch_y,patchX:patch.patch_x,segmentId:sid}); }
                        },
                            React.createElement('span', {className:'tree-node-label', style:{color:'#aaa'}}, `#${sid}`)
                        )
                    )
                )
            )
        ))
    )
)
```

- [ ] **Step 7: Remove Tag Navigator modal rendering**

Delete lines 876-1017 (the `tagNavData &&` block that renders the tag navigator popup).

- [ ] **Step 8: Remove Annotation modal rendering**

Delete lines 1046-1101 (the `showAnnotationModal &&` block) and lines 1102-1124 (multi-select indicator at bottom).

- [ ] **Step 9: Modify canvas click handler**

Replace `handleImageClick` (lines 508-554):
- Normal click → set `quickInput` instead of `setShowAnnotationModal(true)`
- Ctrl+click → toggle in `selectedSegments` (keep existing logic)

```javascript
// In the click handler, after getting segment info:
if (e.ctrlKey) {
    setSelectedSegments(prev => {
        const exists = prev.find(s => s.id === r.segment_id);
        if (exists) return prev.filter(s => s.id !== r.segment_id);
        return [...prev, {id: r.segment_id, patchY: currentPatch.y, patchX: currentPatch.x}];
    });
    return;
}
// Normal click:
setSelectedSegments([]);
setQuickInput({patchY: currentPatch.y, patchX: currentPatch.x, segmentId: r.segment_id});
setQuickFilter(r.tag || '');
setTimeout(() => quickInputRef.current?.focus(), 50);
```

- [ ] **Step 10: Cross-patch selection and segment zoom**

**Cross-patch selection:** Ensure that `setCurrentPatch` and `setPatchReady` do NOT clear `selectedSegments`. Verify existing patch navigation code doesn't reset the array. If it does, remove that reset. The `selectedSegments` array stores `{id, patchY, patchX}` per segment, so it inherently supports cross-patch data.

**Segment zoom:** Add a `useEffect` that runs when `zoomToSegment` is set and the patch finishes loading (patchReady becomes true):
```javascript
useEffect(() => {
    if (zoomToSegment && patchReady) {
        // Compute bounding box of the segment from labels data
        const seg_data = segmentationData; // current patch's segmentation data
        if (seg_data && seg_data.labels) {
            // Find min/max row/col where labels === zoomToSegment
            // Pan and zoom the canvas to center on the bounding box
            // Implementation depends on canvas zoom/pan API already in use
        }
        setZoomToSegment(null);
    }
}, [zoomToSegment, patchReady]);
```
The exact bounding-box computation depends on how `segmentationData.labels` is accessible client-side. If labels aren't available client-side, add a `GET /api/segment-bbox?patch_y=Y&patch_x=X&segment_id=ID` backend endpoint that returns `{min_row, min_col, max_row, max_col}`.

- [ ] **Step 11: Test manually in dev mode**

Run: `cd frontend && npm start` (or `just backend` + open app)
Verify: tree renders, tags expandable, quick-input appears on segment click, undo/redo buttons work

- [ ] **Step 12: Commit**

```bash
git add frontend/src/app-bundle.js
git commit -m "feat: replace flat tag list with tree panel + quick-input in app-bundle.js"
```

---

### Task 7: Mirror Changes to app.js

**Files:**
- Modify: `frontend/src/app.js`

- [ ] **Step 1: Mirror all state, handler, and render changes from Task 6 into app.js**

Apply the same logic using the component-based architecture:
- Add new state variables to the App component
- Add `fetchTree`, `applyTag`, `handleUndo`, `handleRedo` functions
- Replace `TagsPanel` component with `TreePanel` component
- Remove `AnnotationModal` component usage
- Update `handleImageClick` in the App component
- Add Ctrl+Z/Y to keyboard handler

- [ ] **Step 2: Test manually**

Verify app.js works identically to app-bundle.js

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app.js
git commit -m "feat: mirror tree panel changes to app.js"
```

---

### Task 8: Resizable Sidebar

**Files:**
- Modify: `frontend/src/app-bundle.js`, `frontend/src/app.js`

- [ ] **Step 1: Add resize handler**

In both files, add the resize handler:
```javascript
const startResize = useCallback((e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebarWidth;
    const onMove = (e2) => {
        const newWidth = Math.max(250, Math.min(600, startWidth - (e2.clientX - startX)));
        setSidebarWidth(newWidth);
    };
    const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
}, [sidebarWidth]);
```

The resize handle is already in the tree panel rendering from Task 6.

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app-bundle.js frontend/src/app.js
git commit -m "feat: add resizable sidebar"
```

---

## Chunk 3: Frontend — Multi-select, Context Menu, Polish

### Task 9: Multi-select in Tree

**Files:**
- Modify: `frontend/src/app-bundle.js`, `frontend/src/app.js`

- [ ] **Step 1: Add tree node click handlers with Ctrl/Shift support**

Update tree node click handlers in the tree rendering to support:
- Normal click on tag/patch/segment → navigate (existing)
- Ctrl+click → toggle in `treeSelection`
- Shift+click → select range using `lastTreeClick`

Helper to flatten tree into ordered keys for Shift+click range:
```javascript
const flattenTreeKeys = useCallback(() => {
    const keys = [];
    treeData.forEach(tag => {
        keys.push('tag:' + tag.name);
        if (expandedNodes.has('tag:' + tag.name)) {
            tag.patches.forEach(p => {
                keys.push(`patch:${tag.name}:${p.patch_y},${p.patch_x}`);
                if (expandedNodes.has(`patch:${tag.name}:${p.patch_y},${p.patch_x}`)) {
                    p.segments.forEach(sid => keys.push(`seg:${p.patch_y},${p.patch_x}:${sid}`));
                }
            });
        }
    });
    return keys;
}, [treeData, expandedNodes]);
```

Helper to resolve tree selection to child segment keys (selecting a tag selects all its segments, selecting a patch selects all its segments under that tag):
```javascript
const resolveTreeSelection = useCallback((selection) => {
    const resolved = new Set();
    selection.forEach(key => {
        if (key.startsWith('tag:')) {
            const tagName = key.slice(4);
            const tag = treeData.find(t => t.name === tagName);
            if (tag) tag.patches.forEach(p => p.segments.forEach(sid => resolved.add(`seg:${p.patch_y},${p.patch_x}:${sid}`)));
        } else if (key.startsWith('patch:')) {
            const parts = key.split(':');
            const tagName = parts[1];
            const [py, px] = parts[2].split(',').map(Number);
            const tag = treeData.find(t => t.name === tagName);
            if (tag) {
                const patch = tag.patches.find(p => p.patch_y === py && p.patch_x === px);
                if (patch) patch.segments.forEach(sid => resolved.add(`seg:${py},${px}:${sid}`));
            }
        } else {
            resolved.add(key);
        }
    });
    return resolved;
}, [treeData]);
```

Tree node click handler:
```javascript
const handleTreeClick = useCallback((e, nodeKey) => {
    if (e.ctrlKey) {
        setTreeSelection(prev => {
            const next = new Set(prev);
            next.has(nodeKey) ? next.delete(nodeKey) : next.add(nodeKey);
            return next;
        });
        setLastTreeClick(nodeKey);
    } else if (e.shiftKey && lastTreeClick) {
        const keys = flattenTreeKeys();
        const a = keys.indexOf(lastTreeClick);
        const b = keys.indexOf(nodeKey);
        if (a >= 0 && b >= 0) {
            const [start, end] = a < b ? [a, b] : [b, a];
            setTreeSelection(new Set(keys.slice(start, end + 1)));
        }
    } else {
        setTreeSelection(new Set());
        setLastTreeClick(nodeKey);
    }
}, [lastTreeClick, flattenTreeKeys]);
```

Update tree node `onClick` to call `handleTreeClick` for Ctrl/Shift, keep navigation for normal click.

**Important:** Use `resolveTreeSelection(treeSelection)` in context menu actions to get the full set of resolved segment keys when performing batch operations on a multi-selection.

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app-bundle.js frontend/src/app.js
git commit -m "feat: add multi-select in tree with Ctrl/Shift+click"
```

---

### Task 10: Context Menu Updates

**Files:**
- Modify: `frontend/src/app-bundle.js:780-874`, `frontend/src/app.js`

- [ ] **Step 1: Update context menu for tree levels and multi-select**

Replace the context menu rendering (lines 780-874) with a new version that handles three modes:

**A) Multi-select context menu** (when `treeSelection.size > 0`):
- Header: `"Выбрано: N элементов (M сегментов)"` — use `resolveTreeSelection(treeSelection).size` for M
- "Назначить тег" → resolve all selected to segment keys, collect `{patchY, patchX, segmentId}` from keys, set them as `selectedSegments`, open quick-input, focus it
- "Сменить цвет" → color input, for each unique tag in selection call `POST /api/recolor-tag`
- "Удалить тег" → confirmation, for each unique tag in selection call `POST /api/delete-tag`
- After any mutation: `fetchTree(); loadSegmentationData(); api.get('/api/tags').then(d => setTags(d.tag_colors || {}));`

**B) Single element context menu** — actions differ by `contextMenu.level`:

| Action | Tag level | Patch level | Segment level |
|--------|-----------|-------------|---------------|
| Переименовать | `prompt()` → `POST /api/rename-tag` | Collect segment IDs for tag+patch from `treeData`, set as `selectedSegments`, open quick-input for re-tagging (uses `POST /api/batch-label`) | Set single segment as `quickInput` for re-tagging (uses `POST /api/label-segment`) |
| Сменить цвет | Color input → `POST /api/recolor-tag` | Same (tag-level recolor) | Same (tag-level recolor) |
| Перейти | — | `setCurrentPatch({y:patchY,x:patchX})` | `setCurrentPatch({y:patchY,x:patchX}); setZoomToSegment(segmentId);` |
| Удалить тег | Confirmation → `POST /api/delete-tag` (removes tag globally) | Confirmation → `POST /api/untag-segments` with segments list (untags only these segments) | Confirmation → `POST /api/untag-segments` with single segment |

After any mutation: `fetchTree(); loadSegmentationData(); api.get('/api/tags').then(d => setTags(d.tag_colors || {}));`

- [ ] **Step 2: Add delete confirmation state**

```javascript
const [deleteConfirm, setDeleteConfirm] = useState(null); // {tagName, count}
```

In the context menu delete action, set `deleteConfirm` instead of immediately deleting. Show inline confirmation:
```javascript
deleteConfirm && React.createElement('div', {style:{padding:'8px',background:'#2a2020',border:'1px solid #5a3030',borderRadius:'6px',margin:'4px 8px'}},
    React.createElement('div', {style:{color:'#ff6b6b',marginBottom:'4px'}}, `Удалить "${deleteConfirm.tagName}" (${deleteConfirm.count} сегм.)?`),
    React.createElement('div', {style:{display:'flex',gap:'8px'}},
        React.createElement('button', {className:'btn', style:{background:'#ff4444',color:'#fff',padding:'4px 12px'}, onClick:() => {
            api.post('/api/delete-tag', {tag_name: deleteConfirm.tagName}).then(() => {
                setDeleteConfirm(null); setContextMenu(null); fetchTree();
                loadSegmentationData(); api.get('/api/tags').then(d => setTags(d.tag_colors || {}));
            });
        }}, 'Удалить'),
        React.createElement('button', {className:'btn btn-secondary', style:{padding:'4px 12px'}, onClick:()=>setDeleteConfirm(null)}, 'Отмена')
    )
)
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app-bundle.js frontend/src/app.js
git commit -m "feat: update context menu for tree levels with delete confirmation"
```

---

### Task 11: Final Cleanup and Testing

**Files:**
- Modify: `frontend/src/app-bundle.js`, `frontend/src/app.js`

- [ ] **Step 1: Remove all dead code**

Search and remove any remaining references to:
- `tagNavData`, `setTagNavData`
- `showAnnotationModal`, `setShowAnnotationModal`
- `selectedSegment`, `setSelectedSegment` (single, not `selectedSegments`)
- `segmentDarkColor`, `setSegmentDarkColor`
- `segmentOriginalColor`, `setSegmentOriginalColor`
- `expandedPatches`, `setExpandedPatches`
- `showAnnotationRef`
- Tag navigator search button (`🔍`)
- Any `tag-navigator` CSS class references
- `saveTag` function (if it existed for annotation modal)

- [ ] **Step 2: Run all backend tests**

Run: `cd backend && uv run pytest tests/ -v`
Expected: all pass

- [ ] **Step 3: Test full flow manually**

1. Start app: `just backend` or dev mode
2. Load images, open editor
3. Click segment on canvas → quick-input appears with auto-focus
4. Type tag name → suggestions filter → Enter → applied
5. Tree shows tag → expand → patches → segments
6. Ctrl+Z → undo works
7. Right-click tag → rename/recolor/delete all work
8. Ctrl+click segments on canvas → multi-select → Enter → batch tag
9. Resize sidebar drag handle works

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app-bundle.js frontend/src/app.js frontend/src/styles/main.css
git commit -m "chore: remove dead code from old tag panel"
```

- [ ] **Step 5: Run all tests final check**

Run: `cd backend && uv run pytest tests/ -v`
Expected: all pass
