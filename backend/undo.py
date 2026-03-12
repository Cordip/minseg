"""Undo/redo system using Command Pattern for tag operations."""
from typing import Tuple


def hex_to_bgr(hex_color: str) -> Tuple[int, int, int]:
    hex_color = hex_color.lstrip('#')
    r = int(hex_color[0:2], 16)
    g = int(hex_color[2:4], 16)
    b = int(hex_color[4:6], 16)
    return (b, g, r)


def _push_undo(state, op: dict):
    """Record an operation for undo. Clears redo stack."""
    state.undo_stack.append(op)
    while len(state.undo_stack) > 200:
        state.undo_stack.pop(0)
    state.redo_stack.clear()


def _apply_label(state, patch_y, patch_x, segment_id, tag, color):
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


def _execute_undo_op(state, op: dict):
    """Execute the reverse of an operation."""
    t = op['type']
    if t == 'label_segment':
        old_tag = op['old_tag']
        old_color = op.get('old_color')
        _apply_label(state, op['patch_y'], op['patch_x'], op['segment_id'], old_tag, old_color)
    elif t == 'batch_label':
        for entry in op['entries']:
            old_tag = entry['old_tag']
            old_color = entry.get('old_color')
            _apply_label(state, entry['patch_y'], entry['patch_x'], entry['segment_id'], old_tag, old_color)
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


def _execute_redo_op(state, op: dict):
    """Re-execute a previously undone operation."""
    t = op['type']
    if t == 'label_segment':
        new_color = op.get('new_color')
        _apply_label(state, op['patch_y'], op['patch_x'], op['segment_id'], op['new_tag'], new_color)
        if op['new_tag'] and new_color:
            state.tag_colors[op['new_tag']] = new_color
    elif t == 'batch_label':
        color = op.get('color')
        if op['new_tag'] and color:
            state.tag_colors[op['new_tag']] = color
        for entry in op['entries']:
            _apply_label(state, entry['patch_y'], entry['patch_x'], entry['segment_id'], op['new_tag'], color)
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
