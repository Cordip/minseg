# Tag Navigator v2, Multi-Select Highlight & Build Fix — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix asar source leakage, redesign tag navigator with hierarchical segments, add segment-focused previews/zoom, selection highlighting, and tag management.

**Architecture:** Backend gets 7 new/modified endpoints for segment bounds, previews, tag CRUD, and selection masks. Frontend replaces flat navigator with collapsible tree, adds selection canvas layer, context menu, and inline tag editing. Build config updated to exclude source files.

**Tech Stack:** React (createElement, no JSX), FastAPI, OpenCV/numpy, Electron

**Spec:** `docs/superpowers/specs/2026-03-13-navigator-v2-and-build-fix-design.md`

**Key codebase notes:**
- `app-bundle.js` is the runtime loaded by `app.html`. `app.js` is ES module source. Both must stay in sync.
- `app-bundle.js` uses input-buffered hotkey system with stale closures — refs required for values inside the ticker.
- `state.segmentations[(py,px)]` contains: `labels` (ndarray of segment IDs), `segment_tags` (dict), `colored_segments` (RGBA ndarray), `original_colors` (dict).
- `state.patches[image_type][(py,px)]` contains raw patch images (BGR ndarray).
- `state.tag_colors` is a flat dict `{tag_name: hex_color}`.
- Canvas stack: bg(z1) → bounds(z2) → segments(z3) → borders(z4) → untagged(z5) → loading(z6).
- Helper `hex_to_bgr()` at main.py:78, `image_to_base64()` at main.py:73.
- `drawOnCanvas(canvasRef, base64Data)` draws base64 PNG on a canvas ref.

---

## Task 1: Build Fix — Exclude Source from Asar

**Files:**
- Modify: `frontend/package.json:34-41`

- [ ] **Step 1: Update build.files array**

Replace lines 34-41:

```json
"files": [
  "main-entry.js",
  "preload.js",
  "src/app-bundle.js",
  "src/styles/**/*",
  "public/**/*",
  "**/*.jsc"
],
```

Removed: `main.js` (main-entry.js loads main.jsc), `src/**/*` wildcard (replaced with explicit app-bundle.js + styles).

- [ ] **Step 2: Commit**

```bash
git add frontend/package.json
git commit -m "fix: exclude source files from asar, keep only runtime files"
```

---

## Task 2: Backend — Modify tag-locations & Add Preview Endpoints

**Files:**
- Modify: `backend/main.py:343-364` (tag-locations, patch-thumbnail)

- [ ] **Step 1: Replace `/api/tag-locations/{tag_name}` (line 343-356)**

```python
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
```

- [ ] **Step 2: Add `/api/patch-tag-preview/{py}/{px}/{tag_name}` (after patch-thumbnail)**

```python
@app.get("/api/patch-tag-preview/{py}/{px}/{tag_name}")
async def get_patch_tag_preview(py: int, px: int, tag_name: str, image_type: str = "xpl45"):
    patch = state.patches.get(image_type, {}).get((py, px))
    seg_data = state.segmentations.get((py, px))
    if patch is None or seg_data is None:
        raise HTTPException(status_code=404)
    labels = seg_data['labels']
    seg_tags = seg_data.get('segment_tags', {})
    # Build mask of all segments with this tag
    tag_mask = np.zeros(labels.shape[:2], dtype=bool)
    for sid_str, tag in seg_tags.items():
        if tag == tag_name:
            tag_mask |= (labels == int(sid_str))
    # Create preview: darken non-tag pixels, tint tag pixels
    img = patch.copy().astype(np.float32)
    img[~tag_mask] *= 0.4
    # Tint tag pixels with tag color
    color_hex = state.tag_colors.get(tag_name, "#ffffff")
    b, g, r = hex_to_bgr(color_hex)
    overlay = np.zeros_like(img)
    overlay[tag_mask] = [b, g, r]
    img[tag_mask] = img[tag_mask] * 0.6 + overlay[tag_mask] * 0.4
    img = np.clip(img, 0, 255).astype(np.uint8)
    thumb = cv2.resize(img, (128, 128))
    return Response(content=cv2.imencode('.jpg', thumb)[1].tobytes(), media_type="image/jpeg")
```

