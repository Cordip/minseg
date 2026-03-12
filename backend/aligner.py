"""
Image Aligner Module
Aligns images using feature matching and homography transformation
"""
import cv2
import numpy as np
from typing import Tuple, Optional


class Aligner:
    """
    Aligns images using ORB feature detection and homography transformation.
    Used for aligning polarized light microscopy images.
    """
    
    def __init__(self, max_features: int = 5000, good_match_percent: float = 0.15):
        """
        Initialize the Aligner.
        
        Args:
            max_features: Maximum number of ORB features to detect
            good_match_percent: Percentage of good matches to use for homography
        """
        self.max_features = max_features
        self.good_match_percent = good_match_percent
        self.orb = cv2.ORB_create(max_features)
        self.matcher = cv2.DescriptorMatcher_create(cv2.DESCRIPTOR_MATCHER_BRUTEFORCE_HAMMING)
        self.last_homography: Optional[np.ndarray] = None
        
    def align(self, reference_img: np.ndarray, target_img: np.ndarray) -> np.ndarray:
        """
        Align target_img to reference_img using feature matching.
        
        Args:
            reference_img: Reference image (BGR format)
            target_img: Image to align (BGR format)
            
        Returns:
            Aligned image with same dimensions as reference
        """
        # Convert to grayscale for feature detection
        ref_gray = cv2.cvtColor(reference_img, cv2.COLOR_BGR2GRAY)
        target_gray = cv2.cvtColor(target_img, cv2.COLOR_BGR2GRAY)
        
        # Detect ORB features
        keypoints1, descriptors1 = self.orb.detectAndCompute(target_gray, None)
        keypoints2, descriptors2 = self.orb.detectAndCompute(ref_gray, None)
        
        if descriptors1 is None or descriptors2 is None:
            print("Warning: Could not find features for alignment, returning original")
            return target_img
        
        if len(descriptors1) < 2 or len(descriptors2) < 2:
            print("Warning: Not enough features for alignment, returning original")
            return target_img
        
        # Match features
        matches = list(self.matcher.match(descriptors1, descriptors2, None))
        
        if len(matches) < 4:
            print("Warning: Not enough matches for homography, returning original")
            return target_img
        
        # Sort matches by score and keep top matches
        matches.sort(key=lambda x: x.distance, reverse=False)
        num_good_matches = int(len(matches) * self.good_match_percent)
        num_good_matches = max(num_good_matches, 4)  # Need at least 4 for homography
        matches = matches[:num_good_matches]
        
        # Extract location of good matches
        points1 = np.zeros((len(matches), 2), dtype=np.float32)
        points2 = np.zeros((len(matches), 2), dtype=np.float32)
        
        for i, match in enumerate(matches):
            points1[i, :] = keypoints1[match.queryIdx].pt
            points2[i, :] = keypoints2[match.trainIdx].pt
        
        # Find homography matrix
        h, mask = cv2.findHomography(points1, points2, cv2.RANSAC)
        
        if h is None:
            print("Warning: Could not compute homography, returning original")
            return target_img
        
        self.last_homography = h
        
        # Warp image
        height, width = reference_img.shape[:2]
        aligned = cv2.warpPerspective(target_img, h, (width, height))
        
        return aligned
    
    def align_as(self, target_img: np.ndarray, reference_for_target: np.ndarray, 
                 final_reference: np.ndarray) -> np.ndarray:
        """
        Align target_img to final_reference using a two-step alignment.
        First aligns target to reference_for_target, then to final_reference.
        
        This is useful when you have:
        - img_xpl90 that needs to be aligned to img_ppl90
        - But img_ppl90 needs to be aligned to img_ppl45
        - So you want img_xpl90 aligned to img_ppl45 in the end
        
        Args:
            target_img: Image to align (e.g., xpl_90)
            reference_for_target: Reference for target (e.g., ppl_90)
            final_reference: Final reference image (e.g., ppl_45)
            
        Returns:
            Aligned image
        """
        # First align target to its direct reference
        aligned_to_direct = self.align(reference_for_target, target_img)
        
        # Then align to final reference (using the homography from reference_for_target to final_reference)
        ref_gray = cv2.cvtColor(final_reference, cv2.COLOR_BGR2GRAY)
        target_gray = cv2.cvtColor(reference_for_target, cv2.COLOR_BGR2GRAY)
        
        keypoints1, descriptors1 = self.orb.detectAndCompute(target_gray, None)
        keypoints2, descriptors2 = self.orb.detectAndCompute(ref_gray, None)
        
        if descriptors1 is None or descriptors2 is None or len(descriptors1) < 2 or len(descriptors2) < 2:
            return aligned_to_direct
        
        matches = list(self.matcher.match(descriptors1, descriptors2, None))
        
        if len(matches) < 4:
            return aligned_to_direct
        
        matches.sort(key=lambda x: x.distance, reverse=False)
        num_good_matches = max(int(len(matches) * self.good_match_percent), 4)
        matches = matches[:num_good_matches]
        
        points1 = np.zeros((len(matches), 2), dtype=np.float32)
        points2 = np.zeros((len(matches), 2), dtype=np.float32)
        
        for i, match in enumerate(matches):
            points1[i, :] = keypoints1[match.queryIdx].pt
            points2[i, :] = keypoints2[match.trainIdx].pt
        
        h, mask = cv2.findHomography(points1, points2, cv2.RANSAC)
        
        if h is None:
            return aligned_to_direct
        
        # Apply both transformations
        height, width = final_reference.shape[:2]
        result = cv2.warpPerspective(aligned_to_direct, h, (width, height))
        
        return result
    
    def get_homography(self) -> Optional[np.ndarray]:
        """Return the last computed homography matrix."""
        return self.last_homography
