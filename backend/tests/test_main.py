import json
import os
import asyncio
from collections import deque
import numpy as np
import pytest
from httpx import AsyncClient, ASGITransport
from main import app, state, image_to_base64, hex_to_bgr, _store_segmentation_result


# ─── Task 2: seg_pending / seg_active fields ────────────────────────────────────

class TestSegQueueState:
    def test_initial_state_has_queue_fields(self):
        """AppState must have seg_pending (deque) and seg_active (set)."""
        assert hasattr(state, 'seg_pending')
        assert hasattr(state, 'seg_active')
        assert isinstance(state.seg_pending, deque)
        assert isinstance(state.seg_active, set)
        assert len(state.seg_pending) == 0
        assert len(state.seg_active) == 0


# ─── Task 3: Cached segment counts ─────────────────────────────────────────────

class TestCachedSegmentCounts:
    def test_store_caches_counts(self, setup_segmented_patch, fake_labels):
        """_store_segmentation_result should cache seg_count and tagged_count."""
        seg = state.segmentations[(0, 0)]
        assert 'seg_count' in seg
        assert 'tagged_count' in seg
        assert seg['seg_count'] == 2
        assert seg['tagged_count'] == 0


# ─── Helper functions ───────────────────────────────────────────────────────────

class TestHexToBgr:
    def test_basic_conversion(self):
        assert hex_to_bgr("#ff0000") == (0, 0, 255)

    def test_white(self):
        assert hex_to_bgr("#ffffff") == (255, 255, 255)

    def test_black(self):
        assert hex_to_bgr("#000000") == (0, 0, 0)

    def test_mixed(self):
        assert hex_to_bgr("#aabbcc") == (0xcc, 0xbb, 0xaa)

    def test_without_hash(self):
        assert hex_to_bgr("ff8800") == (0x00, 0x88, 0xff)


class TestImageToBase64:
    def test_returns_string(self):
        img = np.zeros((10, 10, 3), dtype=np.uint8)
        result = image_to_base64(img)
        assert isinstance(result, str)
        assert len(result) > 0

    def test_decodable_base64(self):
        import base64
        img = np.ones((10, 10, 3), dtype=np.uint8) * 128
        result = image_to_base64(img)
        decoded = base64.b64decode(result)
        assert decoded[:4] == b'\x89PNG'

    def test_rgba_image(self):
        img = np.zeros((10, 10, 4), dtype=np.uint8)
        result = image_to_base64(img)
        assert isinstance(result, str)


# ─── _store_segmentation_result ─────────────────────────────────────────────────

class TestStoreSegmentationResult:
    def test_stores_to_state(self):
        labels = np.zeros((32, 32), dtype=np.int32)
        labels[5:15, 5:15] = 2
        colored = np.zeros((32, 32, 3), dtype=np.uint8)
        colored[5:15, 5:15] = [100, 150, 200]
        bounds = np.zeros((32, 32, 3), dtype=np.uint8)
        state.segmentation_progress = {"total": 1, "completed": 0, "current": None}

        _store_segmentation_result(0, 0, (bounds, colored, labels))

        seg = state.segmentations[(0, 0)]
        assert seg is not None
        assert 'labels' in seg
        assert 'colored_segments' in seg
        assert seg['colored_segments'].shape == (32, 32, 4)
        assert seg['segment_tags'] == {}
        assert state.segmentation_progress["completed"] == 1

    def test_original_colors_populated(self):
        labels = np.zeros((32, 32), dtype=np.int32)
        labels[5:15, 5:15] = 2
        labels[20:30, 20:30] = 3
        colored = np.zeros((32, 32, 3), dtype=np.uint8)
        colored[5:15, 5:15] = [100, 150, 200]
        colored[20:30, 20:30] = [50, 80, 120]
        bounds = np.zeros((32, 32, 3), dtype=np.uint8)
        state.segmentation_progress = {"total": 1, "completed": 0, "current": None}

        _store_segmentation_result(1, 1, (bounds, colored, labels))

        oc = state.segmentations[(1, 1)]['original_colors']
        assert isinstance(oc, dict)
        for sid, c in oc.items():
            assert isinstance(sid, int)
            assert c.startswith('#') and len(c) == 7

    def test_float_colored_segments_scaled(self):
        """colored_segments with max <= 1.0 should be scaled to 0-255."""
        labels = np.array([[0, 1], [1, 0]], dtype=np.int32)
        colored = np.array([[[0.0, 0.0, 0.0], [0.5, 0.5, 0.5]],
                            [[0.5, 0.5, 0.5], [0.0, 0.0, 0.0]]], dtype=np.float64)
        bounds = np.zeros((2, 2, 3), dtype=np.uint8)
        state.segmentation_progress = {"total": 1, "completed": 0, "current": None}

        _store_segmentation_result(2, 2, (bounds, colored, labels))

        seg = state.segmentations[(2, 2)]
        assert seg['colored_segments'].dtype == np.uint8


