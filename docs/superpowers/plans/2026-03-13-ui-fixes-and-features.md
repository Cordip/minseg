# UI Fixes & Features Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix hotkey bugs, add help modal, tag navigator, multi-select tagging, and polish stats UI.

**Architecture:** All UI changes in `app-bundle.js` (runtime) and `app.js` (source). New backend endpoints for tag locations and thumbnails. CSS additions in `main.css`.

**Tech Stack:** React (createElement, no JSX), FastAPI, Electron

**Spec:** `docs/superpowers/specs/2026-03-13-ui-fixes-and-features-design.md`

**Key codebase notes:**
- `app-bundle.js` uses an input-buffered hotkey system: `keyBufferRef` accumulates presses, a 200ms ticker drains them. The useEffect has `[gridSize]` deps only — closures over `api`, `currentPatch`, etc. are **stale**. Use refs for values needed inside the ticker.
- API object (line 78-81) has `get` and `post` methods but no `baseUrl` property. The URL is captured in closure.
- Tag clicks in TagsPanel currently call `saveTag(n)` — this is the primary tagging workflow, NOT a toast.

---

## Task 1: Fix Ctrl+'+' Zoom

**Files:**
- Modify: `frontend/src/app-bundle.js:282-294` (keydown handler)
- Modify: `frontend/src/app.js:533-561` (keyboard shortcuts useEffect)

- [ ] **Step 1: Add zoom helper + Ctrl+=/- handling in `app-bundle.js` keydown handler**

In the `hk` function (line 283), add zoom handling BEFORE the buffer logic. Zoom bypasses the buffer (immediate, like wheel). Extract helper to avoid duplication:

```javascript
const hk = (e) => {
    // Ctrl+= / Ctrl+- zoom (bypass buffer, immediate like wheel)
    if (e.ctrlKey && (e.key === '=' || e.key === '+' || e.key === '-')) {
        e.preventDefault();
        const factor = e.key === '-' ? 0.8 : 1.2;
        const curZoom = zoomRef.current;
        const newZoom = Math.max(0.1, Math.min(10, curZoom * factor));
        const viewer = viewerRef.current;
        if (viewer) {
            const rect = viewer.getBoundingClientRect();
            const cx = rect.width / 2;
            const cy = rect.height / 2;
            const curOffset = offsetRef.current;
            const scale = newZoom / curZoom;
            const newOffset = { x: cx - scale * (cx - curOffset.x), y: cy - scale * (cy - curOffset.y) };
            zoomRef.current = newZoom;
            offsetRef.current = newOffset;
            setZoom(newZoom);
            setOffset(newOffset);
        }
        return;
    }
    const k = e.key.toLowerCase();
    const buf = keyBufferRef.current;
    // ... existing buffer code
};
```

- [ ] **Step 2: Add same handling in `app.js` handleKeyDown**

In `app.js` line 533 `handleKeyDown`, add before the switch:

```javascript
if (e.ctrlKey && (e.key === '=' || e.key === '+' || e.key === '-')) {
    e.preventDefault();
    const factor = e.key === '-' ? 0.8 : 1.2;
    const newZoom = Math.max(0.1, Math.min(10, zoom * factor));
    setZoom(newZoom);
    return;
}
```

