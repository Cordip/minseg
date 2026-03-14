function initApp() {
    // Inject CSS animation for minimap processing pulse
    if (!document.getElementById('minimap-pulse-style')) {
        const style = document.createElement('style');
        style.id = 'minimap-pulse-style';
        style.textContent = `
            @keyframes minimap-pulse {
                0%, 100% { opacity: 0.25; }
                50% { opacity: 0.55; }
            }
        `;
        document.head.appendChild(style);
    }

    const { useState, useEffect, useRef, useCallback } = React;

    function App() {
        const [api, setApi] = useState(null);
        const [imagesAligned, setImagesAligned] = useState(false);
        const [gridSize, setGridSize] = useState({rows: 0, cols: 0});
        const [currentPatch, setCurrentPatch] = useState({y: 0, x: 0});
        const [currentView, setCurrentView] = useState('xpl45');
        const [isXpl, setIsXpl] = useState(true);
        const [isXpl90, setIsXpl90] = useState(false);
        const [showSegments, setShowSegments] = useState(true);
        const [showBounds, setShowBounds] = useState(false);
        const [zoom, setZoom] = useState(1);
        const [offset, setOffset] = useState({x: 0, y: 0});
        
        // Use refs for the stacked canvases instead of React state for images
        const canvasBgRef = useRef(null);
        const canvasBoundRef = useRef(null);
        const canvasSegRef = useRef(null);
        const canvasBorderRef = useRef(null);
        const canvasUntaggedRef = useRef(null);
        const canvasSelectionRef = useRef(null);
        const viewerRef = useRef(null);
        const zoomRef = useRef(1);
        const offsetRef = useRef({x: 0, y: 0});
        const apiRef = useRef(null);
        const currentPatchRef = useRef({y: 0, x: 0});

        const [tags, setTags] = useState({});
        const [minimapData, setMinimapData] = useState(null);
        const [patchReady, setPatchReady] = useState(false);
        const [segProgress, setSegProgress] = useState({done: 0, total: 0});
        const [patchStates, setPatchStates] = useState({}); // {'py,px': 'processed'|'active'|'pending'}
        const [animTick, setAnimTick] = useState(0); // drives minimap spinner animation
        const [showUntagged, setShowUntagged] = useState(false);
        const [patchStats, setPatchStats] = useState({total: 0, tagged: 0});
        const abortRef = useRef(null);
        const [showHelp, setShowHelp] = useState(false);
        const [selectedSegments, setSelectedSegments] = useState([]); // [{id, patchY, patchX}]
        const [contextMenu, setContextMenu] = useState(null); // {x, y, tagName, tagColor}
        const contextMenuRef = useRef(null);
        const showHelpRef = useRef(false);
        const [treeData, setTreeData] = useState([]);
        const [expandedNodes, setExpandedNodes] = useState(new Set());
        const [treeSelection, setTreeSelection] = useState(new Set());
        const [lastTreeClick, setLastTreeClick] = useState(null);
        const [quickInput, setQuickInput] = useState(null); // {patchY, patchX, segmentId}
        const [quickFilter, setQuickFilter] = useState('');
        const [quickHighlight, setQuickHighlight] = useState(0);
        const [canUndo, setCanUndo] = useState(false);
        const [canRedo, setCanRedo] = useState(false);
        const [sidebarWidth, setSidebarWidth] = useState(400);
        const [zoomToSegment, setZoomToSegment] = useState(null);
        const [deleteConfirm, setDeleteConfirm] = useState(null);
        const quickInputRef = useRef(null);
        const pluralSeg = (n) => { const m=n%100, d=n%10; return d===1&&m!==11?'сегмент':d>=2&&d<=4&&(m<12||m>14)?'сегмента':'сегментов'; };

        // Deterministic vibrant color from tag name, returned as #RRGGBB
        const tagColor = (name) => {
            // Enhanced hash (DJB2) for better distribution
            let hash = 5381;
            for (let i = 0; i < name.length; i++) hash = ((hash << 5) + hash) + name.charCodeAt(i);
            
            // Golden ratio hue distribution (360 * 0.618...)
            const hue = Math.abs(hash * 137.5) % 360;
            const s = 0.85; // High saturation
            const l = 0.55; // Slightly lighter for visibility
            
            const h = hue / 360;
            const hue2rgb = (p, q, t) => {
                if(t < 0) t += 1;
                if(t > 1) t -= 1;
                if(t < 1/6) return p + (q - p) * 6 * t;
                if(t < 1/2) return q;
                if(t < 2/3) return p + (q - p) * (2/3 - t) * 6;
                return p;
            };
            const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            const p = 2 * l - q;
            const r = hue2rgb(p, q, h + 1/3);
            const g = hue2rgb(p, q, h);
            const b = hue2rgb(p, q, h - 1/3);
            const toHex = x => {
                const hex = Math.round(x * 255).toString(16);
                return hex.length === 1 ? '0' + hex : hex;
            };
            const res = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
            return res;
        };

        useEffect(() => { apiRef.current = api; }, [api]);
        useEffect(() => { currentPatchRef.current = currentPatch; }, [currentPatch]);
        useEffect(() => { showHelpRef.current = showHelp; }, [showHelp]);
        useEffect(() => { contextMenuRef.current = contextMenu; }, [contextMenu]);

        // Refresh selection highlight when selectedSegments changes
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

        useEffect(() => {
            setCurrentView((isXpl ? 'xpl' : 'ppl') + (isXpl90 ? '90' : '45'));
        }, [isXpl, isXpl90]);

        useEffect(() => {
            if (window.electronAPI) {
                window.electronAPI.getApiUrl().then(url => setApi({
                    baseUrl: url,
                    get: (e, signal) => fetch(url + e, signal ? {signal} : {}).then(r => r.json()),
                    post: (e, d) => fetch(url + e, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(d)}).then(r => r.json())
                }));
            }
        }, []);

        useEffect(() => {
            if (api) {
                api.get('/api/status').then(s => {
                    if (s.images_aligned) {
                        setGridSize(s.grid_size);
                        setImagesAligned(true);
                        document.getElementById('loading-screen').style.display = 'none';
                        // Kick off background segmentation for all patches
                        api.post('/api/start-segmentation');
                    }
                });
            }
        }, [api]);

        // Poll segmentation progress (2s when processing, 5s when idle)
        const isProcessingRef = useRef(false);
        useEffect(() => {
            if (!api || !imagesAligned) return;
            const fetchProgress = () => {
                api.get('/api/status').then(s => {
                    setSegProgress({done: s.segmented_patches || 0, total: s.total_patches || 0, untagged: s.untagged_segments || 0});
                    isProcessingRef.current = s.is_segmenting;
                });
                api.get('/api/segmentation-progress').then(p => {
                    if (!p.is_running && (!p.processed || p.processed.length === 0)) return;
                    const map = {};
                    (p.processed || []).forEach(([py, px]) => { map[`${py},${px}`] = 'processed'; });
                    (p.current_active || []).forEach(([py, px]) => { map[`${py},${px}`] = 'active'; });
                    (p.pending || []).forEach(([py, px]) => { map[`${py},${px}`] = 'pending'; });
                    setPatchStates(map);
                }).catch(() => {});
            };
            let timer;
            const tick = () => {
                fetchProgress();
                timer = setTimeout(tick, isProcessingRef.current ? 2000 : 5000);
            };
            tick();
            return () => clearTimeout(timer);
        }, [api, imagesAligned]);

        // Non-passive wheel listener via callback ref
        const viewerCallbackRef = useCallback((node) => {
            // Cleanup previous
            if (viewerRef.current) {
                viewerRef.current.removeEventListener('wheel', viewerRef.current._wheelHandler);
            }
            viewerRef.current = node;
            if (!node) return;
            const handleWheel = (e) => {
                e.preventDefault();
                e.stopPropagation();
                const rect = node.getBoundingClientRect();
                const cx = e.clientX - rect.left;
                const cy = e.clientY - rect.top;
                const factor = e.deltaY > 0 ? 0.9 : 1.1;
                const curZoom = zoomRef.current;
                const curOffset = offsetRef.current;
                const newZoom = Math.max(0.1, Math.min(10, curZoom * factor));
                const scale = newZoom / curZoom;
                const newOffset = {
                    x: cx - scale * (cx - curOffset.x),
                    y: cy - scale * (cy - curOffset.y)
                };
                zoomRef.current = newZoom;
                offsetRef.current = newOffset;
                setZoom(newZoom);
                setOffset(newOffset);
            };
            node._wheelHandler = handleWheel;
            node.addEventListener('wheel', handleWheel, {passive: false});
        }, []);

        // Helper to draw base64 image on a specific canvas
        const drawOnCanvas = (canvasRef, base64Data) => {
            const canvas = canvasRef.current;
            if (!canvas || !base64Data) return;
            const ctx = canvas.getContext('2d');
            const img = new Image();
            img.onload = () => {
                canvas.width = img.width;
                canvas.height = img.height;
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0);
            };
            img.src = 'data:image/png;base64,' + base64Data;
        };

        const drawSelectionStripes = (maskBase64) => {
            const canvas = canvasSelectionRef.current;
            if (!canvas || !maskBase64) return;
            const ctx = canvas.getContext('2d');
            const maskImg = new Image();
            maskImg.onload = () => {
                canvas.width = maskImg.width;
                canvas.height = maskImg.height;
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(maskImg, 0, 0);
                ctx.globalCompositeOperation = 'source-in';
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

        const loadBackgroundData = useCallback(() => {
            if (!api || !imagesAligned) return;
            // Background only depends on view and patch
            api.get(`/api/patch/${currentPatch.y}/${currentPatch.x}?image_type=${currentView}`).then(d => {
                drawOnCanvas(canvasBgRef, d.image);
            }).catch(() => {});
        }, [api, currentPatch, currentView, imagesAligned]);

        const loadSegmentationData = useCallback(() => {
            if (!api || !imagesAligned) return;
            if (abortRef.current) abortRef.current.abort();
            const ac = new AbortController();
            abortRef.current = ac;
            const sig = ac.signal;
            setPatchReady(false);
            
            // Render bounds, segments, and borders (heavy data)
            api.get(`/api/segmentation/${currentPatch.y}/${currentPatch.x}`, sig).then(d => {
                console.log('SEG_DATA:', d);
                if (d.status === 'ready') {
                    setPatchStats({total: d.total_segs || 0, tagged: d.tagged_segs || 0});
                    drawOnCanvas(canvasSegRef, d.colored_segments);
                    drawOnCanvas(canvasBoundRef, d.bounds);
                    if (d.borders) drawOnCanvas(canvasBorderRef, d.borders);
                    setPatchReady(true);
                } else {
                    if (canvasSegRef.current) canvasSegRef.current.getContext('2d').clearRect(0,0,1024,1024);
                    if (canvasBoundRef.current) canvasBoundRef.current.getContext('2d').clearRect(0,0,1024,1024);
                    if (canvasBorderRef.current) canvasBorderRef.current.getContext('2d').clearRect(0,0,1024,1024);
                    api.post(`/api/segment-patch/${currentPatch.y}/${currentPatch.x}`);
                }
            }).catch(() => {});
            api.get('/api/tags').then(d => setTags(d.tag_colors || {})).catch(() => {});
        }, [api, currentPatch, imagesAligned]);

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

        // Debounced load for Segmentation (heavy) — waits 300ms after currentPatch changes
        const debounceSegRef = useRef(null);
        const loadingRef = useRef(false);
        useEffect(() => {
            if (debounceSegRef.current) clearTimeout(debounceSegRef.current);
            debounceSegRef.current = setTimeout(() => {
                if (!loadingRef.current) {
                    loadingRef.current = true;
                    loadSegmentationData();
                    setTimeout(() => { loadingRef.current = false; }, 500);
                }
            }, 300);
            return () => clearTimeout(debounceSegRef.current);
        }, [loadSegmentationData]);

        // Immediate load for Background (lightweight)
        useEffect(() => {
            loadBackgroundData();
            if (api && imagesAligned) {
                api.get('/api/minimap?image_type=' + currentView).then(setMinimapData).catch(() => {});
            }
        }, [loadBackgroundData, currentView, api, imagesAligned]);

        useEffect(() => {
            if (patchReady || !api) return;
            const itv = setInterval(() => {
                if (loadingRef.current) return; // skip if loading
                api.get(`/api/segmentation/${currentPatch.y}/${currentPatch.x}`).then(d => {
                    if (d.status === 'ready') {
                        setPatchStats({total: d.total_segs || 0, tagged: d.tagged_segs || 0});
                        drawOnCanvas(canvasSegRef, d.colored_segments);
                        drawOnCanvas(canvasBoundRef, d.bounds);
                        if (d.borders) drawOnCanvas(canvasBorderRef, d.borders);
                        setPatchReady(true);
                    }
                }).catch(() => {});
            }, 2000);
            return () => clearInterval(itv);
        }, [api, currentPatch, patchReady]);

        useEffect(() => {
            if (!minimapData) return;
            const canvas = document.getElementById('minimap-canvas-el');
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            const img = new Image();
            img.onload = () => {
                canvas.width = img.width; canvas.height = img.height;
                ctx.drawImage(img, 0, 0);
                const cw = canvas.width / gridSize.cols; const ch = canvas.height / gridSize.rows;

                // Draw per-cell state overlays
                for (let py = 0; py < gridSize.rows; py++) {
                    for (let px = 0; px < gridSize.cols; px++) {
                        const st = patchStates[`${py},${px}`];
                        if (st === 'pending') {
                            ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
                            ctx.fillRect(px * cw, py * ch, cw, ch);
                        } else if (st === 'active') {
                            ctx.fillStyle = 'rgba(74, 158, 255, 0.3)';
                            ctx.fillRect(px * cw, py * ch, cw, ch);
                            const cx = px * cw + cw / 2;
                            const cy = py * ch + ch / 2;
                            const r = Math.min(cw, ch) * 0.2;
                            ctx.strokeStyle = '#4a9eff';
                            ctx.lineWidth = 2;
                            ctx.beginPath();
                            const t = Date.now() / 500;
                            ctx.arc(cx, cy, r, t, t + Math.PI * 1.4);
                            ctx.stroke();
                        }
                    }
                }

                // Grid lines
                ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 1;
                for(let i=0; i<=gridSize.cols; i++) { ctx.beginPath(); ctx.moveTo(i*cw, 0); ctx.lineTo(i*cw, canvas.height); ctx.stroke(); }
                for(let j=0; j<=gridSize.rows; j++) { ctx.beginPath(); ctx.moveTo(0, j*ch); ctx.lineTo(canvas.width, j*ch); ctx.stroke(); }

                // Current patch highlight (red)
                ctx.strokeStyle = '#ff4757'; ctx.lineWidth = 3;
                ctx.strokeRect(currentPatch.x * cw, currentPatch.y * ch, cw, ch);
                ctx.fillStyle = 'rgba(255, 71, 87, 0.2)';
                ctx.fillRect(currentPatch.x * cw, currentPatch.y * ch, cw, ch);
            };
            img.src = 'data:image/png;base64,' + minimapData.image;
        }, [minimapData, currentPatch, gridSize, patchStates, animTick]);

        // Animate minimap spinner when patches are processing
        useEffect(() => {
            const hasActive = Object.values(patchStates).some(s => s === 'active');
            if (!hasActive) return;
            const timer = setInterval(() => setAnimTick(t => t + 1), 200);
            return () => clearInterval(timer);
        }, [patchStates]);

        const handleMouseDown = (e) => {
            if (e.button === 2) {
                e.preventDefault();
                window.isPanning = true;
                window.lastPos = {x: e.clientX, y: e.clientY};
            }
        };
        const handleMouseMove = (e) => {
            if (window.isPanning) {
                const dx = e.clientX - window.lastPos.x;
                const dy = e.clientY - window.lastPos.y;
                setOffset(prev => {
                    const newOff = {x: prev.x + dx, y: prev.y + dy};
                    offsetRef.current = newOff;
                    return newOff;
                });
                window.lastPos = {x: e.clientX, y: e.clientY};
            }
        };
        const handleMouseUp = () => { window.isPanning = false; };

        // Input buffering: collect key presses and evaluate them 5 times a second (200ms).
        const keyBufferRef = useRef({ s: 0, b: 0, x: 0, p: 0, u: 0, dx: 0, dy: 0 });
        
        useEffect(() => {
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
                // Esc closes context menu
                if (e.key === 'Escape' && contextMenuRef.current) {
                    setContextMenu(null);
                    return;
                }
                // H toggles help modal (immediate, not buffered)
                if (e.key.toLowerCase() === 'h' && !e.ctrlKey) {
                    setShowHelp(v => !v);
                    return;
                }
                // Esc closes help modal
                if (e.key === 'Escape' && showHelpRef.current) {
                    setShowHelp(false);
                    return;
                }
                if (e.ctrlKey && e.key === 'z') { e.preventDefault(); handleUndo(); return; }
                if (e.ctrlKey && e.key === 'y') { e.preventDefault(); handleRedo(); return; }
                if (e.key === 'Escape') { setQuickInput(null); setQuickFilter(''); setSelectedSegments([]); setTreeSelection(new Set()); return; }
                if (e.key === 'Enter' && selectedSegments.length > 0 && !quickInputRef.current?.matches(':focus')) {
                    e.preventDefault(); setTimeout(() => quickInputRef.current?.focus(), 50); return;
                }
                // Block all hotkeys while help modal is open
                if (showHelpRef.current) return;
                const k = e.key.toLowerCase();
                const buf = keyBufferRef.current;
                if (k === 's') buf.s++;
                else if (k === 'b') buf.b++;
                else if (k === 'x') buf.x++;
                else if (k === 'p') buf.p++;
                else if (k === 'u') buf.u++;
                else if (k === 'arrowright') buf.dx++;
                else if (k === 'arrowleft') buf.dx--;
                else if (k === 'arrowup') buf.dy--;
                else if (k === 'arrowdown') buf.dy++;
            };
            window.addEventListener('keydown', hk);
            
            const ticker = setInterval(() => {
                const buf = keyBufferRef.current;
                // Only act if there are buffered events
                if (buf.s === 0 && buf.b === 0 && buf.x === 0 && buf.p === 0 && buf.u === 0 && buf.dx === 0 && buf.dy === 0) return;
                
                // For toggles, odd number of presses flips state, even number does nothing
                if (buf.s % 2 !== 0) setShowBounds(v => !v);
                if (buf.b % 2 !== 0) setShowSegments(v => !v);
                if (buf.x % 2 !== 0) setIsXpl90(v => !v);
                if (buf.p % 2 !== 0) setIsXpl(v => !v);
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

                // For movement, sum the displacements
                if (buf.dx !== 0 || buf.dy !== 0) {
                    const dx = buf.dx; const dy = buf.dy;
                    setCurrentPatch(p => ({
                        ...p,
                        x: Math.max(0, Math.min(gridSize.cols - 1, p.x + dx)),
                        y: Math.max(0, Math.min(gridSize.rows - 1, p.y + dy))
                    }));
                }
                
                // Clear the buffer
                keyBufferRef.current = { s: 0, b: 0, x: 0, p: 0, u: 0, dx: 0, dy: 0 };
            }, 200); // 5 times a second
            
            return () => {
                window.removeEventListener('keydown', hk);
                clearInterval(ticker);
            };
        }, [gridSize]);

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
                    }
                });
            }
        };

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

        var flattenTreeKeys = useCallback(function() {
            var keys = [];
            treeData.forEach(function(tag) {
                keys.push('tag:' + tag.name);
                if (expandedNodes.has('tag:' + tag.name)) {
                    tag.patches.forEach(function(p) {
                        keys.push('patch:' + tag.name + ':' + p.patch_y + ',' + p.patch_x);
                        if (expandedNodes.has('patch:' + tag.name + ':' + p.patch_y + ',' + p.patch_x)) {
                            p.segments.forEach(function(sid) { keys.push('seg:' + p.patch_y + ',' + p.patch_x + ':' + sid); });
                        }
                    });
                }
            });
            return keys;
        }, [treeData, expandedNodes]);

        var resolveTreeSelection = useCallback(function(selection) {
            var resolved = new Set();
            selection.forEach(function(key) {
                if (key.startsWith('tag:')) {
                    var tagName = key.slice(4);
                    var tag = treeData.find(function(t) { return t.name === tagName; });
                    if (tag) tag.patches.forEach(function(p) { p.segments.forEach(function(sid) { resolved.add('seg:' + p.patch_y + ',' + p.patch_x + ':' + sid); }); });
                } else if (key.startsWith('patch:')) {
                    var parts = key.split(':');
                    var tName = parts[1];
                    var coords = parts[2].split(',').map(Number);
                    var t = treeData.find(function(t2) { return t2.name === tName; });
                    if (t) {
                        var patch = t.patches.find(function(p) { return p.patch_y === coords[0] && p.patch_x === coords[1]; });
                        if (patch) patch.segments.forEach(function(sid) { resolved.add('seg:' + coords[0] + ',' + coords[1] + ':' + sid); });
                    }
                } else {
                    resolved.add(key);
                }
            });
            return resolved;
        }, [treeData]);

        var handleTreeClick = useCallback(function(e, nodeKey) {
            if (e.ctrlKey) {
                setTreeSelection(function(prev) {
                    var next = new Set(prev);
                    next.has(nodeKey) ? next.delete(nodeKey) : next.add(nodeKey);
                    return next;
                });
                setLastTreeClick(nodeKey);
            } else if (e.shiftKey && lastTreeClick) {
                var keys = flattenTreeKeys();
                var a = keys.indexOf(lastTreeClick);
                var b = keys.indexOf(nodeKey);
                if (a >= 0 && b >= 0) {
                    var start = a < b ? a : b;
                    var end = a < b ? b : a;
                    setTreeSelection(new Set(keys.slice(start, end + 1)));
                }
            } else {
                setTreeSelection(new Set());
                setLastTreeClick(nodeKey);
            }
        }, [lastTreeClick, flattenTreeKeys]);

        const lastKeyTimeRef = useRef(0);
        const throttleToggle = (fn) => () => {
            const now = Date.now();
            if (now - lastKeyTimeRef.current < 200) return;
            lastKeyTimeRef.current = now;
            fn();
        };

        // Combine canvas layer styles for the stacked effect. Background stays full opacity.
        // Bounds uses `mix-blend-mode: multiply` but CSS blend mode behaves differently.
        // An acceptable CSS blending is using `opacity` or specific CSS blend mode on absolute layered elements.
        return React.createElement('div', {className:'app-container', onContextMenu:e=>e.preventDefault()},
            React.createElement('div', {className:'toolbar'},
                React.createElement('div', {className:'toolbar-group'},
                    React.createElement('button', {className:'btn btn-secondary', onClick:throttleToggle(()=>setIsXpl(!isXpl))}, isXpl?'XPL':'PPL'),
                    React.createElement('button', {className:'btn btn-secondary', onClick:throttleToggle(()=>setIsXpl90(!isXpl90))}, isXpl90?'90°':'45°')
                ),
                React.createElement('div', {className:'toolbar-divider'}),
                React.createElement('div', {className:'toolbar-group'},
                    React.createElement('button', {className:'btn btn-secondary '+(showBounds?'active':''), onClick:throttleToggle(()=>setShowBounds(!showBounds))}, '📐 Границы (S)'),
                    React.createElement('button', {className:'btn btn-secondary '+(showSegments?'active':''), onClick:throttleToggle(()=>setShowSegments(!showSegments))}, '🎨 Сегменты (B)'),
                    React.createElement('button', {className:'btn '+(showUntagged?'active':''), style:{backgroundColor: showUntagged ? '#ff4757' : '#6c757d', borderColor: showUntagged ? '#ff4757' : '#6c757d', color:'#fff'}, onClick:throttleToggle(() => {
                        const next = !showUntagged;
                        setShowUntagged(next);
                        if (next && api) {
                            api.get(`/api/untagged-mask/${currentPatch.y}/${currentPatch.x}`).then(d => {
                                drawOnCanvas(canvasUntaggedRef, d.image);
                            }).catch(()=>{});
                        }
                    })}, '🔴 Неразмеченные')
                ),
                React.createElement('div', {className:'toolbar-divider'}),
                React.createElement('div', {className:'toolbar-group'},
                    React.createElement('button', {className:'btn btn-secondary', onClick:()=>setCurrentPatch(p=>({...p, x:Math.max(0, p.x-1)})), disabled:currentPatch.x===0}, '◀'),
                    React.createElement('span', {className:'patch-counter'}, (currentPatch.x+1)+'/'+gridSize.cols),
                    React.createElement('button', {className:'btn btn-secondary', onClick:()=>setCurrentPatch(p=>({...p, x:Math.min(gridSize.cols-1, p.x+1)})), disabled:currentPatch.x>=gridSize.cols-1}, '▶'),
                    React.createElement('span', {style:{margin:'0 5px', color:'#555'}}, '|'),
                    React.createElement('button', {className:'btn btn-secondary', onClick:()=>setCurrentPatch(p=>({...p, y:Math.max(0, p.y-1)})), disabled:currentPatch.y===0}, '▲'),
                    React.createElement('span', {className:'patch-counter'}, (currentPatch.y+1)+'/'+gridSize.rows),
                    React.createElement('button', {className:'btn btn-secondary', onClick:()=>setCurrentPatch(p=>({...p, y:Math.min(gridSize.rows-1, p.y+1)})), disabled:currentPatch.y>=gridSize.rows-1}, '▼')
                ),
                React.createElement('div', {className:'toolbar-divider'}),
                React.createElement('button', {className:'btn btn-primary', onClick:()=> {
                    window.electronAPI.selectOutputFolder().then(r => { if(!r.canceled) api.post('/api/save-project', {output_path: r.path}); });
                }}, '💾 Сохранить'),
                React.createElement('button', {className:'btn btn-primary', style:{marginLeft:'8px', backgroundColor:'#28a745', borderColor:'#28a745'}, onClick:()=> {
                    window.electronAPI.selectOutputFolder().then(r => { if(!r.canceled) api.post('/api/export', {output_path: r.path}); });
                }}, '📦 Экспорт'),
                React.createElement('button', {
                    className: 'btn btn-secondary',
                    style: { marginLeft: 'auto', fontSize: '16px', padding: '4px 10px' },
                    onClick: () => setShowHelp(v => !v),
                    title: 'Помощь (H)'
                }, '?')
            ),
            React.createElement('div', {className:'main-content'},
                React.createElement('div', {className:'minimap-panel'},
                    React.createElement('div', {className:'minimap-header'}, 'Миникарта'),
                    React.createElement('div', {style:{padding:'10px'}}, 
                        React.createElement('canvas', {id: 'minimap-canvas-el', onClick: (e) => {
                            const rect = e.target.getBoundingClientRect();
                            const x = Math.floor((e.clientX - rect.left) / rect.width * gridSize.cols);
                            const y = Math.floor((e.clientY - rect.top) / rect.height * gridSize.rows);
                            const newPatch = {y: Math.max(0, Math.min(gridSize.rows-1, y)), x: Math.max(0, Math.min(gridSize.cols-1, x))};
                            setCurrentPatch(newPatch);
                            // Reset camera to center on the new patch
                            setZoom(1); zoomRef.current = 1;
                            setOffset({x: 0, y: 0}); offsetRef.current = {x: 0, y: 0};
                        }})
                    ),
                    // Progress bar under minimap
                    segProgress.total > 0 && React.createElement('div', {style:{padding:'0 10px 10px 10px'}},
                        React.createElement('div', {style:{
                            width:'100%', height:'16px', backgroundColor:'#2a2a3e',
                            borderRadius:'8px', overflow:'hidden', position:'relative'
                        }},
                            React.createElement('div', {style:{
                                width: (segProgress.done / segProgress.total * 100) + '%',
                                height:'100%',
                                backgroundColor: segProgress.done >= segProgress.total ? '#28a745' : '#4a9eff',
                                borderRadius:'8px',
                                transition:'width 0.3s ease'
                            }})
                        ),
                        React.createElement('div', {style:{
                            textAlign:'center', fontSize:'15px', fontWeight:'500', color:'#aaa', marginTop:'4px'
                        }}, `Глобально: ${segProgress.done} / ${segProgress.total} (${Math.round(segProgress.done / segProgress.total * 100)}%) | Осталось: ${segProgress.untagged}`),
                        React.createElement('div', {style:{
                            textAlign:'center', fontSize:'15px', fontWeight:'500', color:'#aaa', marginTop:'2px'
                        }}, `В этом квадрате: ${patchStats.tagged} / ${patchStats.total} размечено | Осталось: ${patchStats.total - patchStats.tagged}`)
                    )
                ),
                React.createElement('div', {className:'viewer-panel', ref: viewerCallbackRef,
                    onMouseDown:handleMouseDown, onMouseMove:handleMouseMove, onMouseUp:handleMouseUp, onMouseLeave:handleMouseUp,
                    onContextMenu: (e) => e.preventDefault()
                },
                    React.createElement('div', {
                        className:'viewer-canvas',
                        style:{
                            transform:`translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
                            transformOrigin: '0 0',
                            position: 'relative',
                            width: '1024px',
                            height: '1024px'
                        },
                        onClick:handleImageClick
                    },
                        // Layer 1: Background Layer
                        React.createElement('canvas', {
                            ref: canvasBgRef, 
                            style: { position: 'absolute', top: 0, left: 0, opacity: 1.0, zIndex: 1 }
                        }),
                        // Layer 2: Black-and-white Bounds with multiply
                        React.createElement('canvas', {
                            ref: canvasBoundRef, 
                            style: { 
                                position: 'absolute', top: 0, left: 0, 
                                opacity: showBounds ? 0.8 : 0, 
                                mixBlendMode: 'multiply',
                                zIndex: 2, pointerEvents: 'none'
                            }
                        }),
                        // Layer 3: Colored Segments (RGBA handled by backend)
                        React.createElement('canvas', {
                            ref: canvasSegRef, 
                            style: { 
                                position: 'absolute', top: 0, left: 0, 
                                opacity: showSegments ? 1.0 : 0, 
                                mixBlendMode: 'normal',
                                zIndex: 3, pointerEvents: 'none' 
                            }
                        }),
                        // Layer 4: Segment borders (black outlines)
                        React.createElement('canvas', {
                            ref: canvasBorderRef,
                            style: {
                                position: 'absolute', top: 0, left: 0,
                                opacity: showSegments ? 0.6 : 0,
                                mixBlendMode: 'multiply',
                                zIndex: 4, pointerEvents: 'none'
                            }
                        }),
                        // Layer 5: Untagged highlight (red overlay)
                        React.createElement('canvas', {
                            ref: canvasUntaggedRef,
                            style: {
                                position: 'absolute', top: 0, left: 0,
                                opacity: showUntagged ? 0.6 : 0,
                                zIndex: 5, pointerEvents: 'none'
                            }
                        }),
                        // Layer 6: Selection highlight (green stripes)
                        React.createElement('canvas', {
                            ref: canvasSelectionRef,
                            style: {
                                position: 'absolute', top: 0, left: 0,
                                opacity: selectedSegments.length > 0 ? 0.5 : 0,
                                zIndex: 6, pointerEvents: 'none'
                            }
                        }),
                        !patchReady && React.createElement('div', {style:{position:'absolute',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.4)',display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',zIndex: 7}}, '⏳ Обработка...')
                    )
                ),
                React.createElement('div', {className: 'tags-panel', style: {width: sidebarWidth + 'px'}},
                    // Resize handle
                    React.createElement('div', {className: 'sidebar-resize', onMouseDown: startResize}),
                    // Header
                    React.createElement('div', {className: 'tags-header'},
                        React.createElement('span', null, 'Теги минералов ', React.createElement('span', {style:{color:'#888',fontWeight:400}}, '(' + treeData.length + ')')),
                        React.createElement('div', {style:{display:'flex',gap:'4px'}},
                            React.createElement('button', {className:'btn btn-secondary', style:{padding:'2px 6px',fontSize:'11px',opacity:canUndo?1:0.3}, onClick:handleUndo, disabled:!canUndo, title:'Undo (Ctrl+Z)'}, '↩'),
                            React.createElement('button', {className:'btn btn-secondary', style:{padding:'2px 6px',fontSize:'11px',opacity:canRedo?1:0.3}, onClick:handleRedo, disabled:!canRedo, title:'Redo (Ctrl+Y)'}, '↪')
                        )
                    ),
                    // Quick input
                    (quickInput || selectedSegments.length > 0) && React.createElement('div', {className:'quick-input'},
                        React.createElement('div', {className:'quick-input-label'},
                            selectedSegments.length > 0
                                ? 'Выбрано: ' + selectedSegments.length + ' ' + pluralSeg(selectedSegments.length)
                                : quickInput ? 'Сегмент #' + quickInput.segmentId + ' · Патч ' + quickInput.patchY + ',' + quickInput.patchX : ''
                        ),
                        React.createElement('input', {
                            ref: quickInputRef,
                            placeholder: 'Название минерала...',
                            value: quickFilter,
                            onChange: function(e) { setQuickFilter(e.target.value); setQuickHighlight(0); },
                            onKeyDown: function(e) {
                                e.stopPropagation();
                                if (e.key === 'Enter') {
                                    var filtered = Object.keys(tags).filter(function(n) { return n.toLowerCase().includes(quickFilter.toLowerCase()); });
                                    var chosen = filtered[quickHighlight] || quickFilter;
                                    if (chosen.trim()) applyTag(chosen);
                                } else if (e.key === 'Escape') {
                                    setQuickInput(null); setQuickFilter(''); setSelectedSegments([]);
                                } else if (e.key === 'ArrowDown') {
                                    e.preventDefault(); setQuickHighlight(function(h) { return h + 1; });
                                } else if (e.key === 'ArrowUp') {
                                    e.preventDefault(); setQuickHighlight(function(h) { return Math.max(0, h - 1); });
                                } else if (e.key === 'Tab') {
                                    e.preventDefault();
                                    var filtered2 = Object.keys(tags).filter(function(n) { return n.toLowerCase().includes(quickFilter.toLowerCase()); });
                                    if (filtered2[quickHighlight]) setQuickFilter(filtered2[quickHighlight]);
                                }
                            }
                        }),
                        React.createElement('div', {className:'quick-input-hint'}, 'Enter — применить · Esc — отмена'),
                        quickFilter && React.createElement('div', {className:'quick-input-suggestions'},
                            Object.entries(tags).filter(function(entry) { return entry[0].toLowerCase().includes(quickFilter.toLowerCase()); }).slice(0, 8).map(function(entry, i) {
                                var n = entry[0], c = entry[1];
                                return React.createElement('div', {
                                    key: n,
                                    className: 'quick-input-suggestion' + (i === quickHighlight ? ' highlighted' : ''),
                                    onClick: function() { applyTag(n); }
                                },
                                    React.createElement('span', {style:{width:12,height:12,borderRadius:'50%',background:c,display:'inline-block'}}),
                                    React.createElement('span', null, n)
                                );
                            })
                        ),
                        selectedSegments.length > 1 && React.createElement('button', {
                            className:'btn btn-primary', style:{marginTop:'4px',width:'100%',padding:'4px'},
                            onClick: function() { if (quickInputRef.current) quickInputRef.current.focus(); }
                        }, 'Задать тег')
                    ),
                    // Tree
                    React.createElement('div', {className:'tags-list'},
                        treeData.map(function(tag) { return React.createElement(React.Fragment, {key: tag.name},
                            // Level 1: Tag
                            React.createElement('div', {
                                className: 'tree-node tree-level-1' + (treeSelection.has('tag:'+tag.name) ? ' selected' : ''),
                                onContextMenu: function(e) { e.preventDefault(); setContextMenu({x:e.clientX,y:e.clientY,tagName:tag.name,tagColor:tag.color,level:'tag'}); },
                                onClick: function(e) {
                                    if (e.ctrlKey || e.shiftKey) { handleTreeClick(e, 'tag:' + tag.name); return; }
                                    setExpandedNodes(function(prev) {
                                        var next = new Set(prev);
                                        var key = 'tag:' + tag.name;
                                        next.has(key) ? next.delete(key) : next.add(key);
                                        return next;
                                    });
                                }
                            },
                                React.createElement('span', {className:'tree-node-arrow', onClick: function(e) {
                                    e.stopPropagation();
                                    setExpandedNodes(function(prev) {
                                        var next = new Set(prev);
                                        var key = 'tag:'+tag.name;
                                        next.has(key) ? next.delete(key) : next.add(key);
                                        return next;
                                    });
                                }}, expandedNodes.has('tag:'+tag.name) ? '▼' : '▶'),
                                React.createElement('span', {className:'tree-node-color', style:{backgroundColor:tag.color}}),
                                React.createElement('span', {className:'tree-node-label'}, tag.name),
                                React.createElement('span', {className:'tree-node-count'}, tag.total_segments)
                            ),
                            // Level 2: Patches (if expanded)
                            expandedNodes.has('tag:'+tag.name) && tag.patches.map(function(patch) {
                                return React.createElement(React.Fragment, {key: patch.patch_y+','+patch.patch_x},
                                    React.createElement('div', {
                                        className: 'tree-node tree-level-2',
                                        onClick: function(e) {
                                            if (e.ctrlKey || e.shiftKey) { handleTreeClick(e, 'patch:' + tag.name + ':' + patch.patch_y + ',' + patch.patch_x); return; }
                                            setCurrentPatch({y:patch.patch_y, x:patch.patch_x}); setPatchReady(false);
                                        },
                                        onContextMenu: function(e) { e.preventDefault(); setContextMenu({x:e.clientX,y:e.clientY,tagName:tag.name,tagColor:tag.color,level:'patch',patchY:patch.patch_y,patchX:patch.patch_x}); }
                                    },
                                        React.createElement('span', {className:'tree-node-arrow', onClick: function(e) {
                                            e.stopPropagation();
                                            setExpandedNodes(function(prev) {
                                                var next = new Set(prev);
                                                var key = 'patch:'+tag.name+':'+patch.patch_y+','+patch.patch_x;
                                                next.has(key) ? next.delete(key) : next.add(key);
                                                return next;
                                            });
                                        }}, expandedNodes.has('patch:'+tag.name+':'+patch.patch_y+','+patch.patch_x) ? '▼' : '▶'),
                                        React.createElement('span', {className:'tree-node-label'}, 'Патч '+patch.patch_y+','+patch.patch_x),
                                        React.createElement('span', {className:'tree-node-count'}, patch.count)
                                    ),
                                    // Level 3: Segments
                                    expandedNodes.has('patch:'+tag.name+':'+patch.patch_y+','+patch.patch_x) && patch.segments.map(function(sid) {
                                        return React.createElement('div', {
                                            key: sid,
                                            className: 'tree-node tree-level-3' + (treeSelection.has('seg:'+patch.patch_y+','+patch.patch_x+':'+sid) ? ' selected' : ''),
                                            onClick: function(e) {
                                                if (e.ctrlKey || e.shiftKey) { handleTreeClick(e, 'seg:' + patch.patch_y + ',' + patch.patch_x + ':' + sid); return; }
                                                setCurrentPatch({y:patch.patch_y, x:patch.patch_x}); setPatchReady(false);
                                            },
                                            onContextMenu: function(e) { e.preventDefault(); setContextMenu({x:e.clientX,y:e.clientY,tagName:tag.name,tagColor:tag.color,level:'segment',patchY:patch.patch_y,patchX:patch.patch_x,segmentId:sid}); }
                                        },
                                            React.createElement('span', {className:'tree-node-label', style:{color:'#aaa'}}, '#'+sid)
                                        );
                                    })
                                );
                            })
                        ); })
                    )
                )
            ),
            contextMenu && React.createElement('div', {
                className:'context-menu-overlay',
                onClick: function() { setContextMenu(null); setDeleteConfirm(null); },
                onContextMenu: function(e) { e.preventDefault(); setContextMenu(null); setDeleteConfirm(null); },
                style:{position:'fixed', top:0, left:0, right:0, bottom:0, zIndex:9999}
            },
                React.createElement('div', {
                    className:'context-menu',
                    onClick: function(e) { e.stopPropagation(); },
                    style:{
                        position:'fixed', left: contextMenu.x + 'px', top: contextMenu.y + 'px',
                        background:'#1e1e2e', border:'1px solid #444', borderRadius:'6px',
                        boxShadow:'0 4px 16px rgba(0,0,0,0.5)', padding:'4px 0', minWidth:'180px', zIndex:10000
                    }
                },
                    treeSelection.size > 0 && React.createElement('div', {
                        style:{padding:'6px 16px', fontSize:'11px', color:'#888', borderBottom:'1px solid #333'}
                    }, 'Выбрано: ' + treeSelection.size + ' ' + (treeSelection.size === 1 ? 'элемент' : 'элементов') + ' (' + resolveTreeSelection(treeSelection).size + ' ' + pluralSeg(resolveTreeSelection(treeSelection).size) + ')'),

                    (contextMenu.level === 'tag' && treeSelection.size === 0) && React.createElement('div', {
                        style:{padding:'8px 16px', cursor:'pointer', fontSize:'13px', color:'#ddd', display:'flex', alignItems:'center', gap:'8px'},
                        onMouseEnter: function(e) { e.currentTarget.style.background = '#2a2a4a'; },
                        onMouseLeave: function(e) { e.currentTarget.style.background = 'transparent'; },
                        onClick: function() {
                            var oldName = contextMenu.tagName;
                            setContextMenu(null);
                            var newName = prompt('Новое имя тега:', oldName);
                            if (newName && newName.trim() && newName.trim() !== oldName) {
                                api.post('/api/rename-tag', {old_name: oldName, new_name: newName.trim()}).then(function() {
                                    fetchTree(); loadSegmentationData(); api.get('/api/tags').then(function(d) { setTags(d.tag_colors || {}); });
                                });
                            }
                        }
                    }, '✏️ Переименовать'),

                    treeSelection.size > 0 && React.createElement('div', {
                        style:{padding:'8px 16px', cursor:'pointer', fontSize:'13px', color:'#ddd', display:'flex', alignItems:'center', gap:'8px'},
                        onMouseEnter: function(e) { e.currentTarget.style.background = '#2a2a4a'; },
                        onMouseLeave: function(e) { e.currentTarget.style.background = 'transparent'; },
                        onClick: function() {
                            var resolved = resolveTreeSelection(treeSelection);
                            var segs = [];
                            resolved.forEach(function(key) {
                                var parts = key.split(':');
                                var coords = parts[1].split(',').map(Number);
                                var sid = parseInt(parts[2]);
                                segs.push({id: sid, patchY: coords[0], patchX: coords[1]});
                            });
                            setSelectedSegments(segs);
                            setContextMenu(null);
                            setTimeout(function() { if (quickInputRef.current) quickInputRef.current.focus(); }, 50);
                        }
                    }, '✏️ Назначить тег'),

                    React.createElement('div', {
                        style:{padding:'8px 16px', cursor:'pointer', fontSize:'13px', color:'#ddd', display:'flex', alignItems:'center', gap:'8px'},
                        onMouseEnter: function(e) { e.currentTarget.style.background = '#2a2a4a'; },
                        onMouseLeave: function(e) { e.currentTarget.style.background = 'transparent'; },
                        onClick: function() {
                            var input = document.createElement('input');
                            input.type = 'color';
                            input.value = contextMenu.tagColor;
                            input.style.position = 'fixed';
                            input.style.opacity = '0';
                            document.body.appendChild(input);
                            input.onchange = function() {
                                var tagName = contextMenu.tagName;
                                api.post('/api/recolor-tag', {tag_name: tagName, new_color: input.value}).then(function() {
                                    fetchTree(); loadSegmentationData(); api.get('/api/tags').then(function(d) { setTags(d.tag_colors || {}); });
                                });
                                document.body.removeChild(input);
                            };
                            input.addEventListener('cancel', function() { document.body.removeChild(input); });
                            setContextMenu(null);
                            input.click();
                        }
                    }, '🎨 Сменить цвет'),

                    (contextMenu.level === 'patch' || contextMenu.level === 'segment') && React.createElement('div', {
                        style:{padding:'8px 16px', cursor:'pointer', fontSize:'13px', color:'#ddd', display:'flex', alignItems:'center', gap:'8px'},
                        onMouseEnter: function(e) { e.currentTarget.style.background = '#2a2a4a'; },
                        onMouseLeave: function(e) { e.currentTarget.style.background = 'transparent'; },
                        onClick: function() {
                            setCurrentPatch({y: contextMenu.patchY, x: contextMenu.patchX});
                            setPatchReady(false);
                            setContextMenu(null);
                        }
                    }, '📍 Перейти'),

                    React.createElement('div', {style:{borderTop:'1px solid #444', margin:'4px 0'}}),

                    !deleteConfirm && React.createElement('div', {
                        style:{padding:'8px 16px', cursor:'pointer', fontSize:'13px', color:'#ff6b6b', display:'flex', alignItems:'center', gap:'8px'},
                        onMouseEnter: function(e) { e.currentTarget.style.background = '#2a2a4a'; },
                        onMouseLeave: function(e) { e.currentTarget.style.background = 'transparent'; },
                        onClick: function() {
                            if (treeSelection.size > 0) {
                                var resolved = resolveTreeSelection(treeSelection);
                                setDeleteConfirm({tagName: 'selected', count: resolved.size, resolved: resolved});
                            } else if (contextMenu.level === 'tag') {
                                var total = treeData.find(function(t) { return t.name === contextMenu.tagName; });
                                setDeleteConfirm({tagName: contextMenu.tagName, count: total ? total.total_segments : 0, level: 'tag'});
                            } else {
                                setDeleteConfirm({tagName: contextMenu.tagName, count: 1, level: contextMenu.level, patchY: contextMenu.patchY, patchX: contextMenu.patchX, segmentId: contextMenu.segmentId});
                            }
                        }
                    }, '🗑️ Удалить тег'),

                    deleteConfirm && React.createElement('div', {style:{padding:'8px', background:'#2a2020', border:'1px solid #5a3030', borderRadius:'6px', margin:'4px 8px'}},
                        React.createElement('div', {style:{color:'#ff6b6b', marginBottom:'4px', fontSize:'12px'}},
                            deleteConfirm.resolved
                                ? 'Удалить теги у ' + deleteConfirm.count + ' ' + pluralSeg(deleteConfirm.count) + '?'
                                : 'Удалить "' + deleteConfirm.tagName + '" (' + deleteConfirm.count + ' ' + pluralSeg(deleteConfirm.count) + ')?'
                        ),
                        React.createElement('div', {style:{display:'flex',gap:'8px'}},
                            React.createElement('button', {className:'btn', style:{background:'#ff4444',color:'#fff',padding:'4px 12px',border:'none',borderRadius:'4px',cursor:'pointer'}, onClick: function() {
                                if (deleteConfirm.resolved) {
                                    var segs = [];
                                    deleteConfirm.resolved.forEach(function(key) {
                                        var parts = key.split(':');
                                        var coords = parts[1].split(',').map(Number);
                                        var sid = parseInt(parts[2]);
                                        segs.push({patch_y: coords[0], patch_x: coords[1], segment_id: sid});
                                    });
                                    api.post('/api/untag-segments', {segments: segs}).then(function() {
                                        setDeleteConfirm(null); setContextMenu(null); setTreeSelection(new Set());
                                        fetchTree(); loadSegmentationData(); api.get('/api/tags').then(function(d) { setTags(d.tag_colors || {}); });
                                    });
                                } else if (deleteConfirm.level === 'tag') {
                                    api.post('/api/delete-tag', {tag_name: deleteConfirm.tagName}).then(function() {
                                        setDeleteConfirm(null); setContextMenu(null);
                                        fetchTree(); loadSegmentationData(); api.get('/api/tags').then(function(d) { setTags(d.tag_colors || {}); });
                                    });
                                } else {
                                    var segs2 = [{patch_y: deleteConfirm.patchY, patch_x: deleteConfirm.patchX, segment_id: deleteConfirm.segmentId}];
                                    api.post('/api/untag-segments', {segments: segs2}).then(function() {
                                        setDeleteConfirm(null); setContextMenu(null);
                                        fetchTree(); loadSegmentationData(); api.get('/api/tags').then(function(d) { setTags(d.tag_colors || {}); });
                                    });
                                }
                            }}, 'Удалить'),
                            React.createElement('button', {className:'btn btn-secondary', style:{padding:'4px 12px'}, onClick: function() { setDeleteConfirm(null); }}, 'Отмена')
                        )
                    )
                )
            ),
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
                            ['Ctrl+клик', 'Мультивыбор сегментов'],
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
        );
    }
    ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));
}
window.onload = initApp;
