import cv2
import numpy as np
from concurrent.futures import ThreadPoolExecutor
from skimage import graph, color
from skimage.segmentation import find_boundaries, quickshift

def denoise(img):
    shifted = cv2.pyrMeanShiftFiltering(img, sp=20, sr=40)
    l_channel = img[:,:,0]
    gradient = cv2.Laplacian(l_channel, cv2.CV_64F)
    gradient = np.uint8(np.absolute(gradient))
    _, small_details = cv2.threshold(gradient, 50, 255, cv2.THRESH_BINARY)
    result = shifted.copy()
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2,2))
    small_details = cv2.dilate(small_details, kernel, iterations=1)
    result = cv2.inpaint(result, small_details, inpaintRadius=2, flags=cv2.INPAINT_TELEA)
    return result

def merge_nodes(g, src, dst):
    count_src = g.nodes[src]['pixel count']
    count_dst = g.nodes[dst]['pixel count']
    total_count = count_src + count_dst
    mean_color_src = g.nodes[src]['mean color']
    mean_color_dst = g.nodes[dst]['mean color']
    new_mean_color = (mean_color_src * count_src + mean_color_dst * count_dst) / total_count
    g.nodes[dst]['mean color'] = new_mean_color
    g.nodes[dst]['pixel count'] = total_count

def weight_boundary(g, src, dst, n):
    c1 = g.nodes[dst]['mean color']
    c2 = g.nodes[n]['mean color']
    dist = color.deltaE_ciede2000(c1, c2)
    return {'weight': float(dist)}

def segmentation(img, thresh):
    denoised_img = denoise(img)
    segments = quickshift(denoised_img, kernel_size=3, max_dist=30, ratio=1)
    img_lab = color.rgb2lab(denoised_img / 255.0)
    g = graph.rag_mean_color(img_lab, segments)
    for u, v in g.edges():
        g[u][v]['weight'] = weight_boundary(g, u, u, v)['weight']
    labels_merged = graph.merge_hierarchical(
        segments, g, thresh=thresh, rag_copy=False, 
        in_place_merge=True, merge_func=merge_nodes, weight_func=weight_boundary
    )
    edges_final = find_boundaries(labels_merged, mode='inner')
    boundary_overlay = np.zeros_like(img).astype(np.float32)
    alpha = 0.7
    line_color = (1.0, 1.0, 0.0)
    for c in range(3):
        boundary_overlay[edges_final, c] = (boundary_overlay[edges_final, c] * (1 - alpha)) + (line_color[c] * alpha)
    return boundary_overlay

def zhang_suen_thinning(img):
    src = (img * 255).astype(np.uint8) if img.max() <= 1 else img.astype(np.uint8)
    thinned = cv2.ximgproc.thinning(src, thinningType=cv2.ximgproc.THINNING_ZHANGSUEN)
    return (thinned > 0).astype(np.uint8)

def process_mask(mask_img, pixels=6):
    if mask_img.dtype != np.uint8: mask_img = (mask_img * 255).clip(0, 255).astype(np.uint8)
    gray = cv2.cvtColor(mask_img, cv2.COLOR_BGR2GRAY) if len(mask_img.shape) == 3 else mask_img
    binary = (gray > 0).astype(np.uint8)
    dilated = cv2.dilate(binary, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2*pixels+1, 2*pixels+1)))
    skeleton = zhang_suen_thinning(dilated)
    inv_mask = 1 - cv2.dilate(skeleton, np.ones((3, 3), np.uint8), iterations=1)
    num_labels, labels = cv2.connectedComponents(inv_mask.astype(np.uint8), connectivity=8)
    if num_labels > 1:
        markers = labels.astype(np.int32)
        dist = cv2.normalize(cv2.distanceTransform((markers > 0).astype(np.uint8), cv2.DIST_L2, 5), None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)
        cv2.watershed(cv2.merge([dist, dist, dist]), markers)
        outside_label = markers[0, 0] if markers[0, 0] != -1 else markers[0, 1]
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
        clean_labels = cv2.dilate(final_priority_map, np.ones((3, 3), np.uint8), iterations=3).astype(np.int32)
        colors_hsv = np.zeros((new_idx, 1, 3), dtype=np.uint8)
        if new_idx > 2:
            colors_hsv[2:, 0, 0] = np.random.randint(0, 180, size=(new_idx - 2))
            colors_hsv[2:, 0, 1] = np.random.randint(30, 120, size=(new_idx - 2))
            colors_hsv[2:, 0, 2] = np.random.randint(200, 256, size=(new_idx - 2))
        colored_segments = cv2.cvtColor(colors_hsv, cv2.COLOR_HSV2BGR)[clean_labels].reshape(mask_img.shape[0], mask_img.shape[1], 3)
    else:
        colored_segments = np.zeros((mask_img.shape[0], mask_img.shape[1], 3), dtype=np.uint8)
        clean_labels = np.zeros((mask_img.shape[0], mask_img.shape[1]), dtype=np.int32)
    
    edges = np.zeros((mask_img.shape[0], mask_img.shape[1], 3), dtype=np.uint8)
    e_mask = (clean_labels[:, 1:] != clean_labels[:, :-1])
    edges[:, 1:, 1] = e_mask.astype(np.uint8) * 255
    edges[:, 1:, 2] = e_mask.astype(np.uint8) * 255
    return colored_segments, edges, clean_labels

def full_segmentation(xpl90, xpl45, thresh=20.0):
    with ThreadPoolExecutor(max_workers=2) as pool:
        f90 = pool.submit(segmentation, xpl90, thresh)
        f45 = pool.submit(segmentation, xpl45, thresh)
        b90 = f90.result()
        b45 = f45.result()
    bounds = np.maximum(b90, b45)
    return process_mask(bounds, 6)
