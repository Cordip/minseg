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