# ─── Root endpoint ──────────────────────────────────────────────────────────────

class TestRoot:
    async def test_root_returns_ok(self, client):
        r = await client.get("/")
        assert r.status_code == 200
        assert r.json()["status"] == "ok"


# ─── GET /api/patch ─────────────────────────────────────────────────────────────

class TestGetPatch:
    async def test_returns_image(self, client, fake_patch):
        state.patches['xpl45'] = {(0, 0): fake_patch}
        r = await client.get("/api/patch/0/0")
        assert r.status_code == 200
        assert "image" in r.json()

    async def test_custom_image_type(self, client, fake_patch):
        state.patches['ppl90'] = {(0, 0): fake_patch}
        r = await client.get("/api/patch/0/0?image_type=ppl90")
        assert r.status_code == 200

    async def test_404_missing_patch(self, client):
        r = await client.get("/api/patch/99/99")
        assert r.status_code == 404


# ─── GET /api/segmentation ─────────────────────────────────────────────────────

class TestGetSegmentation:
    async def test_not_ready(self, client):
        r = await client.get("/api/segmentation/0/0")
        assert r.json()["status"] == "not_ready"

    async def test_ready(self, client, setup_segmented_patch):
        r = await client.get("/api/segmentation/0/0")
        data = r.json()
        assert data["status"] == "ready"
        assert "colored_segments" in data
        assert "bounds" in data
        assert "borders" in data
        assert "total_segs" in data
        assert "tagged_segs" in data

    async def test_borders_cached(self, client, setup_segmented_patch):
        """Second call should use cached borders."""
        r1 = await client.get("/api/segmentation/0/0")
        r2 = await client.get("/api/segmentation/0/0")
        assert r1.json()["borders"] == r2.json()["borders"]
        assert 'borders_cache' in state.segmentations[(0, 0)]

    async def test_segment_counts(self, client, setup_segmented_patch):
        r = await client.get("/api/segmentation/0/0")
        data = r.json()
        # labels has segments 0, 2, 3 — only 2 and 3 count (>0)
        assert data["total_segs"] == 2
        assert data["tagged_segs"] == 0


# ─── GET /api/untagged-mask ─────────────────────────────────────────────────────

class TestUntaggedMask:
    async def test_404_no_segmentation(self, client):
        r = await client.get("/api/untagged-mask/0/0")
        assert r.status_code == 404

    async def test_all_untagged(self, client, setup_segmented_patch):
        r = await client.get("/api/untagged-mask/0/0")
        assert r.status_code == 200
        data = r.json()
        assert data["has_untagged"] is True
        assert "image" in data

    async def test_no_untagged_after_tagging(self, client, setup_segmented_patch):
        seg = state.segmentations[(0, 0)]
        seg['segment_tags'] = {2: 'quartz', 3: 'feldspar'}
        r = await client.get("/api/untagged-mask/0/0")
        assert r.json()["has_untagged"] is False


# ─── GET /api/minimap ───────────────────────────────────────────────────────────