- [ ] **Step 3: Add `/api/segment-preview/{py}/{px}/{segment_id}` (after patch-tag-preview)**

```python
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
    # Padding: 20% of bbox, min 16px
    h, w = y_max - y_min, x_max - x_min
    pad = max(16, int(max(h, w) * 0.2))
    y0 = max(0, y_min - pad)
    x0 = max(0, x_min - pad)
    y1 = min(patch.shape[0], y_max + pad)
    x1 = min(patch.shape[1], x_max + pad)
    crop = patch[y0:y1, x0:x1].copy().astype(np.float32)
    crop_mask = mask[y0:y1, x0:x1]
    # Darken non-segment, tint segment
    crop[~crop_mask] *= 0.4
    seg_tags = seg_data.get('segment_tags', {})
    tag = seg_tags.get(segment_id, seg_tags.get(str(segment_id)))
    color_hex = state.tag_colors.get(tag, "#ffffff") if tag else "#ffffff"
    b, g, r = hex_to_bgr(color_hex)
    overlay = np.zeros_like(crop)
    overlay[crop_mask] = [b, g, r]
    crop[crop_mask] = crop[crop_mask] * 0.6 + overlay[crop_mask] * 0.4
    crop = np.clip(crop, 0, 255).astype(np.uint8)
    # Scale so longest side = 96px
    ch, cw = crop.shape[:2]
    scale = 96 / max(ch, cw)
    thumb = cv2.resize(crop, (max(1, int(cw * scale)), max(1, int(ch * scale))))
    return Response(content=cv2.imencode('.jpg', thumb)[1].tobytes(), media_type="image/jpeg")
```

- [ ] **Step 4: Add `/api/selection-mask/{py}/{px}` (after segment-preview)**

```python
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
    # White pixels where selected, transparent elsewhere
    rgba = np.zeros((*labels.shape[:2], 4), dtype=np.uint8)
    rgba[mask] = [255, 255, 255, 255]
    return {"image": image_to_base64(rgba)}
```

- [ ] **Step 5: Commit**

```bash
git add backend/main.py
git commit -m "feat: add segment preview, tag preview, selection mask endpoints"
```

---

## Task 3: Backend — Tag CRUD Endpoints

**Files:**
- Modify: `backend/main.py` (add after `/api/tags` endpoint, line 341)

- [ ] **Step 1: Add Pydantic models**

After existing `SaveLabelRequest` model:

```python
class RenameTagRequest(BaseModel):
    old_name: str
    new_name: str

class RecolorTagRequest(BaseModel):
    tag_name: str
    new_color: str

class DeleteTagRequest(BaseModel):
    tag_name: str
```

- [ ] **Step 2: Add `/api/rename-tag`**

```python
@app.post("/api/rename-tag")
async def rename_tag(request: RenameTagRequest):
    if request.new_name in state.tag_colors and request.new_name != request.old_name:
        raise HTTPException(status_code=400, detail="Tag name already exists")
    # Update tag_colors
    color = state.tag_colors.pop(request.old_name, None)
    if color:
        state.tag_colors[request.new_name] = color
    # Update all segmentations
    for (py, px), seg_data in state.segmentations.items():
        seg_tags = seg_data.get('segment_tags', {})
        for sid, tag in list(seg_tags.items()):
            if tag == request.old_name:
                seg_tags[sid] = request.new_name
    # Update segment_colors cache
    for key, tag in list(state.segment_colors.items()):
        if tag == request.old_name:
            state.segment_colors[key] = request.new_name
    return {"status": "success"}
```

- [ ] **Step 3: Add `/api/recolor-tag`**

