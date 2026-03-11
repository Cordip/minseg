"""
Image Segmentation Module
Contains all segmentation logic for mineral grain analysis
"""
import cv2
import numpy as np
from skimage import graph, color
from skimage.segmentation import slic, find_boundaries, quickshift
from skimage.filters import sobel
from scipy.ndimage import gaussian_filter
from typing import Tuple, Dict, Any
import multiprocessing as mp
from functools import partial


def fill_by_components(img: np.ndarray, grad_thresh: int = 15, 
                       close_kernel: int = 5, min_area: int = 50) -> np.ndarray:
    """
    Fill regions by connected components after edge detection.
    
    Args:
        img: Input image (LAB format)
        grad_thresh: Gradient threshold for edge detection
        close_kernel: Kernel size for morphological closing
        min_area: Minimum area for keeping regions
        
    Returns:
        Image with filled components
    """
    gray = img[:, :, 0]  # L channel
    grad = cv2.Laplacian(gray, cv2.CV_64F)
    grad = np.uint8(np.abs(grad))
    
    _, edges = cv2.threshold(grad, grad_thresh, 255, cv2.THRESH_BINARY)
    
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (close_kernel, close_kernel))
    closed_edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel, iterations=2)
    
    regions = cv2.bitwise_not(closed_edges)
    
    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(regions, connectivity=8)
    clean_regions = np.zeros_like(regions)
    for i in range(1, num_labels):
        if stats[i, cv2.CC_STAT_AREA] >= min_area:
            clean_regions[labels == i] = 255
    
    num_final, final_labels = cv2.connectedComponents(clean_regions, connectivity=8)
    
    result = img.copy()
    for label_id in range(1, num_final):
        mask = (final_labels == label_id)
        mean_color = cv2.mean(img, mask.astype(np.uint8) * 255)[:3]
        result[mask] = mean_color
    
    return result


def denoise(img: np.ndarray) -> np.ndarray:
    """
    Denoise image using mean shift filtering and inpainting.
    
    Args:
        img: Input image (LAB format)
        
    Returns:
        Denoised image
    """
    shifted = cv2.pyrMeanShiftFiltering(img, sp=20, sr=40)
    
    l_channel = img[:, :, 0]
    
    gradient = cv2.Laplacian(l_channel, cv2.CV_64F)
    gradient = np.uint8(np.absolute(gradient))
    
    _, small_details = cv2.threshold(gradient, 50, 255, cv2.THRESH_BINARY)
    
    result = shifted.copy()
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2, 2))
    small_details = cv2.dilate(small_details, kernel, iterations=1)
    
    result = cv2.inpaint(result, small_details, inpaintRadius=2, flags=cv2.INPAINT_TELEA)
    
    return result


def merge_nodes(g: graph.RAG, src: int, dst: int):
    """Merge nodes in RAG by blending mean colors."""
    count_src = g.nodes[src]['pixel count']
    count_dst = g.nodes[dst]['pixel count']
    total_count = count_src + count_dst
    
    mean_color_src = g.nodes[src]['mean color']
    mean_color_dst = g.nodes[dst]['mean color']
    
    new_mean_color = (mean_color_src * count_src + mean_color_dst * count_dst) / total_count
    
    g.nodes[dst]['mean color'] = new_mean_color
    g.nodes[dst]['pixel count'] = total_count


def weight_boundary(g: graph.RAG, src: int, dst: int, n: int) -> Dict[str, float]:
    """Calculate boundary weight using CIEDE2000 color difference."""
    c1 = g.nodes[dst]['mean color']
    c2 = g.nodes[n]['mean color']
    
    dist = color.deltaE_ciede2000(c1, c2)
    return {'weight': float(dist)}