class TestMinimap:
    async def test_404_no_aligned(self, client):
        r = await client.get("/api/minimap")
        assert r.status_code == 404

    async def test_returns_minimap(self, client):
        state.aligned_images['xpl45'] = np.zeros((800, 600, 3), dtype=np.uint8)
        r = await client.get("/api/minimap")
        assert r.status_code == 200
        assert "image" in r.json()
        assert "scale" in r.json()


# ─── POST /api/label-segment ───────────────────────────────────────────────────

class TestLabelSegment:
    async def test_label_success(self, client, setup_segmented_patch):
        r = await client.post("/api/label-segment", json={
            "patch_y": 0, "patch_x": 0, "segment_id": 2,
            "tag": "quartz", "color": "#ff0000"
        })
        assert r.status_code == 200
        assert state.segmentations[(0, 0)]['segment_tags'][2] == 'quartz'
        assert state.tag_colors['quartz'] == '#ff0000'

    async def test_label_updates_colored_segments(self, client, setup_segmented_patch):
        await client.post("/api/label-segment", json={
            "patch_y": 0, "patch_x": 0, "segment_id": 2,
            "tag": "quartz", "color": "#ff0000"
        })
        cs = state.segmentations[(0, 0)]['colored_segments']
        # segment 2 occupies [10:30, 10:30], should have BGR=(0,0,255), alpha=180
        assert cs[15, 15, 0] == 0    # B
        assert cs[15, 15, 1] == 0    # G
        assert cs[15, 15, 2] == 255  # R
        assert cs[15, 15, 3] == 180  # A

    async def test_label_404_missing_patch(self, client):
        r = await client.post("/api/label-segment", json={
            "patch_y": 99, "patch_x": 99, "segment_id": 1,
            "tag": "test", "color": "#000000"
        })
        assert r.status_code == 404

    async def test_label_updates_segment_colors_cache(self, client, setup_segmented_patch):
        await client.post("/api/label-segment", json={
            "patch_y": 0, "patch_x": 0, "segment_id": 2,
            "tag": "quartz", "color": "#ff0000"
        })
        assert state.segment_colors[(0, 0, 2)] == 'quartz'


# ─── GET /api/tags ──────────────────────────────────────────────────────────────

class TestGetTags:
    async def test_empty_tags(self, client):
        r = await client.get("/api/tags")
        assert r.json() == {"tag_colors": {}}

    async def test_with_tags(self, client):
        state.tag_colors = {"quartz": "#ff0000", "feldspar": "#00ff00"}
        r = await client.get("/api/tags")
        assert r.json()["tag_colors"]["quartz"] == "#ff0000"


# ─── POST /api/rename-tag ──────────────────────────────────────────────────────

class TestRenameTag:
    async def test_rename_success(self, client, setup_segmented_patch):
        state.tag_colors = {"alpha": "#aabbcc"}
        state.segmentations[(0, 0)]['segment_tags'] = {2: "alpha"}
        state.segment_colors[(0, 0, 2)] = "alpha"

        r = await client.post("/api/rename-tag", json={"old_name": "alpha", "new_name": "beta"})
        assert r.status_code == 200
        assert "alpha" not in state.tag_colors
        assert state.tag_colors["beta"] == "#aabbcc"
        assert state.segmentations[(0, 0)]['segment_tags'][2] == "beta"
        assert state.segment_colors[(0, 0, 2)] == "beta"

    async def test_rename_conflict(self, client):
        state.tag_colors = {"alpha": "#aaa", "beta": "#bbb"}
        r = await client.post("/api/rename-tag", json={"old_name": "alpha", "new_name": "beta"})
        assert r.status_code == 400

    async def test_rename_nonexistent(self, client):
        r = await client.post("/api/rename-tag", json={"old_name": "nope", "new_name": "beta"})
        assert r.status_code == 200  # no-op, doesn't error


# ─── POST /api/recolor-tag ─────────────────────────────────────────────────────