- [ ] **Step 3: Test manually** — launch app, Ctrl+= should zoom in, Ctrl+- should zoom out.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app-bundle.js frontend/src/app.js
git commit -m "fix: add Ctrl+=/- keyboard zoom support"
```

---

## Task 2: Add `U` Hotkey for Untagged Toggle

**Files:**
- Modify: `frontend/src/app-bundle.js:280,286-293,297-319` (buffer init, keydown, ticker)
- Modify: `frontend/src/app.js:533-566` (handleKeyDown)

**Closure problem:** The ticker runs in a useEffect with `[gridSize]` deps. `api` and `currentPatch` are stale inside the ticker. Solution: use refs.

- [ ] **Step 1: Add refs for api and currentPatch (after existing refs, ~line 25)**

```javascript
const apiRef = useRef(null);
const currentPatchRef = useRef({y: 0, x: 0});
```

And sync them (add after line 74):

```javascript
useEffect(() => { apiRef.current = api; }, [api]);
useEffect(() => { currentPatchRef.current = currentPatch; }, [currentPatch]);
```

- [ ] **Step 2: Add `u` to buffer init (line 280)**

```javascript
const keyBufferRef = useRef({ s: 0, b: 0, x: 0, p: 0, u: 0, dx: 0, dy: 0 });
```

- [ ] **Step 3: Add `u` key to keydown handler (after line 289)**

```javascript
else if (k === 'u') buf.u++;
```

- [ ] **Step 4: Add `u` toggle to ticker drain (after line 306), using refs**

```javascript
if (buf.u % 2 !== 0) {
    setShowUntagged(v => {
        const next = !v;
        const a = apiRef.current;
        const cp = currentPatchRef.current;
        if (next && a) {
            a.get(`/api/untagged-mask/${cp.y}/${cp.x}`).then(d => {
                drawOnCanvas(canvasUntaggedRef, d.image);
            }).catch(()=>{});
        }
        return next;
    });
}
```

- [ ] **Step 5: Update buffer clear (line 319)**

```javascript
keyBufferRef.current = { s: 0, b: 0, x: 0, p: 0, u: 0, dx: 0, dy: 0 };
```

- [ ] **Step 6: In `app.js`, add `U` case in handleKeyDown switch**

```javascript
case 'u':
    // Toggle untagged overlay — only wired in app-bundle.js buffer system
    break;
