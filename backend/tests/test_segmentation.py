import cv2
import numpy as np
import pytest
from segmentation import denoise, zhang_suen_thinning, process_mask, segmentation, full_segmentation


class TestDenoise:
    def test_returns_same_shape(self):
        img = np.random.randint(0, 255, (64, 64, 3), dtype=np.uint8)
        result = denoise(img)
        assert result.shape == img.shape
        assert result.dtype == np.uint8

    def test_smooth_image_unchanged(self):
        """A solid color image should remain roughly the same after denoising."""
        img = np.ones((64, 64, 3), dtype=np.uint8) * 128
        result = denoise(img)
        assert np.allclose(result, img, atol=5)


class TestZhangSuenThinning:
    def test_binary_output(self):
        img = np.zeros((64, 64), dtype=np.uint8)
        img[20:40, 28:36] = 255  # thick vertical line
        result = zhang_suen_thinning(img)
        assert result.dtype == np.uint8
        assert set(np.unique(result)).issubset({0, 1})

    def test_float_input(self):
        img = np.zeros((64, 64), dtype=np.float64)
        img[20:40, 28:36] = 1.0
        result = zhang_suen_thinning(img)
        assert result.dtype == np.uint8

    def test_thin_line_preserved(self):
        """A single-pixel line should remain after thinning."""
        img = np.zeros((64, 64), dtype=np.uint8)
        img[32, 10:50] = 255
        result = zhang_suen_thinning(img)
        assert np.any(result > 0)


class TestProcessMask:
    def test_returns_three_arrays(self):
        mask = np.zeros((64, 64, 3), dtype=np.uint8)
        mask[10:20, 10:20] = 255
        mask[40:55, 40:55] = 255
        colored, edges, labels = process_mask(mask, pixels=3)
        assert colored.shape == (64, 64, 3)
        assert edges.shape == (64, 64, 3)
        assert labels.shape == (64, 64)

    def test_empty_mask(self):
        """Black mask should produce empty labels."""
        mask = np.zeros((64, 64, 3), dtype=np.uint8)
        colored, edges, labels = process_mask(mask, pixels=3)
        assert colored.shape == (64, 64, 3)
        assert labels.shape == (64, 64)

    def test_float_input(self):
        mask = np.zeros((64, 64, 3), dtype=np.float32)
        mask[10:20, 10:20] = 0.8
        colored, edges, labels = process_mask(mask, pixels=3)
        assert colored.dtype == np.uint8

    def test_grayscale_input(self):
        mask = np.zeros((64, 64), dtype=np.uint8)
        mask[10:30, 10:30] = 255
        mask[40:60, 40:60] = 255
        colored, edges, labels = process_mask(mask, pixels=3)
        assert colored.shape[:2] == (64, 64)


class TestSegmentation:
    def test_returns_boundary_overlay(self):
        img = np.random.randint(50, 200, (64, 64, 3), dtype=np.uint8)
        # Make distinct regions
        img[:32, :32] = [200, 50, 50]
        img[:32, 32:] = [50, 200, 50]
        img[32:, :32] = [50, 50, 200]
        img[32:, 32:] = [200, 200, 50]
        result = segmentation(img, thresh=20.0)
        assert result.shape == img.shape
        assert result.dtype == np.float32


class TestFullSegmentation:
    def test_returns_three_arrays(self):
        img1 = np.random.randint(50, 200, (64, 64, 3), dtype=np.uint8)
        img1[:32, :32] = [200, 50, 50]
        img1[32:, 32:] = [50, 50, 200]
        img2 = img1.copy()
        colored, edges, labels = full_segmentation(img1, img2, thresh=20.0)
        assert colored.shape[:2] == (64, 64)
        assert edges.shape[:2] == (64, 64)
        assert labels.shape == (64, 64)
        assert labels.dtype == np.int32