class TestRecolorTag:
    async def test_recolor_success(self, client, setup_segmented_patch):
        state.tag_colors = {"quartz": "#ff0000"}
        seg = state.segmentations[(0, 0)]
        seg['segment_tags'] = {2: "quartz"}
        # Tag segment 2 with old color
        mask = seg['labels'] == 2
        seg['colored_segments'][mask] = [0, 0, 255, 180]

        r = await client.post("/api/recolor-tag", json={"tag_name": "quartz", "new_color": "#00ff00"})
        assert r.status_code == 200
        assert state.tag_colors["quartz"] == "#00ff00"
        # Check pixel color updated — #00ff00 = BGR (0, 255, 0)
        cs = seg['colored_segments']
        assert cs[15, 15, 0] == 0    # B
        assert cs[15, 15, 1] == 255  # G
        assert cs[15, 15, 2] == 0    # R


# ─── POST /api/delete-tag ──────────────────────────────────────────────────────

class TestDeleteTag:
    async def test_delete_success(self, client, setup_segmented_patch):
        state.tag_colors = {"quartz": "#ff0000"}
        seg = state.segmentations[(0, 0)]
        seg['segment_tags'] = {2: "quartz"}
        mask = seg['labels'] == 2
        seg['colored_segments'][mask] = [0, 0, 255, 180]
        state.segment_colors[(0, 0, 2)] = "quartz"

        r = await client.post("/api/delete-tag", json={"tag_name": "quartz"})
        assert r.status_code == 200
        assert "quartz" not in state.tag_colors
        assert 2 not in seg['segment_tags']
        assert (0, 0, 2) not in state.segment_colors
        # Pixels should be cleared
        assert seg['colored_segments'][15, 15, 3] == 0

    async def test_delete_nonexistent(self, client):
        r = await client.post("/api/delete-tag", json={"tag_name": "nope"})
        assert r.status_code == 200


# ─── GET /api/tag-locations ─────────────────────────────────────────────────────

class TestTagLocations:
    async def test_no_locations(self, client, setup_segmented_patch):
        r = await client.get("/api/tag-locations/quartz")
        assert r.json()["locations"] == []

    async def test_with_locations(self, client, setup_segmented_patch):
        state.segmentations[(0, 0)]['segment_tags'] = {2: "quartz", 3: "quartz"}
        r = await client.get("/api/tag-locations/quartz")
        locs = r.json()["locations"]
        assert len(locs) == 1
        assert locs[0]["patch_y"] == 0
        assert locs[0]["patch_x"] == 0
        assert locs[0]["count"] == 2
        # Check bounds structure
        seg = locs[0]["segments"][0]
        assert "bounds" in seg
        b = seg["bounds"]
        for key in ["x_min", "y_min", "x_max", "y_max", "cx", "cy"]:
            assert key in b

    async def test_multiple_patches(self, client, fake_patch, fake_labels):
        for name in ['ppl45', 'ppl90', 'xpl45', 'xpl90']:
            state.patches[name] = {(0, 0): fake_patch, (0, 1): fake_patch}
        cs_rgba = np.zeros((64, 64, 4), dtype=np.uint8)
        for pos in [(0, 0), (0, 1)]:
            state.segmentations[pos] = {
                'bounds': fake_patch, 'colored_segments': cs_rgba.copy(),
                'labels': fake_labels.copy(), 'segment_tags': {2: "alpha"},
                'original_colors': {},
            }
        r = await client.get("/api/tag-locations/alpha")
        assert len(r.json()["locations"]) == 2


# ─── GET /api/patch-thumbnail ──────────────────────────────────────────────────

class TestPatchThumbnail:
    async def test_returns_jpeg(self, client, fake_patch):
        state.patches['xpl45'] = {(0, 0): fake_patch}
        r = await client.get("/api/patch-thumbnail/0/0")
        assert r.status_code == 200
        assert r.headers["content-type"] == "image/jpeg"

    async def test_404_missing(self, client):
        r = await client.get("/api/patch-thumbnail/99/99")
        assert r.status_code == 404


# ─── GET /api/patch-tag-preview ─────────────────────────────────────────────────

