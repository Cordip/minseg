from collections import deque
import numpy as np
import pytest
from httpx import AsyncClient, ASGITransport
from main import app, state, AppState


@pytest.fixture(autouse=True)
def reset_state():
    """Reset global state before each test."""
    state.images = {}
    state.aligned_images = {}
    state.patches = {}
    state.segmentations = {}
    state.labels = {}
    state.patch_size = 1024
    state.grid_size = (0, 0)
    state.tag_colors = {}
    state.undo_stack = []
    state.redo_stack = []
    state.segmentation_progress = {"total": 0, "completed": 0, "current": None}
    state.is_segmenting = False
    state.session_id = ""
    state.segment_colors = {}
    state.seg_pending = deque()
    state.seg_active = set()
    yield


@pytest.fixture
def client():
    """Async HTTP client for testing the FastAPI app."""
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest.fixture
def fake_patch():
    """64x64 BGR image with two distinct colored regions."""
    img = np.zeros((64, 64, 3), dtype=np.uint8)
    img[10:30, 10:30] = [100, 150, 200]
    img[40:60, 40:60] = [50, 80, 120]
    return img


@pytest.fixture
def fake_labels():
    """64x64 label map with 3 segments: 0 (background), 2, 3."""
    labels = np.zeros((64, 64), dtype=np.int32)
    labels[10:30, 10:30] = 2
    labels[40:60, 40:60] = 3
    return labels


@pytest.fixture
def setup_segmented_patch(fake_patch, fake_labels):
    """Set up state with one segmented patch at (0, 0)."""
    for name in ['ppl45', 'ppl90', 'xpl45', 'xpl90']:
        state.patches[name] = {(0, 0): fake_patch.copy()}
    cs_rgba = np.zeros((64, 64, 4), dtype=np.uint8)
    state.segmentations[(0, 0)] = {
        'bounds': fake_patch.copy(),
        'colored_segments': cs_rgba,
        'labels': fake_labels,
        'segment_tags': {},
        'original_colors': {2: '#c89664', 3: '#785032'},
        'seg_count': 2,
        'tagged_count': 0,
    }
    state.labels[(0, 0)] = fake_labels
    state.grid_size = (1, 1)
