/**
 * Mineral Segmentation Application - Main React Component
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';

// API helper
const createApi = (baseUrl) => ({
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

// Annotation Modal
function AnnotationModal({ segmentId, existingTags, onSelect, onCancel, onCreate }) {
    const [newTag, setNewTag] = useState('');
    
    return React.createElement('div', { className: 'modal-overlay', onClick: onCancel },
        React.createElement('div', { className: 'modal', onClick: e => e.stopPropagation() },
            React.createElement('h3', { className: 'modal-header' }, `Разметка сегмента #${segmentId}`),
            React.createElement('input', {
                type: 'text',
                className: 'modal-input',
                placeholder: 'Введите название минерала...',
                value: newTag,
                onChange: e => setNewTag(e.target.value),
                autoFocus: true
            }),
            existingTags.length > 0 && React.createElement('div', { className: 'modal-suggestions' },
                React.createElement('p', { style: { fontSize: '12px', color: '#a0a0a0', marginBottom: '8px' } }, 
                    'Или выберите существующий:'
                ),
                existingTags.map(tag =>
                    React.createElement('div', {
                        key: tag.name,
                        className: 'suggestion-item',
                        onClick: () => onSelect(tag.name, tag.color)
                    },
                        React.createElement('span', { className: 'suggestion-color', style: { backgroundColor: tag.color } }),
                        React.createElement('span', null, tag.name)
                    )
                )
            ),
            React.createElement('div', { className: 'modal-buttons' },
                React.createElement('button', { className: 'btn btn-secondary', onClick: onCancel }, 'Отмена'),
                React.createElement('button', {
                    className: 'btn btn-primary',
                    onClick: () => onCreate(newTag),
                    disabled: !newTag.trim()
                }, 'Создать')
            )
        )
    );
}

// Minimap Component with grid and darkening
function Minimap({ minimapData, currentPatch, gridSize, patchSize, onPatchClick, segmentationProgress, isSegmenting }) {
    const canvasRef = useRef(null);
    
    // Draw minimap with darkening and grid
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
            
            // Apply darkening overlay
            ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            // Draw grid lines
            if (gridSize.cols > 0 && gridSize.rows > 0) {
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
                ctx.lineWidth = 1;
                
                const cellWidth = canvas.width / gridSize.cols;
                const cellHeight = canvas.height / gridSize.rows;
                
                // Vertical lines
                for (let i = 0; i <= gridSize.cols; i++) {
                    const x = Math.floor(i * cellWidth) + 0.5;
                    ctx.beginPath();
                    ctx.moveTo(x, 0);
                    ctx.lineTo(x, canvas.height);
                    ctx.stroke();
                }
                
                // Horizontal lines
                for (let i = 0; i <= gridSize.rows; i++) {
                    const y = Math.floor(i * cellHeight) + 0.5;
                    ctx.beginPath();
                    ctx.moveTo(0, y);
                    ctx.lineTo(canvas.width, y);
                    ctx.stroke();
                }
                
                // Highlight current patch
                if (currentPatch) {
                    const px = currentPatch.x * cellWidth;
                    const py = currentPatch.y * cellHeight;
                    ctx.fillStyle = 'rgba(59, 130, 246, 0.3)';
                    ctx.fillRect(px, py, cellWidth, cellHeight);
                    ctx.strokeStyle = 'rgba(59, 130, 246, 1)';
                    ctx.lineWidth = 2;
                    ctx.strokeRect(px, py, cellWidth, cellHeight);
                }
            }
        };
        img.src = `data:image/png;base64,${minimapData.image}`;
    }, [minimapData, gridSize, currentPatch]);
    
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

// Tags Panel Component
function TagsPanel({ tags, onTagClick }) {
    return React.createElement('div', { className: 'tags-panel' },
        React.createElement('div', { className: 'tags-header' },
            'Теги минералов',
            React.createElement('span', { style: { fontSize: '12px', color: '#a0a0a0' } },
                `${Object.keys(tags).length} определено`
            )
        ),
        React.createElement('div', { className: 'tags-list' },
            Object.entries(tags).map(([name, color]) =>
                React.createElement('div', {
                    key: name,
                    className: 'tag-item',
                    onClick: () => onTagClick(name, color)
                },
                    React.createElement('span', { className: 'tag-color', style: { backgroundColor: color } }),
                    React.createElement('span', { className: 'tag-name' }, name)
                )
            ),
            Object.keys(tags).length === 0 && React.createElement('div', {
                style: { color: '#666', textAlign: 'center', padding: '20px' }
            }, 'Нет определенных тегов')
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
    patchReady
}) {
    const canvasRef = useRef(null);
    const [dragStart, setDragStart] = useState(null);
    const [isDragging, setIsDragging] = useState(false);
    
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
            onImageClick(x, y);
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
        patchReady && currentImage ? React.createElement('div', {
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
            })
        ) : React.createElement('div', {
            style: {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                color: '#666'
            }
        }, patchReady ? 'Загрузка...' : 'Сегментация не завершена')
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
    const [showAnnotationModal, setShowAnnotationModal] = useState(false);
    const [selectedSegment, setSelectedSegment] = useState(null);
    const [showAssignmentModal, setShowAssignmentModal] = useState(false);
    const [pendingFiles, setPendingFiles] = useState([]);
    const [minimapData, setMinimapData] = useState(null);
    const [patchReady, setPatchReady] = useState(false);
    
    const patchSize = 1024;
    
    // Initialize API
    useEffect(() => {
        const initApi = async () => {
            let apiUrl = 'http://127.0.0.1:8000';
            if (window.electronAPI) {
                apiUrl = await window.electronAPI.getApiUrl();
            }
            setApi(createApi(apiUrl));
        };
        initApi();
    }, []);
    
    // Setup keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (showAnnotationModal) return;
            
            switch(e.key.toLowerCase()) {
                case 'x':
                    toggleXplMode();
                    break;
                case 's':
                    setShowSegments(!showSegments);
                    break;
                case 'b':
                    setShowBounds(!showBounds);
                    break;
                case 'p':
                    togglePplMode();
                    break;
                case 'arrowright':
                    navigatePatch(0, 1);
                    break;
                case 'arrowleft':
                    navigatePatch(0, -1);
                    break;
                case 'arrowdown':
                    navigatePatch(1, 0);
                    break;
                case 'arrowup':
                    navigatePatch(-1, 0);
                    break;
            }
        };
        
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [showSegments, showBounds, showAnnotationModal, currentPatch, gridSize]);
    
    // Electron menu shortcuts
    useEffect(() => {
        if (window.electronAPI) {
            window.electronAPI.onMenuLoadImages(() => handleLoadImages());
            window.electronAPI.onMenuSaveProject(() => handleSaveProject());
            window.electronAPI.onShortcut((key) => {
                // Handle shortcuts from Electron menu
            });
        }
    }, []);
    
    // Poll segmentation progress
    useEffect(() => {
        if (!api || !imagesAligned) return;
        
        const pollProgress = async () => {
            try {
                const progress = await api.get('/api/segmentation-progress');
                setSegmentationProgress(progress);
                setIsSegmenting(progress.is_running);
            } catch (e) {
                console.error('Failed to poll progress:', e);
            }
        };
        
        const interval = setInterval(pollProgress, 500);
        return () => clearInterval(interval);
    }, [api, imagesAligned]);
    
    // Load patch when current patch or view changes
    useEffect(() => {
        if (!api || !imagesAligned) return;
        loadCurrentPatch();
    }, [api, currentPatch, currentView, imagesAligned]);
    
    // Load minimap
    useEffect(() => {
        if (!api || !imagesAligned) return;
        loadMinimap();
    }, [api, imagesAligned, currentView]);
    
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
        if (!api) return;
        
        try {
            const formData = new FormData();
            
            // Read files
            for (const [key, path] of Object.entries(paths)) {
                const fs = window.require ? window.require('fs') : null;
                if (fs) {
                    const buffer = fs.readFileSync(path);
                    const blob = new Blob([buffer]);
                    formData.append(key, blob, path.split(/[/\\]/).pop());
                }
            }
            
            await api.uploadFiles('/api/load-images', formData);
            setImagesLoaded(true);
            addToast('Изображения загружены', 'success');
            
            // Align images
            addToast('Выравнивание изображений...', 'info');
            const alignResult = await api.post('/api/align-images');
            setGridSize({ rows: alignResult.grid_size.rows, cols: alignResult.grid_size.cols });
            setImagesAligned(true);
            addToast('Изображения выровнены', 'success');
            
            // Start segmentation
            await api.post('/api/start-segmentation');
            setIsSegmenting(true);
            addToast('Сегментация запущена', 'info');
            
        } catch (e) {
            console.error('Upload error:', e);
            addToast('Ошибка загрузки изображений', 'error');
        }
    };
    
    const loadCurrentPatch = async () => {
        if (!api) return;
        setPatchReady(false);
        
        try {
            // Load base image
            const imageData = await api.get(`/api/patch/${currentPatch.y}/${currentPatch.x}?image_type=${currentView}`);
            setCurrentImage(imageData.image);
            
            // Load segmentation
            const segData = await api.get(`/api/segmentation/${currentPatch.y}/${currentPatch.x}`);
            
            if (segData.status === 'ready') {
                setSegmentsImage(segData.colored_segments);
                setBoundsImage(segData.bounds);
                setPatchReady(true);
            } else {
                setSegmentsImage(null);
                setBoundsImage(null);
                setPatchReady(false);
            }
            
            // Load tags
            const tagsData = await api.get('/api/tags');
            setTags(tagsData.tag_colors || {});
            
        } catch (e) {
            console.error('Load patch error:', e);
        }
    };
    
    const loadMinimap = async () => {
        if (!api) return;
        
        try {
            const data = await api.get(`/api/minimap?image_type=${currentView}`);
            setMinimapData(data);
        } catch (e) {
            console.error('Load minimap error:', e);
        }
    };
    
    const toggleXplMode = () => {
        setIsXpl90(prev => {
            const newValue = !prev;
            updateCurrentView(isXpl, newValue);
            return newValue;
        });
    };
    
    const togglePplMode = () => {
        setIsXpl(prev => {
            const newValue = !prev;
            updateCurrentView(newValue, isXpl90);
            return newValue;
        });
    };
    
    const updateCurrentView = (xpl, xpl90) => {
        if (xpl) {
            setCurrentView(xpl90 ? 'xpl90' : 'xpl45');
        } else {
            setCurrentView(xpl90 ? 'ppl90' : 'ppl45');
        }
    };
    
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
    
    const handleImageClick = async (x, y) => {
        if (!api || !patchReady) return;
        
        try {
            const result = await api.get(`/api/patch-segment-at-point/${currentPatch.y}/${currentPatch.x}?x=${x}&y=${y}`);
            
            if (result.status === 'success' && result.segment_id > 1) {
                setSelectedSegment({
                    id: result.segment_id,
                    tag: result.tag,
                    color: result.color
                });
                setShowAnnotationModal(true);
            }
        } catch (e) {
            console.error('Get segment error:', e);
        }
    };
    
    const handleCreateTag = async (tagName) => {
        if (!api || !selectedSegment) return;
        
        let color = tags[tagName];
        if (!color) {
            color = generateDistinctColor();
        }
        
        try {
            await api.post('/api/label-segment', {
                patch_y: currentPatch.y,
                patch_x: currentPatch.x,
                segment_id: selectedSegment.id,
                tag: tagName,
                color: color
            });
            
            setTags(prev => ({ ...prev, [tagName]: color }));
            setShowAnnotationModal(false);
            loadCurrentPatch();
            addToast(`Сегмент помечен как "${tagName}"`, 'success');
            
        } catch (e) {
            addToast('Ошибка сохранения тега', 'error');
        }
    };
    
    const handleSelectTag = async (tagName, color) => {
        if (!api || !selectedSegment) return;
        
        try {
            await api.post('/api/label-segment', {
                patch_y: currentPatch.y,
                patch_x: currentPatch.x,
                segment_id: selectedSegment.id,
                tag: tagName,
                color: color
            });
            
            setShowAnnotationModal(false);
            loadCurrentPatch();
            addToast(`Сегмент помечен как "${tagName}"`, 'success');
            
        } catch (e) {
            addToast('Ошибка сохранения тега', 'error');
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
    
    const handleTagClick = (tagName, color) => {
        addToast(`Выбран тег: ${tagName}`, 'info');
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
                    className: `btn btn-secondary ${showSegments ? 'active' : ''}`,
                    onClick: () => setShowSegments(!showSegments),
                    title: 'Показать сегменты (S)'
                }, '🎨 Сегменты'),
                React.createElement('button', {
                    className: `btn btn-secondary ${showBounds ? 'active' : ''}`,
                    onClick: () => setShowBounds(!showBounds),
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
            )
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
                isSegmenting
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
                    patchReady
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
            
            // Tags Panel
            React.createElement(TagsPanel, { tags, onTagClick: handleTagClick })
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
        
        // Modals
        showAssignmentModal && React.createElement(AssignmentModal, {
            files: pendingFiles,
            onAssign: handleAssignImages,
            onCancel: () => setShowAssignmentModal(false)
        }),
        
        showAnnotationModal && React.createElement(AnnotationModal, {
            segmentId: selectedSegment?.id,
            existingTags: Object.entries(tags).map(([name, color]) => ({ name, color })),
            onSelect: handleSelectTag,
            onCreate: handleCreateTag,
            onCancel: () => setShowAnnotationModal(false)
        }),
        
        // Toasts
        React.createElement(ToastContainer, { toasts, removeToast })
    );
}

// Mount React app
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(React.createElement(App));