def segment_patch(img: np.ndarray, thresh: float = 20.0, 
                  use_quickshift: bool = True) -> Tuple[np.ndarray, np.ndarray]:
    """
    Segment a single image patch.
    
    Args:
        img: Input image patch (BGR format, uint8)
        thresh: Threshold for hierarchical merging (Delta E units)
        use_quickshift: Use QuickShift instead of SLIC
        
    Returns:
        Tuple of (boundary_overlay, labels_merged)
    """
    # Denoise
    denoised_img = denoise(img)
    
    # Segmentation
    if use_quickshift:
        segments = quickshift(denoised_img, kernel_size=3, max_dist=30, ratio=1)
    else:
        segments = slic(denoised_img, n_segments=400, compactness=9, sigma=1, start_label=1)
    
    # Convert to LAB for RAG
    img_lab = color.rgb2lab(denoised_img / 255.0)
    
    # Build RAG
    g = graph.rag_mean_color(img_lab, segments)
    
    # Initialize edge weights
    for u, v in g.edges():
        g[u][v]['weight'] = weight_boundary(g, u, u, v)['weight']
    
    # Hierarchical merging
    labels_merged = graph.merge_hierarchical(
        segments,
        g,
        thresh=thresh,
        rag_copy=False,
        in_place_merge=True,
        merge_func=merge_nodes,
        weight_func=weight_boundary
    )
    
    # Create boundary overlay
    edges_final = find_boundaries(labels_merged, mode='inner')
    boundary_overlay = np.zeros_like(img).astype(np.float32)
    
    line_color = np.array([0.0, 1.0, 1.0])  # Yellow
    alpha = 0.7
    
    for c in range(3):
        boundary_overlay[edges_final, c] = (
            boundary_overlay[edges_final, c] * (1 - alpha)
        ) + (line_color[c] * alpha)
    
    return boundary_overlay, labels_merged