class TestPatchTagPreview:
    async def test_returns_jpeg(self, client, setup_segmented_patch):
        state.tag_colors["quartz"] = "#ff0000"
        state.segmentations[(0, 0)]['segment_tags'] = {2: "quartz"}
        r = await client.get("/api/patch-tag-preview/0/0/quartz")
        assert r.status_code == 200
        assert r.headers["content-type"] == "image/jpeg"

    async def test_404_missing_patch(self, client):
        r = await client.get("/api/patch-tag-preview/99/99/test")
        assert r.status_code == 404

    async def test_no_matching_segments(self, client, setup_segmented_patch):
        """Tag with no segments in this patch should still return image (just dimmed)."""
        r = await client.get("/api/patch-tag-preview/0/0/nonexistent")
        assert r.status_code == 200


# ─── GET /api/segment-preview ──────────────────────────────────────────────────

class TestSegmentPreview:
    async def test_returns_jpeg(self, client, setup_segmented_patch):
        r = await client.get("/api/segment-preview/0/0/2")
        assert r.status_code == 200
        assert r.headers["content-type"] == "image/jpeg"

    async def test_404_missing_patch(self, client):
        r = await client.get("/api/segment-preview/99/99/1")
        assert r.status_code == 404

    async def test_404_missing_segment(self, client, setup_segmented_patch):
        r = await client.get("/api/segment-preview/0/0/999")
        assert r.status_code == 404

    async def test_with_tag_color(self, client, setup_segmented_patch):
        state.tag_colors["quartz"] = "#ff0000"
        state.segmentations[(0, 0)]['segment_tags'] = {2: "quartz"}
        r = await client.get("/api/segment-preview/0/0/2")
        assert r.status_code == 200


# ─── GET /api/selection-mask ────────────────────────────────────────────────────

class TestSelectionMask:
    async def test_404_no_segmentation(self, client):
        r = await client.get("/api/selection-mask/0/0?ids=1")
        assert r.status_code == 404

    async def test_returns_mask(self, client, setup_segmented_patch):
        r = await client.get("/api/selection-mask/0/0?ids=2,3")
        assert r.status_code == 200
        assert "image" in r.json()

    async def test_empty_ids(self, client, setup_segmented_patch):
        r = await client.get("/api/selection-mask/0/0?ids=")
        assert r.status_code == 200

    async def test_single_id(self, client, setup_segmented_patch):
        r = await client.get("/api/selection-mask/0/0?ids=2")
        assert r.status_code == 200


# ─── GET /api/status ────────────────────────────────────────────────────────────

class TestGetStatus:
    async def test_empty_status(self, client):
        r = await client.get("/api/status")
        data = r.json()
        assert data["images_loaded"] is False
        assert data["total_segments"] == 0
        assert data["tagged_segments"] == 0
        assert data["untagged_segments"] == 0

    async def test_with_segmented_data(self, client, setup_segmented_patch):
        r = await client.get("/api/status")
        data = r.json()
        assert data["total_segments"] == 2  # segments 2 and 3
        assert data["untagged_segments"] == 2

    async def test_after_tagging(self, client, setup_segmented_patch):
        state.segmentations[(0, 0)]['segment_tags'] = {2: "quartz"}
        state.segmentations[(0, 0)]['tagged_count'] = 1
        r = await client.get("/api/status")
        data = r.json()
        assert data["tagged_segments"] == 1
        assert data["untagged_segments"] == 1


# ─── GET /api/patch-segment-at-point ────────────────────────────────────────────

class TestSegmentAtPoint:
    async def test_not_ready(self, client):
        r = await client.get("/api/patch-segment-at-point/0/0?x=5&y=5")
        assert r.json()["status"] == "not_ready"

    async def test_returns_segment(self, client, setup_segmented_patch):
        # Point (15, 15) is in segment 2
        r = await client.get("/api/patch-segment-at-point/0/0?x=15&y=15")
        data = r.json()
        assert data["status"] == "success"
        assert data["segment_id"] == 2

    async def test_returns_background(self, client, setup_segmented_patch):
        # Point (0, 0) is in segment 0 (background)
        r = await client.get("/api/patch-segment-at-point/0/0?x=0&y=0")
        assert r.json()["segment_id"] == 0

    async def test_out_of_bounds(self, client, setup_segmented_patch):
        r = await client.get("/api/patch-segment-at-point/0/0?x=9999&y=9999")
        assert r.status_code == 400

    async def test_with_tag(self, client, setup_segmented_patch):
        state.segmentations[(0, 0)]['segment_tags'] = {2: "quartz"}
        state.tag_colors["quartz"] = "#ff0000"
        r = await client.get("/api/patch-segment-at-point/0/0?x=15&y=15")
        data = r.json()
        assert data["tag"] == "quartz"
        assert data["color"] == "#ff0000"