```

- [ ] **Step 7: Commit**

```bash
git add frontend/src/app-bundle.js frontend/src/app.js
git commit -m "feat: add U hotkey for untagged segments toggle"
```

---

## Task 3: Help Modal (`H` + `?` button)

**Files:**
- Modify: `frontend/src/app-bundle.js` (keydown handler, toolbar, new modal render)
- Modify: `frontend/src/app.js` (same)
- Modify: `frontend/src/styles/main.css` (help modal styles)

- [ ] **Step 1: Add `showHelp` state and ref in `app-bundle.js` (after line 36)**

```javascript
const [showHelp, setShowHelp] = useState(false);
const showHelpRef = useRef(false);
const showAnnotationRef = useRef(false);
```

Sync refs (add after other ref syncs):

```javascript
useEffect(() => { showHelpRef.current = showHelp; }, [showHelp]);
useEffect(() => { showAnnotationRef.current = showAnnotationModal; }, [showAnnotationModal]);
```

- [ ] **Step 2: Add `H` and `Esc` handling in keydown handler (immediate, before buffer)**

Add after the Ctrl+zoom block, before `const k = e.key.toLowerCase()`:

```javascript
// H toggles help modal (immediate, not buffered)
if (e.key.toLowerCase() === 'h' && !e.ctrlKey && !showAnnotationRef.current) {
    setShowHelp(v => !v);
    return;
}
// Esc closes help modal
if (e.key === 'Escape' && showHelpRef.current) {
    setShowHelp(false);
    return;
}
// Block all hotkeys while help or annotation modal is open
if (showHelpRef.current || showAnnotationRef.current) return;
```

- [ ] **Step 3: Add `?` button in toolbar (after Export button, around line 440)**

```javascript
React.createElement('button', {
    className: 'btn btn-secondary',
    style: { marginLeft: 'auto', fontSize: '16px', padding: '4px 10px' },
    onClick: () => setShowHelp(v => !v),
    title: 'Помощь (H)'
}, '?')
```

- [ ] **Step 4: Add HelpModal render (before closing `)` of app-container, around line 603)**

```javascript
showHelp && React.createElement('div', {className:'modal-overlay', onClick:()=>setShowHelp(false)},
    React.createElement('div', {className:'help-modal', onClick:e=>e.stopPropagation()},
        React.createElement('h3', {style:{marginBottom:'16px'}}, 'Горячие клавиши'),
        React.createElement('div', {className:'help-grid'},
            ...[
                ['S', 'Границы сегментов'],
                ['B', 'Цветные сегменты'],
                ['X', 'Угол 45°/90°'],
                ['P', 'Режим PPL/XPL'],
                ['U', 'Неразмеченные'],
                ['H', 'Эта справка'],
                ['←→↑↓', 'Навигация по патчам'],
                ['Ctrl+=', 'Приблизить'],
                ['Ctrl+-', 'Отдалить'],
                ['ПКМ+тянуть', 'Перемещение'],
                ['Колесо', 'Масштаб к курсору'],
            ].map(([key, desc]) =>
                React.createElement(React.Fragment, {key},
                    React.createElement('kbd', null, key),
                    React.createElement('span', null, desc)
                )
            )
        ),
        React.createElement('button', {className:'btn btn-secondary', style:{marginTop:'16px', width:'100%'}, onClick:()=>setShowHelp(false)}, 'Закрыть')
    )
)
```

- [ ] **Step 5: Add CSS for help modal in `main.css`**

```css
.help-modal {
    background: var(--bg-secondary, #1e1e2e);
    border: 1px solid var(--border-color, #333);
    border-radius: 8px;
    padding: 24px;
    max-width: 400px;
    width: 90%;
}
.help-grid {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 8px 16px;
    align-items: center;
}
.help-grid kbd {
    background: #333;
    border: 1px solid #555;
    border-radius: 4px;
    padding: 2px 8px;
    font-family: monospace;
    font-size: 13px;
    color: #fff;
    text-align: center;
    min-width: 32px;
}
.help-grid span {
    color: #ccc;
    font-size: 14px;
}
```

- [ ] **Step 6: Add same state + modal in `app.js`**

Add `showHelp` state, `H`/`Esc` handling in handleKeyDown, `?` button in toolbar, and HelpModal render.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/app-bundle.js frontend/src/app.js frontend/src/styles/main.css
git commit -m "feat: add help modal with hotkey reference (H or ? button)"
```

---

## Task 4: Remove DevTools on Startup

**Files:**
- Modify: `frontend/main.js:135-136`

- [ ] **Step 1: Guard the openDevTools call**

Replace lines 135-136:

```javascript
// Only open DevTools in development mode
if (process.argv.includes('--dev') || process.env.DEV === '1') {
    mainWindow.webContents.openDevTools();
}
```

- [ ] **Step 2: Test** — run AppImage, verify DevTools do not open.

- [ ] **Step 3: Commit**

```bash
git add frontend/main.js
git commit -m "fix: only open DevTools with --dev flag"
```

---

## Task 5: Increase Stats Font Size

**Files:**
- Modify: `frontend/src/app-bundle.js:472,475` (inline styles)
- Modify: `frontend/src/app.js` (equivalent stats rendering)

- [ ] **Step 1: In `app-bundle.js`, update both stat line styles**

Line 472: change `fontSize:'11px'` to `fontSize:'15px', fontWeight:'500'`
Line 475: change `fontSize:'11px'` to `fontSize:'15px', fontWeight:'500'`

- [ ] **Step 2: In `app.js`, update equivalent stats rendering** (if present in status bar section around line 1060-1070)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app-bundle.js frontend/src/app.js
git commit -m "fix: increase stats font size from 11px to 15px"
```

---

## Task 6: Tag Navigator

**Files:**
- Modify: `backend/main.py` (new endpoints)
- Modify: `frontend/src/app-bundle.js` (TagNavigator component, TagsPanel modification)
- Modify: `frontend/src/app.js` (same)
- Modify: `frontend/src/styles/main.css` (navigator styles)

### Step 6a: Backend endpoints

- [ ] **Step 1: Add `from fastapi.responses import Response` to imports in `main.py`**

- [ ] **Step 2: Add `/api/tag-locations/{tag_name}` endpoint (after `/api/tags`)**

```python
@app.get("/api/tag-locations/{tag_name}")
async def get_tag_locations(tag_name: str):
    locations = []
    for (py, px), seg_data in state.segmentations.items():
        seg_tags = seg_data.get('segment_tags', {})
        matching_ids = [int(sid) for sid, tag in seg_tags.items() if tag == tag_name]
        if matching_ids:
            locations.append({
                "patch_y": py,
                "patch_x": px,
                "segment_ids": matching_ids,
                "count": len(matching_ids)
            })
    return {"locations": locations}
```

- [ ] **Step 3: Add `/api/patch-thumbnail/{py}/{px}` endpoint** (returns 128x128 JPEG)

```python
@app.get("/api/patch-thumbnail/{py}/{px}")
async def get_patch_thumbnail(py: int, px: int, image_type: str = "xpl45"):
    patch = state.patches.get(image_type, {}).get((py, px))
    if patch is None: raise HTTPException(status_code=404)
    thumb = cv2.resize(patch, (128, 128))
    return Response(content=cv2.imencode('.jpg', thumb)[1].tobytes(), media_type="image/jpeg")
```

- [ ] **Step 4: Commit**

```bash
git add backend/main.py
git commit -m "feat: add /api/tag-locations and /api/patch-thumbnail endpoints"
```

### Step 6b: Frontend — expose baseUrl on API object

- [ ] **Step 5: Store `baseUrl` on the api object (line 78-81)**

Change API construction to include the URL:

```javascript
window.electronAPI.getApiUrl().then(url => setApi({
    baseUrl: url,
    get: (e, signal) => fetch(url + e, signal ? {signal} : {}).then(r => r.json()),
    post: (e, d) => fetch(url + e, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(d)}).then(r => r.json())
}));
```

### Step 6c: Frontend TagNavigator

- [ ] **Step 6: Add state for tag navigator (after showHelp state)**

```javascript
const [tagNavData, setTagNavData] = useState(null); // {name, color, locations}
```

- [ ] **Step 7: Add navigation icon button to each tag in TagsPanel (line 544)**

**Important:** Do NOT replace the existing `onClick:()=>saveTag(n)`. That is the primary tagging action. Instead, add a small icon button inside the tag-item for navigation:

```javascript
Object.entries(tags).map(([n, c]) => React.createElement('div', {key:n, className:'tag-item'},
    React.createElement('span', {className:'tag-color', style:{backgroundColor:c}, onClick:()=>saveTag(n)}),
    React.createElement('span', {className:'tag-name', onClick:()=>saveTag(n)}, n),
    React.createElement('button', {
        className:'btn btn-secondary',
        style:{marginLeft:'auto', padding:'2px 6px', fontSize:'11px', minWidth:'auto'},
        title:'Найти на карте',
        onClick:(e) => {
            e.stopPropagation();
            api.get(`/api/tag-locations/${encodeURIComponent(n)}`).then(d => {
                setTagNavData({ name: n, color: c, locations: d.locations });
            }).catch(() => {});
        }
    }, '🔍')
))
```

- [ ] **Step 8: Add TagNavigator modal render (before help modal)**

```javascript
tagNavData && React.createElement('div', {className:'modal-overlay', onClick:()=>setTagNavData(null)},
    React.createElement('div', {className:'tag-navigator', onClick:e=>e.stopPropagation()},
        React.createElement('div', {className:'tag-nav-header'},
            React.createElement('span', {className:'tag-color', style:{backgroundColor:tagNavData.color}}),
            React.createElement('h3', {style:{margin:0}}, tagNavData.name),
            React.createElement('span', {style:{color:'#888', marginLeft:'auto'}}, tagNavData.locations.length + ' патчей'),
            React.createElement('button', {className:'btn btn-secondary', style:{marginLeft:'8px', padding:'2px 8px'}, onClick:()=>setTagNavData(null)}, '×')
        ),
        React.createElement('div', {className:'tag-nav-list'},
            tagNavData.locations.map(loc =>
                React.createElement('div', {key:`${loc.patch_y}-${loc.patch_x}`, className:'tag-nav-item'},
                    React.createElement('img', {
                        className:'tag-nav-thumb',
                        src: api ? `${api.baseUrl}/api/patch-thumbnail/${loc.patch_y}/${loc.patch_x}?image_type=${currentView}` : '',
                        alt: `Patch ${loc.patch_y},${loc.patch_x}`
                    }),
                    React.createElement('div', {className:'tag-nav-info'},
                        React.createElement('div', {style:{fontWeight:'500'}}, `Патч ${loc.patch_y+1}, ${loc.patch_x+1}`),
                        React.createElement('div', {style:{fontSize:'12px', color:'#888'}}, loc.count + ' сегментов')
                    ),
                    React.createElement('div', {className:'tag-nav-actions'},
                        React.createElement('button', {
                            className:'btn btn-secondary', style:{padding:'4px 8px', fontSize:'12px'},
                            title: 'Перейти',
                            onClick: () => {
                                setCurrentPatch({y: loc.patch_y, x: loc.patch_x});
                                zoomRef.current = 1; offsetRef.current = {x:0, y:0};
                                setZoom(1); setOffset({x:0, y:0});
                                // Refresh untagged mask if active
                                if (showUntagged && api) {
                                    api.get(`/api/untagged-mask/${loc.patch_y}/${loc.patch_x}`).then(d => {
                                        drawOnCanvas(canvasUntaggedRef, d.image);
                                    }).catch(()=>{});
                                }
                                setTagNavData(null);
                            }
                        }, '📍'),
                        React.createElement('button', {
                            className:'btn btn-secondary', style:{padding:'4px 8px', fontSize:'12px', marginLeft:'4px'},
                            title: 'Изменить тег',
                            onClick: () => {
                                const navName = tagNavData.name;
                                setCurrentPatch({y: loc.patch_y, x: loc.patch_x});
                                setSelectedSegment({id: Math.min(...loc.segment_ids), tag: null});
                                setShowAnnotationModal(true);
                                setTagNavData(null);
                                // After modal closes and tag is saved, user can reopen navigator manually
                            }
                        }, '✏️')
                    )
                )
            ),
            tagNavData.locations.length === 0 && React.createElement('div', {style:{padding:'20px', textAlign:'center', color:'#666'}}, 'Тег не используется')
        )
    )
)
```

- [ ] **Step 9: Add CSS for TagNavigator in `main.css`**

```css
.tag-navigator {
    background: var(--bg-secondary, #1e1e2e);
    border: 1px solid var(--border-color, #333);
    border-radius: 8px;
    padding: 16px;
    max-width: 420px;
    width: 90%;
    max-height: 70vh;
    display: flex;
    flex-direction: column;
}
.tag-nav-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;
    padding-bottom: 12px;
    border-bottom: 1px solid #333;
}
.tag-nav-list {
    overflow-y: auto;
    flex: 1;
}
.tag-nav-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px;
    border-radius: 6px;
    cursor: default;
}
.tag-nav-item:hover {
    background: rgba(255,255,255,0.05);
}
.tag-nav-thumb {
    width: 64px;
    height: 64px;
    border-radius: 4px;
    object-fit: cover;
    border: 1px solid #333;
}
.tag-nav-info {
    flex: 1;
}
.tag-nav-actions {
    display: flex;
}
```

- [ ] **Step 10: Add equivalent changes in `app.js`**

Add `tagNavData` state, search button in TagsPanel, TagNavigator component matching `app-bundle.js`.

- [ ] **Step 11: Commit**

```bash
git add frontend/src/app-bundle.js frontend/src/app.js frontend/src/styles/main.css backend/main.py
git commit -m "feat: add tag navigator with patch previews and navigation"
```

---

## Task 7: Esc Closes Annotation Modal Globally

**Files:**
- Modify: `frontend/src/app-bundle.js:282-294` (keydown handler)
- Modify: `frontend/src/app.js` (handleKeyDown)

**Note:** The annotation modal already handles Esc inside the input `onKeyDown` (line 586). This task adds a global keydown handler so Esc works even when the input isn't focused. The `showAnnotationRef` was already added in Task 3.

- [ ] **Step 1: Add Esc→annotation modal close in `app-bundle.js` keydown handler**

In the `hk` function, add after the Ctrl+zoom block (from Task 1) and before `H` handling (from Task 3):

```javascript
// Esc closes annotation modal (global, not just from input)
if (e.key === 'Escape' && showAnnotationRef.current) {
    setShowAnnotationModal(false);
    return;
}
```

This goes BEFORE the help modal Esc check — annotation modal takes priority.

- [ ] **Step 2: Add same handling in `app.js` handleKeyDown**

```javascript
if (e.key === 'Escape' && showAnnotationModal) {
    setShowAnnotationModal(false);
    return;
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app-bundle.js frontend/src/app.js
git commit -m "fix: Esc closes annotation modal from any focus state"
```

---

## Task 8: Ctrl+Click Multi-Select Segments

**Files:**
- Modify: `frontend/src/app-bundle.js` (state, handleImageClick, saveTag, modal)
- Modify: `frontend/src/app.js` (same)

- [ ] **Step 1: Add `selectedSegments` state in `app-bundle.js` (after `selectedSegment` state, line 29)**

```javascript
const [selectedSegments, setSelectedSegments] = useState([]); // [{id, patchY, patchX}]
```

- [ ] **Step 2: Modify `handleImageClick` to support Ctrl+click accumulation**

Replace the existing `handleImageClick` (lines 328-365):

```javascript
const handleImageClick = (e) => {
    if (!patchReady || window.isPanning) return;
    const panelRect = viewerRef.current.getBoundingClientRect();
    const screenX = e.clientX - panelRect.left;
    const screenY = e.clientY - panelRect.top;
    const x = Math.floor((screenX - offsetRef.current.x) / zoomRef.current);
    const y = Math.floor((screenY - offsetRef.current.y) / zoomRef.current);
    if (x>=0 && y>=0 && x<1024 && y<1024) {
        api.get(`/api/patch-segment-at-point/${currentPatch.y}/${currentPatch.x}?x=${x}&y=${y}`).then(r => {
            if (r.status === 'success' && r.segment_id > 0) {
                const segInfo = {id: r.segment_id, tag: r.tag || null};

                if (e.ctrlKey) {
                    // Ctrl+click: toggle segment in multi-select array
                    setSelectedSegments(prev => {
                        const exists = prev.find(s => s.id === r.segment_id);
                        if (exists) return prev.filter(s => s.id !== r.segment_id);
                        return [...prev, {id: r.segment_id, patchY: currentPatch.y, patchX: currentPatch.x}];
                    });
                    setSelectedSegment(segInfo);
                    return;
                }

                // Normal click: clear multi-select, set single segment
                setSelectedSegments([]);
                setSelectedSegment(segInfo);

                if (!r.tag) {
                    api.get(`/api/segment-color/${currentPatch.y}/${currentPatch.x}/${r.segment_id}`).then(cr => {
                        const hex = cr.color.replace('#', '');
                        const rd = Math.floor(parseInt(hex.slice(0,2), 16) / 2);
                        const gd = Math.floor(parseInt(hex.slice(2,4), 16) / 2);
                        const bd = Math.floor(parseInt(hex.slice(4,6), 16) / 2);
                        const dark = '#' + [rd, gd, bd].map(v => v.toString(16).padStart(2,'0')).join('');
                        setSegmentDarkColor(dark);
                        setSegmentOriginalColor(cr.color);
                        setShowAnnotationModal(true);
                    });
                } else {
                    setSegmentDarkColor(null);
                    setSegmentOriginalColor(null);
                    setShowAnnotationModal(true);
                }
            }
        });
    }
};
```

- [ ] **Step 3: Modify `saveTag` to handle multi-select**

Replace the existing `saveTag` (lines 367-391):

```javascript
const saveTag = (tagName, forcedColor) => {
    if (!tagName) return;
    const color = forcedColor || tags[tagName] || tagColor(tagName);

    // Determine which segments to tag
    const segsToTag = selectedSegments.length > 0
        ? selectedSegments
        : (selectedSegment ? [{id: selectedSegment.id, patchY: currentPatch.y, patchX: currentPatch.x}] : []);

    if (segsToTag.length === 0) return;

    // Post label for each selected segment
    Promise.all(segsToTag.map(seg =>
        api.post('/api/label-segment', {
            patch_y: seg.patchY, patch_x: seg.patchX,
            segment_id: seg.id, tag: tagName, color: color
        })
    )).then(() => {
        setShowAnnotationModal(false);
        setSelectedSegments([]);
        api.get(`/api/segmentation/${currentPatch.y}/${currentPatch.x}`).then(d => {
            if (d.status === 'ready') {
                setPatchStats({total: d.total_segs || 0, tagged: d.tagged_segs || 0});
                drawOnCanvas(canvasSegRef, d.colored_segments);
            }
        });
        api.get('/api/tags').then(d => setTags(d.tag_colors || {}));
        if (showUntagged) {
            api.get(`/api/untagged-mask/${currentPatch.y}/${currentPatch.x}`).then(d => {
                drawOnCanvas(canvasUntaggedRef, d.image);
            });
        }
    });
};
```

- [ ] **Step 4: Update annotation modal header to show multi-select count**

In the modal heading (line 553), change:

```javascript
React.createElement('h3', null, selectedSegment && selectedSegment.tag ? 'Изменить тег' : 'Новый тег'),
```

To:

```javascript
React.createElement('h3', null,
    selectedSegments.length > 1
        ? `Тег для ${selectedSegments.length} сегментов`
        : (selectedSegment && selectedSegment.tag ? 'Изменить тег' : 'Новый тег')
),
```

- [ ] **Step 5: Add "Tag selected" button when multi-select is active (near annotation area)**

After the modal overlay block, add a floating indicator when multiple segments are selected:

```javascript
selectedSegments.length > 1 && !showAnnotationModal && React.createElement('div', {
    style: {
        position: 'fixed', bottom: '20px', left: '50%', transform: 'translateX(-50%)',
        background: '#2a2a3e', border: '1px solid #555', borderRadius: '8px',
        padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '12px',
        zIndex: 1000, color: '#fff', fontSize: '14px'
    }
},
    React.createElement('span', null, `Выбрано: ${selectedSegments.length} сегментов`),
    React.createElement('button', {
        className: 'btn btn-primary', style: {padding: '4px 12px', fontSize: '13px'},
        onClick: () => {
            setSelectedSegment({id: selectedSegments[0].id, tag: null});
            setSegmentDarkColor(null);
            setSegmentOriginalColor(null);
            setShowAnnotationModal(true);
        }
    }, 'Задать тег'),
    React.createElement('button', {
        className: 'btn btn-secondary', style: {padding: '4px 12px', fontSize: '13px'},
        onClick: () => setSelectedSegments([])
    }, '✕')
)
```

- [ ] **Step 6: Add same changes in `app.js`**

Add `selectedSegments` state, update `handleImageClick`, `saveTag`, modal header, and floating indicator.

- [ ] **Step 7: Update help modal to include Ctrl+Click (in Task 3's hotkey table)**

Add row: `['Ctrl+клик', 'Мультивыбор сегментов']`

- [ ] **Step 8: Commit**

```bash
git add frontend/src/app-bundle.js frontend/src/app.js
git commit -m "feat: Ctrl+click multi-select segments with batch tagging"
```

---

## Post-Implementation

- [ ] **Final test:** Launch app, verify all 8 items work
- [ ] **Rebuild bundle:** If app-bundle.js needs re-bundling, run the build process
