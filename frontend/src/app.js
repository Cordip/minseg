/**
 * Mineral Segmentation Application - Main React Component
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';

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

// API helper
const createApi = (baseUrl) => ({
    baseUrl,
    async get(endpoint) {
        const response = await fetch(`${baseUrl}${endpoint}`);
        if (!response.ok) throw new Error(`API Error: ${response.status}`);
        return response.json();
    },

    async post(endpoint, data) {
        const response = await fetch(`${baseUrl}${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!response.ok) throw new Error(`API Error: ${response.status}`);
        return response.json();
    },
    
    async uploadFiles(endpoint, formData) {
        const response = await fetch(`${baseUrl}${endpoint}`, {
            method: 'POST',
            body: formData
        });
        if (!response.ok) throw new Error(`API Error: ${response.status}`);
        return response.json();
    }
});

// Color generation utility
function generateDistinctColor() {
    const hue = Math.random() * 360;
    const saturation = 60 + Math.random() * 30;
    const lightness = 50 + Math.random() * 20;
    return hslToHex(hue, saturation, lightness);
}

function hslToHex(h, s, l) {
    s /= 100;
    l /= 100;
    const a = s * Math.min(l, 1 - l);
    const f = n => {
        const k = (n + h / 30) % 12;
        const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
        return Math.round(255 * color).toString(16).padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
}

// Toast Component
function Toast({ message, type, onClose }) {
    useEffect(() => {
        const timer = setTimeout(onClose, 3000);
        return () => clearTimeout(timer);
    }, [onClose]);
    
    return React.createElement('div', { className: `toast ${type}` }, message);
}

function ToastContainer({ toasts, removeToast }) {
    return React.createElement('div', { className: 'toast-container' },
        toasts.map(toast => 
            React.createElement(Toast, {
                key: toast.id,
                ...toast,
                onClose: () => removeToast(toast.id)
            })
        )
    );
}

// Welcome Screen Component
function WelcomeScreen({ onLoadImages }) {
    return React.createElement('div', { className: 'welcome-screen' },
        React.createElement('h1', { className: 'welcome-title' }, 'Mineral Segmentation'),
        React.createElement('p', { className: 'welcome-subtitle' },
            'Загрузите изображения поляризованной микроскопии для сегментации и разметки минеральных зерен'
        ),
        React.createElement('div', { className: 'welcome-steps' },
            React.createElement('div', { className: 'welcome-step' },
                React.createElement('span', { className: 'step-number' }, '1'),
                React.createElement('div', { className: 'step-content' },
                    React.createElement('h4', null, 'Загрузите изображения'),
                    React.createElement('p', null, 'Выберите 4 изображения: PPL 45°, PPL 90°, XPL 45°, XPL 90°')
                )
            ),
            React.createElement('div', { className: 'welcome-step' },
                React.createElement('span', { className: 'step-number' }, '2'),
                React.createElement('div', { className: 'step-content' },
                    React.createElement('h4', null, 'Разметка сегментов'),
                    React.createElement('p', null, 'Кликните на сегмент для добавления тега минерала')
                )
            ),
            React.createElement('div', { className: 'welcome-step' },
                React.createElement('span', { className: 'step-number' }, '3'),
                React.createElement('div', { className: 'step-content' },
                    React.createElement('h4', null, 'Сохранение'),
                    React.createElement('p', null, 'Экспортируйте результаты разметки в файлы')
                )
            )
        ),
        React.createElement('button', {
            className: 'btn btn-primary',
            style: { marginTop: '30px', padding: '12px 32px', fontSize: '16px' },
            onClick: onLoadImages
        }, 'Загрузить изображения')
    );
}

// Image Assignment Modal
function AssignmentModal({ files, onAssign, onCancel }) {
    const [assignments, setAssignments] = useState({
        ppl45: '',
        ppl90: '',
        xpl45: '',
        xpl90: ''
    });
    
    const handleAssign = () => {
        if (Object.values(assignments).every(a => a)) {
            onAssign(assignments);
        }
    };
    
    const labels = {
        ppl45: 'PPL 45°',
        ppl90: 'PPL 90°',
        xpl45: 'XPL 45°',
        xpl90: 'XPL 90°'
    };
    
    return React.createElement('div', { className: 'modal-overlay' },
        React.createElement('div', { className: 'assignment-dialog' },
            React.createElement('h3', { className: 'modal-header' }, 'Назначьте файлы изображений'),
            React.createElement('div', { className: 'assignment-grid' },
                Object.keys(labels).map(key =>
                    React.createElement('div', { key, className: 'assignment-item' },
                        React.createElement('label', null, labels[key]),
                        React.createElement('select', {
                            className: 'assignment-select',
                            value: assignments[key],
                            onChange: (e) => setAssignments({ ...assignments, [key]: e.target.value })
                        },
                            React.createElement('option', { value: '' }, '-- Выберите файл --'),
                            files.map(file =>
                                React.createElement('option', { 
                                    key: file.path, 
                                    value: file.path,
                                    disabled: Object.values(assignments).includes(file.path) && assignments[key] !== file.path
                                }, file.name)
                            )
                        )
                    )
                )
            ),
            React.createElement('div', { className: 'modal-buttons' },
                React.createElement('button', { className: 'btn btn-secondary', onClick: onCancel }, 'Отмена'),
                React.createElement('button', {
                    className: 'btn btn-primary',
                    onClick: handleAssign,
                    disabled: !Object.values(assignments).every(a => a)
                }, 'Загрузить')
            )
        )
    );
}

// Minimap Component with grid and per-cell state overlays
function Minimap({ minimapData, currentPatch, gridSize, patchSize, onPatchClick, segmentationProgress, isSegmenting, patchStates, animTick }) {
    const canvasRef = useRef(null);

    // Draw minimap with per-cell state overlays and grid
    useEffect(() => {
        if (!minimapData || !canvasRef.current) return;

        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        const img = new Image();

        img.onload = () => {
            canvas.width = img.width;
            canvas.height = img.height;

            // Draw image
            ctx.drawImage(img, 0, 0);

            const cw = canvas.width / gridSize.cols;
            const ch = canvas.height / gridSize.rows;

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

            // Draw grid lines
            if (gridSize.cols > 0 && gridSize.rows > 0) {
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
                ctx.lineWidth = 1;

                // Vertical lines
                for (let i = 0; i <= gridSize.cols; i++) {
                    ctx.beginPath();
                    ctx.moveTo(i * cw, 0);
                    ctx.lineTo(i * cw, canvas.height);
                    ctx.stroke();
                }

                // Horizontal lines
                for (let i = 0; i <= gridSize.rows; i++) {
                    ctx.beginPath();
                    ctx.moveTo(0, i * ch);
                    ctx.lineTo(canvas.width, i * ch);
                    ctx.stroke();
                }

                // Highlight current patch (red, matching app-bundle.js style)
                if (currentPatch) {
                    ctx.strokeStyle = '#ff4757';
                    ctx.lineWidth = 3;
                    ctx.strokeRect(currentPatch.x * cw, currentPatch.y * ch, cw, ch);
                    ctx.fillStyle = 'rgba(255, 71, 87, 0.2)';
                    ctx.fillRect(currentPatch.x * cw, currentPatch.y * ch, cw, ch);
                }
            }
        };
        img.src = `data:image/png;base64,${minimapData.image}`;
    }, [minimapData, gridSize, currentPatch, patchStates, animTick]);
    
    const handleClick = (e) => {
        if (!gridSize.cols || !gridSize.rows) return;
        
        const rect = canvasRef.current.getBoundingClientRect();
        const x = Math.floor((e.clientX - rect.left) / rect.width * gridSize.cols);
        const y = Math.floor((e.clientY - rect.top) / rect.height * gridSize.rows);
        
        // Clamp to valid range
        const clampedX = Math.max(0, Math.min(gridSize.cols - 1, x));
        const clampedY = Math.max(0, Math.min(gridSize.rows - 1, y));
        
        onPatchClick(clampedY, clampedX);
    };
    
    const progress = segmentationProgress.total > 0 
        ? (segmentationProgress.completed / segmentationProgress.total) * 100 
        : 0;
    
    return React.createElement('div', { className: 'minimap-panel' },
        React.createElement('div', { className: 'minimap-header' }, 'Карта патчей'),
        React.createElement('div', { className: 'minimap-container' },
            minimapData ? React.createElement('div', { className: 'minimap-wrapper' },
                React.createElement('canvas', {
                    ref: canvasRef,
                    className: 'minimap-canvas',
                    onClick: handleClick,
                    style: { 
                        width: '100%', 
                        height: 'auto', 
                        cursor: 'pointer',
                        borderRadius: '4px'
                    }
                })
            ) : React.createElement('div', { 
                style: { color: '#666', textAlign: 'center', paddingTop: '40px' } 
            }, 'Нет данных')
        ),
        
        // Progress bar UNDER the minimap
        React.createElement('div', { className: 'minimap-progress-section' },
            React.createElement('div', { className: 'minimap-progress-header' },
                React.createElement('span', { className: 'minimap-progress-title' }, 'Сегментация'),
                React.createElement('span', { className: 'minimap-progress-count' }, 
                    `${segmentationProgress.completed} / ${segmentationProgress.total}`
                )
            ),
            React.createElement('div', { className: 'minimap-progress-bar' },
                React.createElement('div', { 
                    className: 'minimap-progress-fill',
                    style: { width: `${progress}%` }
                })
            ),
            isSegmenting && React.createElement('div', { className: 'minimap-progress-status' },
                React.createElement('span', { className: 'status-dot warning' }),
                'Обработка...'
            )
        )
    );
}

// Main Image Viewer Component
function ImageViewer({
    currentImage,
    segmentsImage,
    boundsImage,
    showSegments,
    showBounds,
    zoom,
    offset,
    currentView,
    onWheel,
    onMouseDown,
    onMouseMove,
    onMouseUp,
    onImageClick,
    patchReady,
    selectedSegments,
    api,
    currentPatch
}) {
    const canvasRef = useRef(null);
    const canvasSelectionRef = useRef(null);
    const [dragStart, setDragStart] = useState(null);
    const [isDragging, setIsDragging] = useState(false);

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

    useEffect(() => {
        if (!selectedSegments || selectedSegments.length === 0) {
            const c = canvasSelectionRef.current;
            if (c) c.getContext('2d').clearRect(0, 0, c.width, c.height);
            return;
        }
        if (!api || !currentPatch) return;
        const ids = selectedSegments
            .filter(s => s.patchY === currentPatch.y && s.patchX === currentPatch.x)
            .map(s => s.id).join(',');
        if (!ids) return;
        api.get(`/api/selection-mask/${currentPatch.y}/${currentPatch.x}?ids=${ids}`)
            .then(d => { drawSelectionStripes(d.image); })
            .catch(() => {});
    }, [selectedSegments, currentPatch]);
    
    const handleMouseDown = (e) => {
        if (e.button === 2) { // Right click for panning
            setIsDragging(true);
            setDragStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
        }
    };
    
    const handleMouseMove = (e) => {
        if (isDragging && dragStart) {
            onMouseMove({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
        }
    };
    
    const handleMouseUp = () => {
        setIsDragging(false);
        setDragStart(null);
    };
    
    const handleClick = async (e) => {
        if (isDragging) return;
        
        const rect = e.currentTarget.getBoundingClientRect();
        const x = Math.floor((e.clientX - rect.left - offset.x) / zoom);
        const y = Math.floor((e.clientY - rect.top - offset.y) / zoom);
        
        if (x >= 0 && y >= 0 && x < 1024 && y < 1024) {
            onImageClick(x, y, e);
        }
    };
    
    const handleWheel = (e) => {
        e.preventDefault();
        const rect = e.currentTarget.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        onWheel(e.deltaY, mouseX, mouseY);
    };
    
    // Composite images
    let displayImage = currentImage;
    
    if (showSegments && segmentsImage && currentImage) {
        displayImage = segmentsImage;
    }
    
    if (showBounds && boundsImage && currentImage) {
        displayImage = boundsImage;
    }
    
    return React.createElement('div', { 
        className: 'viewer-container',
        onContextMenu: e => e.preventDefault()
    },
        currentImage ? React.createElement('div', {
            className: 'viewer-canvas',
            style: {
                transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
                transformOrigin: '0 0'
            },
            onMouseDown: handleMouseDown,
            onMouseMove: handleMouseMove,
            onMouseUp: handleMouseUp,
            onMouseLeave: handleMouseUp,
            onClick: handleClick,
            onWheel: handleWheel
        },
            React.createElement('img', {
                className: 'viewer-image',
                src: `data:image/png;base64,${displayImage}`,
                alt: 'Patch',
                draggable: false
            }),
            // Selection highlight (green stripes)
            React.createElement('canvas', {
                ref: canvasSelectionRef,
                style: {
                    position: 'absolute', top: 0, left: 0,
                    opacity: selectedSegments && selectedSegments.length > 0 ? 0.5 : 0,
                    zIndex: 6, pointerEvents: 'none'
                }
            }),
            // Show overlay while segmenting
            !patchReady && React.createElement('div', {
                style: {
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: 'rgba(0, 0, 0, 0.3)',
                    color: '#fff',
                    fontSize: '14px',
                    pointerEvents: 'none'
                }
            }, 'Сегментация...')
        ) : React.createElement('div', {
            style: {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                color: '#666'
            }
        }, 'Загрузка...')
    );
}

// Main App Component
function App() {
    // State
    const [api, setApi] = useState(null);
    const [imagesLoaded, setImagesLoaded] = useState(false);
    const [imagesAligned, setImagesAligned] = useState(false);
    const [gridSize, setGridSize] = useState({ rows: 0, cols: 0 });
    const [currentPatch, setCurrentPatch] = useState({ y: 0, x: 0 });
    const [currentView, setCurrentView] = useState('xpl45');
    const [isXpl, setIsXpl] = useState(true);
    const [isXpl90, setIsXpl90] = useState(false);
    const [showSegments, setShowSegments] = useState(true);
    const [showBounds, setShowBounds] = useState(false);
    const [zoom, setZoom] = useState(1);
    const [offset, setOffset] = useState({ x: 0, y: 0 });
    const [currentImage, setCurrentImage] = useState(null);
    const [segmentsImage, setSegmentsImage] = useState(null);
    const [boundsImage, setBoundsImage] = useState(null);
    const [segmentationProgress, setSegmentationProgress] = useState({ total: 0, completed: 0 });
    const [isSegmenting, setIsSegmenting] = useState(false);
    const [tags, setTags] = useState({});
    const [toasts, setToasts] = useState([]);
    const [selectedSegments, setSelectedSegments] = useState([]); // [{id, patchY, patchX}]
    const [showAssignmentModal, setShowAssignmentModal] = useState(false);
    const [pendingFiles, setPendingFiles] = useState([]);
    const [minimapData, setMinimapData] = useState(null);
    const [patchReady, setPatchReady] = useState(false);
    const [pendingPaths, setPendingPaths] = useState(null);
    const [patchStates, setPatchStates] = useState({}); // {'py,px': 'processed'|'active'|'pending'}
    const [animTick, setAnimTick] = useState(0); // drives minimap spinner animation
    const [showHelp, setShowHelp] = useState(false);
    const [contextMenu, setContextMenu] = useState(null); // {x, y, tagName, tagColor}
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
    const showHelpRef = useRef(false);

    const patchSize = 1024;
    
    // Initialize API
    useEffect(() => {
        const initApi = async () => {
            let apiUrl = 'http://127.0.0.1:8000';
            if (window.electronAPI) {
                apiUrl = await window.electronAPI.getApiUrl();
            }
            const newApi = createApi(apiUrl);
            setApi(newApi);
            try {
                const status = await newApi.get('/api/status');
                if (status.images_aligned) {
                    setImagesAligned(true);
                    setImagesLoaded(true);
                    setGridSize(status.grid_size);
                }
            } catch (e) {}
            const ls = document.getElementById('loading-screen');
            if (ls) ls.style.display = 'none';
        };
        initApi();
    }, []);

    useEffect(() => { showHelpRef.current = showHelp; }, [showHelp]);

    
    // Poll segmentation progress (2s when processing, 5s when idle)
    const isProcessingRef = useRef(false);
    useEffect(() => {
        if (!api || !imagesAligned) return;
        const fetchProgress = () => {
            api.get('/api/status').then(s => {
                setSegmentationProgress({ done: s.segmented_patches || 0, total: s.total_patches || 0, completed: s.segmented_patches || 0 });
                setIsSegmenting(s.is_segmenting);
                isProcessingRef.current = s.is_segmenting;
            }).catch(() => {});
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

    // Animate minimap spinner when patches are processing
    useEffect(() => {
        const hasActive = Object.values(patchStates).some(s => s === 'active');
        if (!hasActive) return;
        const timer = setInterval(() => setAnimTick(t => t + 1), 200);
        return () => clearInterval(timer);
    }, [patchStates]);
    
    // Poll current patch segmentation status if not ready
    useEffect(() => {
        if (!api || !imagesAligned || patchReady) return;
        
        const checkPatchReady = async () => {
            try {
                const segData = await api.get(`/api/segmentation/${currentPatch.y}/${currentPatch.x}`);
                if (segData.status === 'ready') {
                    setSegmentsImage(segData.colored_segments);
                    setBoundsImage(segData.bounds);
                    setPatchReady(true);
                }
            } catch (e) {
                console.error('Failed to check patch status:', e);
            }
        };
        
        // Check immediately
        checkPatchReady();
        
        const interval = setInterval(checkPatchReady, 1000);
        return () => clearInterval(interval);
    }, [api, imagesAligned, currentPatch, patchReady]);
    
    // Continue loading after images are aligned
    useEffect(() => {
        if (!api || !imagesAligned || !pendingPaths) return;
        
        const continueLoading = async () => {
            console.log('Continuing loading after alignment...');
            
            // Start segmentation in background
            console.log('Starting background segmentation...');
            api.post('/api/start-segmentation').then(() => {
                setIsSegmenting(true);
                console.log('Segmentation started in background');
            }).catch(e => console.error('Segmentation start error:', e));
            addToast('Сегментация запущена', 'info');
            
            // Load first patch with priority segmentation
            console.log('Loading first patch...');
            try {
                const imageData = await api.get(`/api/patch/0/0?image_type=xpl45`);
                console.log('Got patch image');
                setCurrentImage(imageData.image);
                
                console.log('Requesting priority segmentation for patch 0,0');
                await api.post('/api/segment-patch/0/0');
                
                const segData = await api.get('/api/segmentation/0/0');
                console.log('Segmentation status:', segData.status);
                if (segData.status === 'ready') {
                    setSegmentsImage(segData.colored_segments);
                    setBoundsImage(segData.bounds);
                    setPatchReady(true);
                }
            } catch (e) {
                console.error('Error loading initial patch:', e);
            }
            
            // Load minimap
            try {
                const minimapResult = await api.get('/api/minimap?image_type=xpl45');
                setMinimapData(minimapResult);
                console.log('Minimap loaded');
            } catch (e) {
                console.error('Error loading minimap:', e);
            }
            
            setPendingPaths(null);
        };
        
        continueLoading();
    }, [api, imagesAligned, pendingPaths]);
    
    // Helper functions
    const addToast = (message, type = 'info') => {
        const id = Date.now();
        setToasts(prev => [...prev, { id, message, type }]);
    };
    
    const removeToast = (id) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    };
    
    const handleLoadImages = async () => {
        if (!window.electronAPI) {
            addToast('Файловый диалог доступен только в Electron', 'error');
            return;
        }
        
        const result = await window.electronAPI.selectImages();
        
        if (result.canceled) return;
        
        if (result.needsAssignment) {
            setPendingFiles(result.files.map(f => ({
                path: f,
                name: f.split(/[/\\]/).pop()
            })));
            setShowAssignmentModal(true);
        } else {
            await uploadImages(result);
        }
    };
    
    const handleAssignImages = async (assignments) => {
        setShowAssignmentModal(false);
        await uploadImages(assignments);
    };
    
    const uploadImages = async (paths) => {
        if (!api) {
            addToast('API не готов', 'error');
            return;
        }
        try {
            addToast('Загрузка изображений...', 'info');
            await api.post('/api/load-all-paths', {
                ppl45: paths.ppl45,
                ppl90: paths.ppl90,
                xpl45: paths.xpl45,
                xpl90: paths.xpl90
            });
            addToast('Изображения загружены', 'success');
            
            // Align images
            addToast('Выравнивание изображений...', 'info');
            console.log('Aligning images...');
            const alignResult = await api.post('/api/align-images');
            console.log('Alignment result:', alignResult);
            
            // Set all state at once - this triggers re-render
            setGridSize({ rows: alignResult.grid_size.rows, cols: alignResult.grid_size.cols });
            setImagesAligned(true);
            setImagesLoaded(true);
            setPendingPaths(paths);  // This triggers the continueLoading effect
            addToast('Изображения выровнены', 'success');
            
        } catch (e) {
            console.error('Upload error:', e);
            addToast('Ошибка загрузки изображений: ' + e.message, 'error');
        }
    };
    
    const loadCurrentPatch = useCallback(async () => {
        if (!api || !imagesAligned) return;
        
        try {
            // Load base image first (always available)
            const imageData = await api.get(`/api/patch/${currentPatch.y}/${currentPatch.x}?image_type=${currentView}`);
            setCurrentImage(imageData.image);
            
            // Load segmentation
            const segData = await api.get(`/api/segmentation/${currentPatch.y}/${currentPatch.x}`);
            
            if (segData.status === 'ready') {
                setSegmentsImage(segData.colored_segments);
                setBoundsImage(segData.bounds);
                setPatchReady(true);
            } else {
                // Segmentation not ready - request it with priority
                setSegmentsImage(null);
                setBoundsImage(null);
                setPatchReady(false);
                
                // Request segmentation for this patch
                try {
                    await api.post(`/api/segment-patch/${currentPatch.y}/${currentPatch.x}`);
                } catch (e) {
                    console.error('Failed to request patch segmentation:', e);
                }
            }
            
            // Load tags
            const tagsData = await api.get('/api/tags');
            setTags(tagsData.tag_colors || {});
            
        } catch (e) {
            console.error('Load patch error:', e);
        }
    }, [api, imagesAligned, currentPatch, currentView]);

    // Load patch when current patch or view changes
    useEffect(() => {
        if (!api || !imagesAligned) return;
        loadCurrentPatch();
    }, [api, currentPatch, currentView, imagesAligned, loadCurrentPatch]);

    const loadMinimap = async () => {
        if (!api) return;
        
        try {
            const data = await api.get(`/api/minimap?image_type=${currentView}`);
            setMinimapData(data);
        } catch (e) {
            console.error('Load minimap error:', e);
        }
    };
    
    const toggleXplMode = () => setIsXpl90(prev => !prev);
    const togglePplMode = () => setIsXpl(prev => !prev);
    
    // Автоматическая и надежная синхронизация вида
    useEffect(() => {
        setCurrentView(`${isXpl ? 'xpl' : 'ppl'}${isXpl90 ? '90' : '45'}`);
    }, [isXpl, isXpl90]);

    const navigatePatch = (dy, dx) => {
        setCurrentPatch(prev => {
            const newY = Math.max(0, Math.min(gridSize.rows - 1, prev.y + dy));
            const newX = Math.max(0, Math.min(gridSize.cols - 1, prev.x + dx));
            return { y: newY, x: newX };
        });
        // Reset view
        setZoom(1);
        setOffset({ x: 0, y: 0 });
    };
    
    const handleWheel = (delta, mouseX, mouseY) => {
        const zoomFactor = delta > 0 ? 0.9 : 1.1;
        const newZoom = Math.max(0.1, Math.min(10, zoom * zoomFactor));
        
        // Zoom towards cursor
        const zoomPoint = {
            x: (mouseX - offset.x) / zoom,
            y: (mouseY - offset.y) / zoom
        };
        
        setZoom(newZoom);
        setOffset({
            x: mouseX - zoomPoint.x * newZoom,
            y: mouseY - zoomPoint.y * newZoom
        });
    };
    
    // tagColor: deterministic vibrant color from tag name
    const tagColor = useCallback((name) => {
        let hash = 5381;
        for (let i = 0; i < name.length; i++) hash = ((hash << 5) + hash) + name.charCodeAt(i);
        const hue = Math.abs(hash * 137.5) % 360;
        const s = 0.85;
        const l = 0.55;
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
        const toHex = x => { const hex = Math.round(x * 255).toString(16); return hex.length === 1 ? '0' + hex : hex; };
        return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    }, []);

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
                loadCurrentPatch();
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
                loadCurrentPatch();
                api.get('/api/tags').then(d => setTags(d.tag_colors || {}));
            });
        }
    }, [api, quickInput, selectedSegments, tags, fetchTree, loadCurrentPatch, tagColor]);

    const handleUndo = useCallback(() => {
        if (!api || !canUndo) return;
        api.post('/api/undo').then(d => {
            setCanUndo(d.can_undo);
            setCanRedo(d.can_redo);
            fetchTree();
            loadCurrentPatch();
            api.get('/api/tags').then(t => setTags(t.tag_colors || {}));
        });
    }, [api, canUndo, fetchTree, loadCurrentPatch]);

    const handleRedo = useCallback(() => {
        if (!api || !canRedo) return;
        api.post('/api/redo').then(d => {
            setCanUndo(d.can_undo);
            setCanRedo(d.can_redo);
            fetchTree();
            loadCurrentPatch();
            api.get('/api/tags').then(t => setTags(t.tag_colors || {}));
        });
    }, [api, canRedo, fetchTree, loadCurrentPatch]);

    // Setup keyboard shortcuts (after all handlers are declared)
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.ctrlKey && (e.key === '=' || e.key === '+' || e.key === '-')) {
                e.preventDefault();
                const factor = e.key === '-' ? 0.8 : 1.2;
                const newZoom = Math.max(0.1, Math.min(10, zoom * factor));
                setZoom(newZoom);
                return;
            }
            if (e.key.toLowerCase() === 'h' && !e.ctrlKey) {
                setShowHelp(v => !v);
                return;
            }
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
            if (showHelpRef.current) return;

            switch(e.key.toLowerCase()) {
                case 'x': toggleXplMode(); break;
                case 's': setShowBounds(!showBounds); break;
                case 'b': setShowSegments(!showSegments); break;
                case 'p': togglePplMode(); break;
                case 'arrowright': navigatePatch(0, 1); break;
                case 'arrowleft': navigatePatch(0, -1); break;
                case 'arrowdown': navigatePatch(1, 0); break;
                case 'arrowup': navigatePatch(-1, 0); break;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [showSegments, showBounds, currentPatch, gridSize, selectedSegments, handleUndo, handleRedo]);

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

    const handleImageClick = async (x, y, e) => {
        if (!api || !patchReady) return;

        try {
            const result = await api.get(`/api/patch-segment-at-point/${currentPatch.y}/${currentPatch.x}?x=${x}&y=${y}`);

            if (result.status === 'success' && result.segment_id > 0) {
                if (e && e.ctrlKey) {
                    // Ctrl+click: toggle segment in multi-select array
                    setSelectedSegments(prev => {
                        const exists = prev.find(s => s.id === result.segment_id);
                        if (exists) return prev.filter(s => s.id !== result.segment_id);
                        return [...prev, {id: result.segment_id, patchY: currentPatch.y, patchX: currentPatch.x}];
                    });
                    return;
                }

                // Normal click: set quickInput and focus
                setSelectedSegments([]);
                setQuickInput({patchY: currentPatch.y, patchX: currentPatch.x, segmentId: result.segment_id});
                setQuickFilter(result.tag || '');
                setTimeout(() => quickInputRef.current?.focus(), 50);
            }
        } catch (e) {
            console.error('Get segment error:', e);
        }
    };
    
    const handleSaveProject = async () => {
        if (!window.electronAPI) {
            addToast('Файловый диалог доступен только в Electron', 'error');
            return;
        }
        
        const result = await window.electronAPI.selectOutputFolder();
        if (result.canceled) return;
        
        try {
            await api.post('/api/save-project', { output_path: result.path });
            addToast('Проект сохранен', 'success');
        } catch (e) {
            addToast('Ошибка сохранения проекта', 'error');
        }
    };
    
    const handlePatchClick = (y, x) => {
        if (y >= 0 && y < gridSize.rows && x >= 0 && x < gridSize.cols) {
            setCurrentPatch({ y, x });
            setZoom(1);
            setOffset({ x: 0, y: 0 });
        }
    };
    
    // Render
    if (!imagesLoaded) {
        return React.createElement('div', { className: 'app-container' },
            React.createElement(WelcomeScreen, { onLoadImages: handleLoadImages }),
            React.createElement(ToastContainer, { toasts, removeToast })
        );
    }

    return React.createElement('div', { className: 'app-container' },
        // Toolbar
        React.createElement('div', { className: 'toolbar' },
            React.createElement('div', { className: 'toolbar-group' },
                React.createElement('button', { className: 'btn btn-secondary', onClick: handleLoadImages },
                    '📂 Загрузить'
                ),
                React.createElement('button', { className: 'btn btn-secondary', onClick: handleSaveProject },
                    '💾 Сохранить'
                )
            ),
            React.createElement('div', { className: 'toolbar-divider' }),
            React.createElement('div', { className: 'toolbar-group' },
                React.createElement('button', {
                    className: `btn btn-secondary ${isXpl ? '' : 'active'}`,
                    onClick: togglePplMode,
                    title: 'Переключить PPL/XPL (P)'
                }, isXpl ? 'XPL' : 'PPL'),
                React.createElement('button', {
                    className: `btn btn-secondary ${isXpl90 ? 'active' : ''}`,
                    onClick: toggleXplMode,
                    title: 'Переключить 45°/90° (X)'
                }, isXpl90 ? '90°' : '45°')
            ),
            React.createElement('div', { className: 'toolbar-divider' }),
            React.createElement('div', { className: 'toolbar-group' },
                React.createElement('button', {
                    className: `btn btn-secondary ${showBounds ? 'active' : ''}`,
                    onClick: () => setShowBounds(!showBounds),
                    title: 'Показать сегменты (S)'
                }, '🎨 Сегменты'),
                React.createElement('button', {
                    className: `btn btn-secondary ${showSegments ? 'active' : ''}`,
                    onClick: () => setShowSegments(!showSegments),
                    title: 'Показать границы (B)'
                }, '📐 Границы')
            ),
            React.createElement('div', { className: 'toolbar-divider' }),
            React.createElement('div', { className: 'toolbar-group' },
                React.createElement('button', {
                    className: 'btn btn-secondary',
                    onClick: () => navigatePatch(0, -1),
                    disabled: currentPatch.x === 0
                }, '◀'),
                React.createElement('span', { style: { color: '#a0a0a0' } },
                    `${currentPatch.x + 1}/${gridSize.cols || 1}`
                ),
                React.createElement('button', {
                    className: 'btn btn-secondary',
                    onClick: () => navigatePatch(0, 1),
                    disabled: currentPatch.x >= gridSize.cols - 1
                }, '▶'),
                React.createElement('span', { style: { margin: '0 10px', color: '#a0a0a0' } }, '/'),
                React.createElement('button', {
                    className: 'btn btn-secondary',
                    onClick: () => navigatePatch(-1, 0),
                    disabled: currentPatch.y === 0
                }, '▲'),
                React.createElement('span', { style: { color: '#a0a0a0' } },
                    `${currentPatch.y + 1}/${gridSize.rows || 1}`
                ),
                React.createElement('button', {
                    className: 'btn btn-secondary',
                    onClick: () => navigatePatch(1, 0),
                    disabled: currentPatch.y >= gridSize.rows - 1
                }, '▼')
            ),
            React.createElement('button', {
                className: 'btn btn-secondary',
                style: { marginLeft: 'auto', fontSize: '16px', padding: '4px 10px' },
                onClick: () => setShowHelp(v => !v),
                title: 'Помощь (H)'
            }, '?')
        ),
        
        // Main Content
        React.createElement('div', { className: 'main-content' },
            // Minimap with progress bar
            React.createElement(Minimap, {
                minimapData,
                currentPatch,
                gridSize,
                patchSize,
                onPatchClick: handlePatchClick,
                segmentationProgress,
                isSegmenting,
                patchStates,
                animTick
            }),
            
            // Image Viewer
            React.createElement('div', { className: 'viewer-panel' },
                React.createElement(ImageViewer, {
                    currentImage,
                    segmentsImage,
                    boundsImage,
                    showSegments,
                    showBounds,
                    zoom,
                    offset,
                    currentView,
                    onWheel: handleWheel,
                    onMouseMove: setOffset,
                    onImageClick: handleImageClick,
                    patchReady,
                    selectedSegments,
                    api,
                    currentPatch
                }),
                
                // Info Overlay
                React.createElement('div', { className: 'info-overlay' },
                    React.createElement('div', { className: 'info-row' },
                        React.createElement('span', null, 
                            React.createElement('span', { className: 'label' }, 'Патч:'),
                            ` ${currentPatch.y + 1}, ${currentPatch.x + 1}`
                        ),
                        React.createElement('span', null,
                            React.createElement('span', { className: 'label' }, 'Масштаб:'),
                            ` ${Math.round(zoom * 100)}%`
                        ),
                        React.createElement('span', null,
                            React.createElement('span', { className: 'label' }, 'Вид:'),
                            ` ${currentView.toUpperCase()}`
                        )
                    )
                )
            ),
            
            // Tree Panel (3-level collapsible)
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
        
        // Status Bar (simplified)
        React.createElement('div', { className: 'status-bar' },
            React.createElement('div', { className: 'status-item' },
                React.createElement('span', { 
                    className: `status-dot ${isSegmenting ? 'warning' : 'success'}` 
                }),
                isSegmenting ? 'Сегментация...' : 'Готово'
            ),
            React.createElement('div', { className: 'status-item' },
                `Сетка: ${gridSize.rows}×${gridSize.cols} патчей`
            ),
            React.createElement('div', { className: 'status-item' },
                'Навигация: X - угол | P - PPL/XPL | S - сегменты | B - границы'
            )
        ),
        
        // Context Menu
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
                                fetchTree(); loadCurrentPatch(); api.get('/api/tags').then(function(d) { setTags(d.tag_colors || {}); });
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
                                fetchTree(); loadCurrentPatch(); api.get('/api/tags').then(function(d) { setTags(d.tag_colors || {}); });
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
                                    fetchTree(); loadCurrentPatch(); api.get('/api/tags').then(function(d) { setTags(d.tag_colors || {}); });
                                });
                            } else if (deleteConfirm.level === 'tag') {
                                api.post('/api/delete-tag', {tag_name: deleteConfirm.tagName}).then(function() {
                                    setDeleteConfirm(null); setContextMenu(null);
                                    fetchTree(); loadCurrentPatch(); api.get('/api/tags').then(function(d) { setTags(d.tag_colors || {}); });
                                });
                            } else {
                                var segs2 = [{patch_y: deleteConfirm.patchY, patch_x: deleteConfirm.patchX, segment_id: deleteConfirm.segmentId}];
                                api.post('/api/untag-segments', {segments: segs2}).then(function() {
                                    setDeleteConfirm(null); setContextMenu(null);
                                    fetchTree(); loadCurrentPatch(); api.get('/api/tags').then(function(d) { setTags(d.tag_colors || {}); });
                                });
                            }
                        }}, 'Удалить'),
                        React.createElement('button', {className:'btn btn-secondary', style:{padding:'4px 12px'}, onClick: function() { setDeleteConfirm(null); }}, 'Отмена')
                    )
                )
            )
        ),

        // Help Modal
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
                        ['Ctrl+Z', 'Отмена'],
                        ['Ctrl+Y', 'Повтор'],
                    ].map(([key, desc]) =>
                        React.createElement(React.Fragment, {key},
                            React.createElement('kbd', null, key),
                            React.createElement('span', null, desc)
                        )
                    )
                ),
                React.createElement('button', {className:'btn btn-secondary', style:{marginTop:'16px', width:'100%'}, onClick:()=>setShowHelp(false)}, 'Закрыть')
            )
        ),

        // Assignment Modal
        showAssignmentModal && React.createElement(AssignmentModal, {
            files: pendingFiles,
            onAssign: handleAssignImages,
            onCancel: () => setShowAssignmentModal(false)
        }),

        // Toasts
        React.createElement(ToastContainer, { toasts, removeToast })
    );
}

// Mount React app
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(React.createElement(App));