# ─── GET /api/segment-color ────────────────────────────────────────────────────

class TestSegmentColor:
    async def test_returns_color(self, client, setup_segmented_patch):
        r = await client.get("/api/segment-color/0/0/2")
        assert r.status_code == 200
        assert r.json()["color"] == "#c89664"

    async def test_404_missing_patch(self, client):
        r = await client.get("/api/segment-color/99/99/1")
        assert r.status_code == 404

    async def test_400_missing_segment(self, client, setup_segmented_patch):
        r = await client.get("/api/segment-color/0/0/999")
        assert r.status_code == 400


# ─── GET /api/segmentation-progress ────────────────────────────────────────────

class TestSegmentationProgress:
    async def test_default_progress(self, client):
        r = await client.get("/api/segmentation-progress")
        data = r.json()
        assert data["is_running"] is False
        assert data["total"] == 0
        assert data["completed"] == 0

    async def test_in_progress(self, client):
        state.is_segmenting = True
        state.segmentation_progress = {"total": 10, "completed": 3, "current": (0, 2)}
        r = await client.get("/api/segmentation-progress")
        data = r.json()
        assert data["is_running"] is True
        assert data["total"] == 10
        assert data["completed"] == 3


# ─── Task 6: TestExtendedProgress ───────────────────────────────────────────────

class TestExtendedProgress:
    @pytest.mark.asyncio
    async def test_progress_includes_patch_lists(self, client, setup_segmented_patch):
        """segmentation-progress should return processed, active, and pending patch lists."""
        state.is_segmenting = True
        state.seg_pending = deque([(0, 1), (1, 0)])
        state.seg_active = {(1, 1)}

        resp = await client.get('/api/segmentation-progress')
        assert resp.status_code == 200
        data = resp.json()
        assert [0, 0] in data['processed']
        assert data['current_active'] == [[1, 1]]
        assert [0, 1] in data['pending']
        assert [1, 0] in data['pending']
        assert data['is_running'] is True

    @pytest.mark.asyncio
    async def test_progress_when_idle(self, client, setup_segmented_patch):
        """When not segmenting, processed should contain completed patches."""
        resp = await client.get('/api/segmentation-progress')
        data = resp.json()
        assert [0, 0] in data['processed']
        assert data['current_active'] == []
        assert data['pending'] == []
        assert data['is_running'] is False


# ─── POST /api/save-project ────────────────────────────────────────────────────

class TestSaveProject:
    async def test_saves_tags_json(self, client, tmp_path):
        state.tag_colors = {"quartz": "#ff0000"}
        state.session_id = "20260313_120000"
        out = str(tmp_path / "save_test")
        r = await client.post("/api/save-project", json={"output_path": out})
        assert r.status_code == 200
        with open(os.path.join(out, "tags.json")) as f:
            data = json.load(f)
        assert data["tag_colors"]["quartz"] == "#ff0000"
        assert data["session"] == "20260313_120000"

    async def test_saves_aligned_images(self, client, tmp_path, fake_patch):
        state.aligned_images['xpl45'] = fake_patch
        out = str(tmp_path / "save_imgs")
        r = await client.post("/api/save-project", json={"output_path": out})
        assert r.status_code == 200
        assert os.path.isfile(os.path.join(out, "xpl45_aligned.png"))


# ─── POST /api/export ──────────────────────────────────────────────────────────