def process_mask(mask_img: np.ndarray, pixels: int = 6) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Process segmentation mask to create clean labeled segments.
    
    Args:
        mask_img: Boundary mask image
        pixels: Number of pixels for boundary expansion
        
    Returns:
        Tuple of (colored_segments, final_bounds, clean_labels)
    """
    if mask_img.dtype != np.uint8:
        mask_img = (mask_img * 255).clip(0, 255).astype(np.uint8)
    
    if len(mask_img.shape) == 3:
        gray = cv2.cvtColor(mask_img, cv2.COLOR_BGR2GRAY)
    else:
        gray = mask_img
    
    binary = (gray > 0).astype(np.uint8)
    
    kernel_size = 2 * pixels + 1
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kernel_size, kernel_size))
    dilated = cv2.dilate(binary, kernel)
    
    # Zhang-Suen thinning
    skeleton = zhang_suen_thinning(dilated)
    
    thick_boundaries = cv2.dilate(skeleton, np.ones((3, 3), np.uint8), iterations=1)
    inv_mask = 1 - thick_boundaries
    
    num_labels, labels = cv2.connectedComponents(inv_mask.astype(np.uint8), connectivity=8)
    
    if num_labels > 1:
        markers = labels.astype(np.int32)
        
        dist = cv2.distanceTransform((markers > 0).astype(np.uint8), cv2.DIST_L2, 5)
        dist_u8 = cv2.normalize(dist, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)
        dist_3ch = cv2.merge([dist_u8, dist_u8, dist_u8])
        
        cv2.watershed(dist_3ch, markers)
        
        outside_label = markers[0, 0]
        if outside_label == -1:
            outside_label = markers[0, 1]
        
        priority_markers = markers.copy()
        priority_markers[markers == -1] = 0
        priority_markers[markers == outside_label] = 1
        
        unique_vals = np.unique(priority_markers)
        unique_vals = unique_vals[(unique_vals != 0) & (unique_vals != outside_label)]
        
        final_priority_map = np.zeros_like(priority_markers, dtype=np.float32)
        final_priority_map[priority_markers == outside_label] = 1
        
        new_idx = 2
        for val in unique_vals:
            final_priority_map[priority_markers == val] = new_idx
            new_idx += 1
        
        kernel_dilate = np.ones((3, 3), np.uint8)
        markers_dilated = cv2.dilate(final_priority_map, kernel_dilate, iterations=3)
        clean_labels = markers_dilated.astype(np.int32)
        
        # Create colors
        colors_hsv = np.zeros((new_idx, 1, 3), dtype=np.uint8)
        
        if new_idx > 2:
            colors_hsv[2:, 0, 0] = np.random.randint(0, 180, size=(new_idx - 2))
            colors_hsv[2:, 0, 1] = np.random.randint(30, 120, size=(new_idx - 2))
            colors_hsv[2:, 0, 2] = np.random.randint(200, 256, size=(new_idx - 2))
        
        colors_bgr = cv2.cvtColor(colors_hsv, cv2.COLOR_HSV2BGR)
        colored_segments = colors_bgr[clean_labels].reshape(
            mask_img.shape[0], mask_img.shape[1], 3
        )
    else:
        colored_segments = np.zeros((mask_img.shape[0], mask_img.shape[1], 3), dtype=np.uint8)
        clean_labels = np.zeros((mask_img.shape[0], mask_img.shape[1]), dtype=np.int32)
    
    # Create boundary edges
    edges = np.zeros((mask_img.shape[0], mask_img.shape[1]), dtype=np.uint8)
    edges[:, 1:] += (clean_labels[:, 1:] != clean_labels[:, :-1]).astype(np.uint8)
    edges[1:, :] += (clean_labels[1:, :] != clean_labels[:-1, :]).astype(np.uint8)
    edges = (edges > 0).astype(np.uint8) * 255
    
    final_color = np.zeros_like(mask_img)
    final_color[:, :, 1] = edges
    final_color[:, :, 2] = edges
    
    return colored_segments, final_color, clean_labels


def zhang_suen_thinning(img: np.ndarray) -> np.ndarray:
    """
    Apply Zhang-Suen thinning algorithm.
    
    Args:
        img: Binary image (0 or 1 values)
        
    Returns:
        Thinned image
    """
    img = img.copy()
    h, w = img.shape
    
    while True:
        to_remove_step1 = []
        to_remove_step2 = []
        whites = np.argwhere(img == 1)
        changed = False
        
        for y, x in whites:
            if img[y, x] == 0:
                continue
            if y == 0 or y == h - 1 or x == 0 or x == w - 1:
                continue
            
            p2, p3, p4, p5, p6, p7, p8, p9 = (
                img[y - 1, x], img[y - 1, x + 1], img[y, x + 1], img[y + 1, x + 1],
                img[y + 1, x], img[y + 1, x - 1], img[y, x - 1], img[y - 1, x - 1]
            )
            neighbors = [p2, p3, p4, p5, p6, p7, p8, p9]
            A = sum(1 for i in range(8) if neighbors[i] == 0 and neighbors[(i + 1) % 8] == 1)
            B = sum(neighbors)
            
            if A == 1 and 2 <= B <= 6 and p2 * p4 * p6 == 0 and p4 * p6 * p8 == 0:
                to_remove_step1.append((y, x))
        
        for y, x in to_remove_step1:
            img[y, x] = 0
            changed = True
        
        whites = np.argwhere(img == 1)
        for y, x in whites:
            if img[y, x] == 0:
                continue
            if y == 0 or y == h - 1 or x == 0 or x == w - 1:
                continue
            
            p2, p3, p4, p5, p6, p7, p8, p9 = (
                img[y - 1, x], img[y - 1, x + 1], img[y, x + 1], img[y + 1, x + 1],
                img[y + 1, x], img[y + 1, x - 1], img[y, x - 1], img[y - 1, x - 1]
            )
            neighbors = [p2, p3, p4, p5, p6, p7, p8, p9]
            A = sum(1 for i in range(8) if neighbors[i] == 0 and neighbors[(i + 1) % 8] == 1)
            B = sum(neighbors)
            
            if A == 1 and 2 <= B <= 6 and p2 * p4 * p8 == 0 and p2 * p6 * p8 == 0:
                to_remove_step2.append((y, x))
        
        for y, x in to_remove_step2:
            img[y, x] = 0
            changed = True
        
        if not changed:
            break
    
    return img


def full_segmentation(xpl90: np.ndarray, xpl45: np.ndarray, 
                      thresh: float = 20.0) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Perform full segmentation combining XPL 90 and XPL 45 images.
    
    Args:
        xpl90: XPL 90 degree image
        xpl45: XPL 45 degree image
        thresh: Segmentation threshold
        
    Returns:
        Tuple of (combined_boundaries, colored_segments, labels)
    """
    # Segment both images
    boundary90, labels90 = segment_patch(xpl90, thresh=thresh)
    boundary45, labels45 = segment_patch(xpl45, thresh=thresh)
    
    # Combine boundaries
    bounds_all = np.maximum(boundary90, boundary45)
    
    # Process combined mask
    colored_segments, final_bounds, clean_labels = process_mask(bounds_all, pixels=6)
    
    return bounds_all, colored_segments, clean_labels