```python
@app.post("/api/recolor-tag")
async def recolor_tag(request: RecolorTagRequest):
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

- [ ] **Step 4: Add `/api/delete-tag`**

```python
@app.post("/api/delete-tag")
async def delete_tag(request: DeleteTagRequest):
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
    # Clean segment_colors cache
    for key, tag in list(state.segment_colors.items()):
        if tag == request.tag_name:
            del state.segment_colors[key]
    return {"status": "success"}
```

- [ ] **Step 5: Commit**

```bash
git add backend/main.py
git commit -m "feat: add rename, recolor, delete tag endpoints"
```

---

## Task 4: Frontend — Hierarchical Tag Navigator

**Files:**
- Modify: `frontend/src/app-bundle.js:41,630-702` (state, tag navigator render)
- Modify: `frontend/src/styles/main.css` (tree styles)

- [ ] **Step 1: Add `expandedPatches` state (after `tagNavData`, line 41)**

```javascript
const [expandedPatches, setExpandedPatches] = useState(new Set());
```

- [ ] **Step 2: Replace the tagNavData modal render (lines 650-702)**

Replace the entire `tagNavData && React.createElement(...)` block with the hierarchical version:

```javascript
tagNavData && React.createElement('div', {className:'modal-overlay', onClick:()=>{setTagNavData(null);setExpandedPatches(new Set());}},
    React.createElement('div', {className:'tag-navigator', onClick:e=>e.stopPropagation()},
        // Header with tag management
        React.createElement('div', {className:'tag-nav-header'},
            React.createElement('input', {
                type:'color', value: tagNavData.color,
                style:{width:'28px', height:'28px', border:'none', cursor:'pointer', background:'none', padding:0},
                onChange: (e) => {
                    const newColor = e.target.value;
                    api.post('/api/recolor-tag', {tag_name: tagNavData.name, new_color: newColor}).then(() => {
                        setTagNavData(prev => ({...prev, color: newColor}));
                        api.get('/api/tags').then(d => setTags(d.tag_colors || {}));
                        api.get(`/api/segmentation/${currentPatch.y}/${currentPatch.x}`).then(d => {
                            if (d.status === 'ready') drawOnCanvas(canvasSegRef, d.colored_segments);
                        });
                    });
                }
            }),
            React.createElement('h3', {
                style:{margin:0, cursor:'pointer', borderBottom:'1px dashed transparent'},
                title:'Двойной клик для переименования',
                onDoubleClick: (e) => {
                    const h3 = e.target;
                    const oldName = tagNavData.name;
                    const input = document.createElement('input');
                    input.value = oldName;
                    input.className = 'modal-input';
                    input.style.cssText = 'font-size:inherit;font-weight:inherit;margin:0;padding:2px 4px;width:120px;';
                    h3.replaceWith(input);
                    input.focus();
                    input.select();
                    const save = () => {
                        const newName = input.value.trim();
                        if (newName && newName !== oldName) {
                            api.post('/api/rename-tag', {old_name: oldName, new_name: newName}).then(() => {
                                setTagNavData(prev => ({...prev, name: newName}));
                                api.get('/api/tags').then(d => setTags(d.tag_colors || {}));
                            });
                        }
                        input.replaceWith(h3);
                    };
                    input.onkeydown = (ev) => { if (ev.key === 'Enter') save(); if (ev.key === 'Escape') input.replaceWith(h3); ev.stopPropagation(); };
                    input.onblur = save;
                }
            }, tagNavData.name),
            React.createElement('span', {style:{color:'#888', marginLeft:'auto', fontSize:'12px'}},
                tagNavData.locations.reduce((s, l) => s + l.count, 0) + ' сегм., ' + tagNavData.locations.length + ' патч.'
            ),
            React.createElement('button', {className:'btn btn-secondary', style:{marginLeft:'8px', padding:'2px 8px'}, onClick:()=>{setTagNavData(null);setExpandedPatches(new Set());}}, '×')
        ),
        // Tree list
        React.createElement('div', {className:'tag-nav-list'},
            tagNavData.locations.map(loc => {
                const pKey = `${loc.patch_y}-${loc.patch_x}`;
                const isExpanded = expandedPatches.has(pKey);
                return React.createElement('div', {key: pKey, className:'tag-nav-patch-group'},
                    // Patch row
                    React.createElement('div', {className:'tag-nav-item tag-nav-patch-row', onClick: () => {
                        setExpandedPatches(prev => {
                            const next = new Set(prev);
                            if (next.has(pKey)) next.delete(pKey); else next.add(pKey);
                            return next;
                        });
                    }},
                        React.createElement('span', {className:'tag-nav-expand'}, isExpanded ? '▼' : '▶'),
                        React.createElement('img', {
                            className:'tag-nav-thumb',
                            src: api ? `${api.baseUrl}/api/patch-tag-preview/${loc.patch_y}/${loc.patch_x}/${encodeURIComponent(tagNavData.name)}?image_type=${currentView}` : '',
                            alt: `Patch ${loc.patch_y},${loc.patch_x}`
                        }),
                        React.createElement('div', {className:'tag-nav-info'},
                            React.createElement('div', {style:{fontWeight:'500'}}, `Патч ${loc.patch_y+1}, ${loc.patch_x+1}`),
                            React.createElement('div', {style:{fontSize:'12px', color:'#888'}}, loc.count + ' сегм.')
                        ),
                        React.createElement('div', {className:'tag-nav-actions', onClick:e=>e.stopPropagation()},
                            React.createElement('button', {
                                className:'btn btn-secondary', style:{padding:'4px 8px', fontSize:'12px'},
                                title: 'Перейти к патчу',
                                onClick: () => {
                                    setCurrentPatch({y: loc.patch_y, x: loc.patch_x});
                                    zoomRef.current = 1; offsetRef.current = {x:0, y:0};
                                    setZoom(1); setOffset({x:0, y:0});
                                }
                            }, '📍'),
                            React.createElement('button', {
                                className:'btn btn-secondary', style:{padding:'4px 8px', fontSize:'12px', marginLeft:'4px'},
                                title: 'Изменить тег у всех в патче',
                                onClick: () => {
                                    setCurrentPatch({y: loc.patch_y, x: loc.patch_x});
                                    const allSegs = loc.segments.map(s => ({id: s.id, patchY: loc.patch_y, patchX: loc.patch_x}));
                                    setSelectedSegments(allSegs);
                                    setSelectedSegment({id: allSegs[0].id, tag: null});
                                    setShowAnnotationModal(true);
                                }
                            }, '✏️')
                        )
                    ),
                    // Expanded segment rows
                    isExpanded && loc.segments.map(seg =>
                        React.createElement('div', {key: seg.id, className:'tag-nav-item tag-nav-seg-row'},
                            React.createElement('img', {
                                className:'tag-nav-seg-thumb',
                                src: api ? `${api.baseUrl}/api/segment-preview/${loc.patch_y}/${loc.patch_x}/${seg.id}?image_type=${currentView}` : '',
                                alt: `Segment ${seg.id}`
                            }),
                            React.createElement('div', {className:'tag-nav-info'},
                                React.createElement('div', {style:{fontSize:'13px'}}, `#${seg.id}`)
                            ),
                            React.createElement('div', {className:'tag-nav-actions'},
                                React.createElement('button', {
                                    className:'btn btn-secondary', style:{padding:'3px 6px', fontSize:'11px'},
                                    title: 'Перейти к сегменту',
                                    onClick: () => {
                                        setCurrentPatch({y: loc.patch_y, x: loc.patch_x});
                                        // Zoom to segment: 75% of viewport
                                        const viewer = viewerRef.current;
                                        if (viewer && seg.bounds) {
                                            const vw = viewer.getBoundingClientRect().width;
                                            const vh = viewer.getBoundingClientRect().height;
                                            const sw = seg.bounds.x_max - seg.bounds.x_min;
                                            const sh = seg.bounds.y_max - seg.bounds.y_min;
                                            const z = Math.min(Math.max(0.5, Math.min(10, Math.min(vw/sw, vh/sh) * 0.75)), 10);
                                            const ox = vw/2 - seg.bounds.cx * z;
                                            const oy = vh/2 - seg.bounds.cy * z;
                                            zoomRef.current = z; offsetRef.current = {x:ox, y:oy};
                                            setZoom(z); setOffset({x:ox, y:oy});
                                        }
                                    }
                                }, '📍'),
                                React.createElement('button', {
                                    className:'btn btn-secondary', style:{padding:'3px 6px', fontSize:'11px', marginLeft:'4px'},
                                    title: 'Изменить тег',
                                    onClick: () => {
                                        setCurrentPatch({y: loc.patch_y, x: loc.patch_x});
                                        setSelectedSegments([]);
                                        setSelectedSegment({id: seg.id, tag: null});
                                        setShowAnnotationModal(true);
                                    }
                                }, '✏️')
                            )
                        )
                    )
                );
            }),
            tagNavData.locations.length === 0 && React.createElement('div', {style:{padding:'20px', textAlign:'center', color:'#666'}}, 'Тег не используется')
        )
    )
),
```

- [ ] **Step 3: Add CSS for tree structure in `main.css`**

Replace existing `.tag-nav-item` styles and add new ones:

```css
.tag-nav-patch-group {
    border-bottom: 1px solid rgba(255,255,255,0.05);
}
.tag-nav-patch-row {
    cursor: pointer;
}
.tag-nav-patch-row:hover {
    background: rgba(255,255,255,0.05);
}
.tag-nav-expand {
    font-size: 10px;
    width: 16px;
    text-align: center;
    color: #888;
    flex-shrink: 0;
}
.tag-nav-seg-row {
    padding-left: 32px;
    background: rgba(0,0,0,0.15);
}
.tag-nav-seg-row:hover {
    background: rgba(255,255,255,0.03);
}
.tag-nav-seg-thumb {
    width: 48px;
    height: 48px;
    border-radius: 3px;
    object-fit: cover;
    border: 1px solid #333;
}
```

- [ ] **Step 4: Add equivalent changes in `app.js`**

Add `expandedPatches` state and update the tag navigator render to match app-bundle.js hierarchy.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app-bundle.js frontend/src/app.js frontend/src/styles/main.css
git commit -m "feat: hierarchical tag navigator with segment tree and previews"
```