class TestExport:
    async def test_creates_folder_structure(self, client, tmp_path, setup_segmented_patch):
        state.tag_colors = {"Кварц": "#aabbcc"}
        out = str(tmp_path / "export_test")
        r = await client.post("/api/export", json={"output_path": out})
        assert r.status_code == 200
        for folder in ['xpl45', 'xpl90', 'ppl45', 'ppl90', 'segments']:
            assert os.path.isdir(os.path.join(out, folder))
        assert os.path.isfile(os.path.join(out, 'xpl45', 'patch_000_000.png'))
        assert os.path.isfile(os.path.join(out, 'segments', 'patch_000_000.png'))
        with open(os.path.join(out, 'tags.json'), encoding="utf-8") as f:
            data = json.load(f)
        assert data == {"Кварц": "#aabbcc"}

    async def test_skips_unsegmented_patches(self, client, tmp_path, fake_patch):
        state.tag_colors = {}
        state.grid_size = (1, 2)
        for name in ['ppl45', 'ppl90', 'xpl45', 'xpl90']:
            state.patches[name] = {(0, 0): fake_patch, (0, 1): fake_patch}
        state.segmentations[(0, 0)] = {
            'colored_segments': fake_patch.copy(),
            'bounds': fake_patch, 'labels': np.zeros((64, 64), dtype=np.int32),
            'segment_tags': {}, 'original_colors': {},
        }
        out = str(tmp_path / "export_skip")
        r = await client.post("/api/export", json={"output_path": out})
        assert r.status_code == 200
        assert os.path.isfile(os.path.join(out, 'segments', 'patch_000_000.png'))
        assert not os.path.isfile(os.path.join(out, 'segments', 'patch_000_001.png'))
        assert os.path.isfile(os.path.join(out, 'xpl45', 'patch_000_001.png'))


# ─── POST /api/start-segmentation ──────────────────────────────────────────────

class TestStartSegmentation:
    async def test_already_running(self, client):
        state.is_segmenting = True
        r = await client.post("/api/start-segmentation")
        assert r.json()["status"] == "already_running"

    async def test_starts(self, client, fake_patch):
        state.grid_size = (1, 1)
        for name in ['xpl45', 'xpl90']:
            state.patches[name] = {(0, 0): fake_patch}
        state.segmentation_progress = {"total": 1, "completed": 0, "current": None}
        r = await client.post("/api/start-segmentation")
        assert r.json()["status"] == "started"


# ─── Task 4: TestStartSegmentationQueue ─────────────────────────────────────────

class TestStartSegmentationQueue:
    @pytest.mark.asyncio
    async def test_start_populates_pending(self, client, fake_patch):
        """start-segmentation should populate seg_pending before dispatching task."""
        state.grid_size = (2, 2)
        for name in ['ppl45', 'ppl90', 'xpl45', 'xpl90']:
            state.patches[name] = {}
            for py in range(2):
                for px in range(2):
                    state.patches[name][(py, px)] = fake_patch.copy()

        resp = await client.post('/api/start-segmentation')
        assert resp.status_code == 200
        data = resp.json()
        assert data['status'] == 'started'
        assert state.is_segmenting is True
        total = len(state.seg_pending) + len(state.seg_active) + len(state.segmentations)
        assert total >= 4
        state.is_segmenting = False
        await asyncio.sleep(0.2)

    @pytest.mark.asyncio
    async def test_already_running(self, client):
        """start-segmentation should reject if already running."""
        state.is_segmenting = True
        resp = await client.post('/api/start-segmentation')
        data = resp.json()
        assert data['status'] == 'already_running'


# ─── POST /api/segment-patch ───────────────────────────────────────────────────

class TestSegmentSinglePatch:
    async def test_already_ready(self, client, setup_segmented_patch):
        r = await client.post("/api/segment-patch/0/0")
        assert r.json()["status"] == "already_ready"


# ─── Task 5: TestPrioritizePatch ────────────────────────────────────────────────

