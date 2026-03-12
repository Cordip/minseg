import cv2
import numpy as np
import math
import random

class HueNormalizer:
    def __init__(self, bin_count=12, min_saturation_process=40):
        self.bin_count = bin_count
        self.min_saturation_process = min_saturation_process

    def normalize(self, img):
        return img.copy()

class Aligner:
    def __init__(self,
                 coarse_downscale=0.25,
                 coarse_max_features=12000,
                 patch_size=1024,
                 patch_downscale_factor=10,
                 vote_angle_tol=8.0,
                 vote_scale_tol=0.05,
                 vote_shift_tol=5.0,
                 hue_bin_count=12,
                 hue_min_saturation=40):
        self.coarse_downscale = coarse_downscale
        self.coarse_max_features = coarse_max_features
        self.patch_size = patch_size
        self.patch_downscale_factor = patch_downscale_factor
        self.vote_angle_tol = vote_angle_tol
        self.vote_scale_tol = vote_scale_tol
        self.vote_shift_tol = vote_shift_tol
        self.normalizer = HueNormalizer(
            bin_count=hue_bin_count,
            min_saturation_process=hue_min_saturation
        )

    def _coarse_similarity_align(self, img_ref, img_target):
        small_ref = cv2.resize(img_ref, (0, 0), fx=self.coarse_downscale, fy=self.coarse_downscale, interpolation=cv2.INTER_AREA)
        small_tgt = cv2.resize(img_target, (0, 0), fx=self.coarse_downscale, fy=self.coarse_downscale, interpolation=cv2.INTER_AREA)
        orb = cv2.ORB_create(self.coarse_max_features, scaleFactor=1.2, nlevels=8, edgeThreshold=31, firstLevel=0, WTA_K=2, scoreType=cv2.ORB_HARRIS_SCORE, patchSize=31)
        gray_ref = cv2.cvtColor(small_ref, cv2.COLOR_BGR2GRAY)
        gray_tgt = cv2.cvtColor(small_tgt, cv2.COLOR_BGR2GRAY)
        kp1, des1 = orb.detectAndCompute(gray_ref, None)
        kp2, des2 = orb.detectAndCompute(gray_tgt, None)
        if des1 is None or des2 is None or len(des1) < 30 or len(des2) < 30:
            return np.eye(2, 3, dtype=np.float32)
        bf = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)
        matches = bf.match(des1, des2)
        matches = sorted(matches, key=lambda x: x.distance)[:int(len(matches) * 0.3)]
        if len(matches) < 20:
            return np.eye(2, 3, dtype=np.float32)
        src_pts = np.float32([kp1[m.queryIdx].pt for m in matches]).reshape(-1, 1, 2)
        dst_pts = np.float32([kp2[m.trainIdx].pt for m in matches]).reshape(-1, 1, 2)
        M, _ = cv2.estimateAffinePartial2D(src_pts, dst_pts, method=cv2.RANSAC, ransacReprojThreshold=4.0)
        if M is None:
            return np.eye(2, 3, dtype=np.float32)
        M[0, 2] /= self.coarse_downscale
        M[1, 2] /= self.coarse_downscale
        return M

    @staticmethod
    def _normalize_to_similarity(M):
        a, b, tx = M[0]
        c, d, ty = M[1]
        scale = math.sqrt((a*a + c*c + b*b + d*d) / 2.0)
        angle_rad = math.atan2(c, a)
        cos = math.cos(angle_rad)
        sin = math.sin(angle_rad)
        return np.array([
            [scale * cos, -scale * sin, tx],
            [scale * sin,  scale * cos, ty]
        ], dtype=np.float32)

    @staticmethod
    def _get_params(M):
        a, b, tx = M[0]
        c, d, ty = M[1]
        scale = math.sqrt((a*a + c*c + b*b + d*d) / 2.0)
        angle = math.degrees(math.atan2(c, a)) % 360
        return angle, scale, tx, ty

    @staticmethod
    def _angle_diff(a, b):
        diff = (a - b) % 360
        return min(diff, 360 - diff)

    def _refine_global_ecc(self, img_ref, img_target, init_matrix=None):
        gray_ref = cv2.cvtColor(img_ref, cv2.COLOR_BGR2GRAY).astype(np.float32)
        gray_target = cv2.cvtColor(img_target, cv2.COLOR_BGR2GRAY).astype(np.float32)
        warp_matrix = np.eye(2, 3, dtype=np.float32) if init_matrix is None else init_matrix.copy().astype(np.float32)
        criteria = (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 500, 1e-8)
        try:
            _, warp_matrix = cv2.findTransformECC(gray_ref, gray_target, warp_matrix, cv2.MOTION_AFFINE, criteria, None, 1)
        except cv2.error:
            pass
        warp_matrix = self._normalize_to_similarity(warp_matrix)
        h, w = img_ref.shape[:2]
        aligned = cv2.warpAffine(img_target, warp_matrix, (w, h), flags=cv2.INTER_LINEAR + cv2.WARP_INVERSE_MAP)
        return aligned, warp_matrix

    def _align_images_patch_voting(self, img_ref, img_target, init_matrix=None):
        h_ref, w_ref = img_ref.shape[:2]
        step = self.patch_size
        valid_transforms = []
        for y in range(0, h_ref - self.patch_size + 1, step):
            for x in range(0, w_ref - self.patch_size + 1, step):
                patch_ref = img_ref[y:y+self.patch_size, x:x+self.patch_size]
                patch_tgt = img_target[y:y+self.patch_size, x:x+self.patch_size]
                if cv2.countNonZero(cv2.cvtColor(patch_ref, cv2.COLOR_BGR2GRAY)) < self.patch_size**2 * 0.08:
                    continue
                small_size = (self.patch_size // self.patch_downscale_factor, self.patch_size // self.patch_downscale_factor)
                small_ref = cv2.resize(patch_ref, small_size, cv2.INTER_AREA)
                small_tgt = cv2.resize(patch_tgt, small_size, cv2.INTER_AREA)
                gray_ref = cv2.cvtColor(small_ref, cv2.COLOR_BGR2GRAY).astype(np.float32)
                gray_tgt = cv2.cvtColor(small_tgt, cv2.COLOR_BGR2GRAY).astype(np.float32)
                warp = init_matrix.copy() if init_matrix is not None else np.eye(2, 3, dtype=np.float32)
                try:
                    _, warp = cv2.findTransformECC(gray_ref, gray_tgt, warp, cv2.MOTION_AFFINE, (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 80, 1e-3))
                    warp = self._normalize_to_similarity(warp)
                    valid_transforms.append({'matrix': warp, 'coords': (y, x)})
                except:
                    continue
        if not valid_transforms:
            return img_target, init_matrix if init_matrix is not None else np.eye(2, 3, dtype=np.float32)
        max_votes = 0
        best_cluster = []
        for item_i in valid_transforms:
            angle_i, scale_i, tx_i, ty_i = self._get_params(item_i['matrix'])
            cluster = []
            for item_j in valid_transforms:
                angle_j, scale_j, tx_j, ty_j = self._get_params(item_j['matrix'])
                if (self._angle_diff(angle_i, angle_j) < self.vote_angle_tol and
                    abs(scale_i - scale_j) < self.vote_scale_tol and
                    math.hypot(tx_i - tx_j, ty_i - ty_j) < self.vote_shift_tol):
                    cluster.append(item_j)
            if len(cluster) > max_votes:
                max_votes = len(cluster)
                best_cluster = cluster
        if not best_cluster:
            return img_target, init_matrix if init_matrix is not None else np.eye(2, 3, dtype=np.float32)
        winner = random.choice(best_cluster)
        y_p, x_p = winner['coords']
        start_matrix = winner['matrix'].copy()
        start_matrix[0, 2] *= self.patch_downscale_factor
        start_matrix[1, 2] *= self.patch_downscale_factor
        patch_ref = img_ref[y_p:y_p+self.patch_size, x_p:x_p+self.patch_size]
        patch_tgt = img_target[y_p:y_p+self.patch_size, x_p:x_p+self.patch_size]
        gray_ref = cv2.cvtColor(patch_ref, cv2.COLOR_BGR2GRAY).astype(np.float32)
        gray_tgt = cv2.cvtColor(patch_tgt, cv2.COLOR_BGR2GRAY).astype(np.float32)
        final_warp = start_matrix.copy()
        try:
            _, final_warp = cv2.findTransformECC(gray_ref, gray_tgt, final_warp, cv2.MOTION_AFFINE, (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 150, 1e-6))
            final_warp = self._normalize_to_similarity(final_warp)
        except:
            pass
        return self._refine_global_ecc(img_ref, img_target, final_warp)

    def align(self, img_ref, img_target):
        if img_ref is None or img_target is None:
            raise ValueError("give me images to align!")
        if img_ref.shape[:2] != img_target.shape[:2]:
            img_target = cv2.resize(img_target, (img_ref.shape[1], img_ref.shape[0]), interpolation=cv2.INTER_LINEAR)
        norm_ref = self.normalizer.normalize(img_ref)
        norm_tgt = self.normalizer.normalize(img_target)
        coarse_M = self._coarse_similarity_align(norm_ref, norm_tgt)
        _, final_M = self._align_images_patch_voting(norm_ref, norm_tgt, init_matrix=coarse_M)
        h, w = img_ref.shape[:2]
        aligned = cv2.warpAffine(img_target, final_M, (w, h), flags=cv2.INTER_LINEAR + cv2.WARP_INVERSE_MAP)
        return aligned

    def align_as(self, img_to_transform, moving_img, fixed_img):
        if img_to_transform is None or moving_img is None or fixed_img is None:
            raise ValueError("give me images!")
        h, w = fixed_img.shape[:2]
        if moving_img.shape[:2] != (h, w):
            moving_img = cv2.resize(moving_img, (w, h), interpolation=cv2.INTER_LINEAR)
        if img_to_transform.shape[:2] != (h, w):
            img_to_transform_resized = cv2.resize(img_to_transform, (w, h), interpolation=cv2.INTER_LINEAR)
        else:
            img_to_transform_resized = img_to_transform
        norm_fixed = self.normalizer.normalize(fixed_img)
        norm_moving = self.normalizer.normalize(moving_img)
        coarse_M = self._coarse_similarity_align(norm_fixed, norm_moving)
        _, final_M = self._align_images_patch_voting(norm_fixed, norm_moving, init_matrix=coarse_M)
        aligned = cv2.warpAffine(img_to_transform_resized, final_M, (w, h), flags=cv2.INTER_LINEAR + cv2.WARP_INVERSE_MAP)
        return aligned