---

## Task 5: Frontend — Selection Canvas Layer (Green Stripes)

**Files:**
- Modify: `frontend/src/app-bundle.js` (canvas ref, canvas element, selection drawing)
- Modify: `frontend/src/app.js` (same)

- [ ] **Step 1: Add `canvasSelectionRef` (after `canvasUntaggedRef`, around line 22)**

```javascript
const canvasSelectionRef = useRef(null);
```

- [ ] **Step 2: Add canvas element after untagged layer (after line 625)**

```javascript
// Layer 6: Selection highlight (green stripes)
React.createElement('canvas', {
    ref: canvasSelectionRef,
    style: {
        position: 'absolute', top: 0, left: 0,
        opacity: selectedSegments.length > 0 ? 0.5 : 0,
        zIndex: 6, pointerEvents: 'none'
    }
}),
```

Update the loading overlay to zIndex 7:
```javascript
!patchReady && React.createElement('div', {style:{..., zIndex: 7}}, '⏳ Обработка...')
```

- [ ] **Step 3: Add selection drawing function and useEffect**

After `drawOnCanvas` helper:

```javascript
const drawSelectionStripes = (maskBase64) => {
    const canvas = canvasSelectionRef.current;
    if (!canvas || !maskBase64) return;
    const ctx = canvas.getContext('2d');
    const maskImg = new Image();
    maskImg.onload = () => {
        canvas.width = maskImg.width;
        canvas.height = maskImg.height;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        // Draw mask as clip
        ctx.drawImage(maskImg, 0, 0);
        ctx.globalCompositeOperation = 'source-in';
        // Create stripe pattern
        const patCanvas = document.createElement('canvas');
        patCanvas.width = 8; patCanvas.height = 8;
        const pc = patCanvas.getContext('2d');
        pc.strokeStyle = '#00ff00';
        pc.lineWidth = 2;
        pc.beginPath();
        pc.moveTo(0, 8); pc.lineTo(8, 0);
        pc.moveTo(-2, 2); pc.lineTo(2, -2);
        pc.moveTo(6, 10); pc.lineTo(10, 6);
        pc.stroke();
        const pattern = ctx.createPattern(patCanvas, 'repeat');
        ctx.fillStyle = pattern;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.globalCompositeOperation = 'source-over';
    };
    maskImg.src = 'data:image/png;base64,' + maskBase64;
};
```