class TestPrioritizePatch:
    @pytest.mark.asyncio
    async def test_queues_when_segmenting(self, client, fake_patch):
        """segment-patch should return 'queued' and insert at front when batch is active."""
        state.is_segmenting = True
        state.seg_pending = deque([(1, 0), (1, 1)])
        state.seg_active = {(0, 1)}
        state.grid_size = (2, 2)
        for name in ['ppl45', 'ppl90', 'xpl45', 'xpl90']:
            state.patches[name] = {(0, 0): fake_patch.copy()}

        resp = await client.post('/api/segment-patch/0/0')
        assert resp.status_code == 200
        data = resp.json()
        assert data['status'] == 'queued'
        assert state.seg_pending[0] == (0, 0)

    @pytest.mark.asyncio
    async def test_skips_if_already_active(self, client, fake_patch):
        """segment-patch should not re-queue a patch that's currently processing."""
        state.is_segmenting = True
        state.seg_pending = deque([(1, 1)])
        state.seg_active = {(0, 0)}

        resp = await client.post('/api/segment-patch/0/0')
        data = resp.json()
        assert data['status'] == 'processing'
        assert (0, 0) not in state.seg_pending


# ─── Integration: full label + query flow ───────────────────────────────────────

class TestIntegrationFlow:
    async def test_label_then_query(self, client, setup_segmented_patch):
        """Label a segment, then verify it shows in tags, status, and locations."""
        # Label segment 2
        await client.post("/api/label-segment", json={
            "patch_y": 0, "patch_x": 0, "segment_id": 2,
            "tag": "quartz", "color": "#ff0000"
        })
        # Tags should include quartz
        r = await client.get("/api/tags")
        assert "quartz" in r.json()["tag_colors"]

        # Status should show 1 tagged
        r = await client.get("/api/status")
        assert r.json()["tagged_segments"] == 1

        # Tag locations should return segment 2
        r = await client.get("/api/tag-locations/quartz")
        locs = r.json()["locations"]
        assert len(locs) == 1
        assert locs[0]["segments"][0]["id"] == 2

        # Segment at point should return tag
        r = await client.get("/api/patch-segment-at-point/0/0?x=15&y=15")
        assert r.json()["tag"] == "quartz"

    async def test_rename_then_verify(self, client, setup_segmented_patch):
        """Label, rename, verify all references updated."""
        await client.post("/api/label-segment", json={
            "patch_y": 0, "patch_x": 0, "segment_id": 2,
            "tag": "alpha", "color": "#aabbcc"
        })
        await client.post("/api/rename-tag", json={"old_name": "alpha", "new_name": "beta"})

        r = await client.get("/api/tags")
        assert "beta" in r.json()["tag_colors"]
        assert "alpha" not in r.json()["tag_colors"]

        r = await client.get("/api/tag-locations/beta")
        assert len(r.json()["locations"]) == 1

        r = await client.get("/api/tag-locations/alpha")
        assert len(r.json()["locations"]) == 0

    async def test_delete_clears_everything(self, client, setup_segmented_patch):
        """Label, delete tag, verify everything cleaned up."""
        await client.post("/api/label-segment", json={
            "patch_y": 0, "patch_x": 0, "segment_id": 2,
            "tag": "alpha", "color": "#aabbcc"
        })
        await client.post("/api/delete-tag", json={"tag_name": "alpha"})

        r = await client.get("/api/tags")
        assert "alpha" not in r.json()["tag_colors"]

        r = await client.get("/api/status")
        assert r.json()["tagged_segments"] == 0

        # Colored segments should be cleared
        cs = state.segmentations[(0, 0)]['colored_segments']
        assert cs[15, 15, 3] == 0

    async def test_recolor_updates_pixels(self, client, setup_segmented_patch):
        """Label, recolor, verify pixel data updated."""
        await client.post("/api/label-segment", json={
            "patch_y": 0, "patch_x": 0, "segment_id": 2,
            "tag": "alpha", "color": "#ff0000"
        })
        # Verify original color
        cs = state.segmentations[(0, 0)]['colored_segments']
        assert cs[15, 15, 2] == 255  # R=255

        await client.post("/api/recolor-tag", json={"tag_name": "alpha", "new_color": "#0000ff"})
        # Now should be blue: BGR = (255, 0, 0)
        assert cs[15, 15, 0] == 255  # B=255
        assert cs[15, 15, 2] == 0    # R=0
