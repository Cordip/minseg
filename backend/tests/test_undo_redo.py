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