- [ ] **Step 4: Add useEffect to refresh selection when selectedSegments changes**

```javascript
useEffect(() => {
    if (selectedSegments.length === 0) {
        const c = canvasSelectionRef.current;
        if (c) c.getContext('2d').clearRect(0, 0, c.width, c.height);
        return;
    }
    if (!api) return;
    const ids = selectedSegments.filter(s => s.patchY === currentPatch.y && s.patchX === currentPatch.x).map(s => s.id).join(',');
    if (!ids) return;
    api.get(`/api/selection-mask/${currentPatch.y}/${currentPatch.x}?ids=${ids}`).then(d => {
        drawSelectionStripes(d.image);
    }).catch(() => {});
}, [selectedSegments, currentPatch]);
```

Note: `currentPatch` in deps — uses stale closure, but this is in a new useEffect (not the `[gridSize]` ticker), so it gets the latest value.

- [ ] **Step 5: Add equivalent in `app.js`**

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app-bundle.js frontend/src/app.js
git commit -m "feat: green striped selection overlay for Ctrl+click multi-select"
```

---

## Task 6: Frontend — Context Menu on Tags

**Files:**
- Modify: `frontend/src/app-bundle.js` (state, TagsPanel, context menu render)
- Modify: `frontend/src/app.js` (same)
- Modify: `frontend/src/styles/main.css` (context menu styles)

- [ ] **Step 1: Add `contextMenu` state (after `expandedPatches`)**

```javascript
const [contextMenu, setContextMenu] = useState(null); // {x, y, tagName, tagColor}
```

- [ ] **Step 2: Add `onContextMenu` to tag items in TagsPanel (line 632)**

In the tag-item div, add:

```javascript
Object.entries(tags).map(([n, c]) => React.createElement('div', {key:n, className:'tag-item',
    onContextMenu: (e) => {
        e.preventDefault();
        setContextMenu({x: e.clientX, y: e.clientY, tagName: n, tagColor: c});
    }
},
    // ... existing children unchanged
))
```

- [ ] **Step 3: Add context menu render (before tagNavData modal)**

```javascript
contextMenu && React.createElement('div', {className:'context-menu-overlay', onClick:()=>setContextMenu(null)},
    React.createElement('div', {
        className:'context-menu',
        style:{left: contextMenu.x, top: contextMenu.y},
        onClick:e=>e.stopPropagation()
    },
        React.createElement('div', {className:'context-menu-item', onClick:() => {
            api.get(`/api/tag-locations/${encodeURIComponent(contextMenu.tagName)}`).then(d => {
                setTagNavData({name: contextMenu.tagName, color: contextMenu.tagColor, locations: d.locations});
            });
            setContextMenu(null);
        }}, '🔍 Найти на карте'),
        React.createElement('div', {className:'context-menu-item', onClick:() => {
            const oldName = contextMenu.tagName;
            const newName = prompt('Новое название тега:', oldName);
            if (newName && newName !== oldName) {
                api.post('/api/rename-tag', {old_name: oldName, new_name: newName}).then(() => {
                    api.get('/api/tags').then(d => setTags(d.tag_colors || {}));
                    api.get(`/api/segmentation/${currentPatch.y}/${currentPatch.x}`).then(d => {
                        if (d.status === 'ready') drawOnCanvas(canvasSegRef, d.colored_segments);
                    });
                });
            }
            setContextMenu(null);
        }}, '✏️ Переименовать'),
        React.createElement('div', {className:'context-menu-item', onClick:() => {
            const input = document.createElement('input');
            input.type = 'color';
            input.value = contextMenu.tagColor;
            input.addEventListener('input', (ev) => {
                api.post('/api/recolor-tag', {tag_name: contextMenu.tagName, new_color: ev.target.value}).then(() => {
                    api.get('/api/tags').then(d => setTags(d.tag_colors || {}));
                    api.get(`/api/segmentation/${currentPatch.y}/${currentPatch.x}`).then(d => {
                        if (d.status === 'ready') drawOnCanvas(canvasSegRef, d.colored_segments);
                    });
                });
            });
            input.click();
            setContextMenu(null);
        }}, '🎨 Сменить цвет'),
        React.createElement('div', {className:'context-menu-item context-menu-danger', onClick:() => {
            if (confirm(`Удалить тег "${contextMenu.tagName}"? Тег будет снят со всех сегментов.`)) {
                api.post('/api/delete-tag', {tag_name: contextMenu.tagName}).then(() => {
                    api.get('/api/tags').then(d => setTags(d.tag_colors || {}));
                    api.get(`/api/segmentation/${currentPatch.y}/${currentPatch.x}`).then(d => {
                        if (d.status === 'ready') {
                            setPatchStats({total: d.total_segs || 0, tagged: d.tagged_segs || 0});
                            drawOnCanvas(canvasSegRef, d.colored_segments);
                        }
                    });
                });
            }
            setContextMenu(null);
        }}, '🗑️ Удалить тег')
    )
),
```

- [ ] **Step 4: Add Esc handler for context menu**

In the keydown handler, add before the annotation modal Esc check:

```javascript
// Esc closes context menu
if (e.key === 'Escape' && contextMenu) {
    setContextMenu(null);
    return;
}
```

Note: `contextMenu` is stale in the `[gridSize]` useEffect. Add a ref:
```javascript
const contextMenuRef = useRef(null);
useEffect(() => { contextMenuRef.current = contextMenu; }, [contextMenu]);
```
Then use `contextMenuRef.current` in the keydown handler.

- [ ] **Step 5: Add CSS for context menu in `main.css`**

```css
.context-menu-overlay {
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    z-index: 2000;
}
.context-menu {
    position: fixed;
    background: var(--bg-secondary, #1e1e2e);
    border: 1px solid #444;
    border-radius: 6px;
    padding: 4px 0;
    min-width: 180px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.4);
    z-index: 2001;
}
.context-menu-item {
    padding: 8px 16px;
    cursor: pointer;
    font-size: 13px;
    color: #ddd;
}
.context-menu-item:hover {
    background: rgba(255,255,255,0.08);
}
.context-menu-danger {
    color: #e55;
}
.context-menu-danger:hover {
    background: rgba(255,50,50,0.15);
}
```

- [ ] **Step 6: Add equivalent in `app.js`**

- [ ] **Step 7: Commit**

```bash
git add frontend/src/app-bundle.js frontend/src/app.js frontend/src/styles/main.css
git commit -m "feat: right-click context menu for tags with rename/recolor/delete"
```

---

## Post-Implementation

- [ ] **Final test:** Launch app, verify all features
- [ ] **Build test:** Run build, extract asar, verify no source leakage
