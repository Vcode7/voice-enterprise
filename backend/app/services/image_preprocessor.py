import time
from typing import List, Tuple, Dict, Any
import numpy as np
import cv2
from PIL import Image, ImageEnhance, ImageFilter

from app.core.logger import logger
from app.config import OcrConfigModel


class ImagePreprocessor:
    """
    Dedicated image preprocessing service for OCR:
    - Deskewing (angle correction)
    - Denoising & background artifact removal
    - Contrast enhancement (CLAHE in LAB color space)
    - Adaptive thresholding & binarization
    - Resolution upscaling (Lanczos4 / Bicubic)
    - Multi-variant generation for difficult handwriting crops
    """

    @staticmethod
    def deskew(img_np: np.ndarray) -> Tuple[np.ndarray, float]:
        """
        Detects and corrects document rotation/skew angle within [-45°, 45°].
        """
        try:
            gray = cv2.cvtColor(img_np, cv2.COLOR_RGB2GRAY) if len(img_np.shape) == 3 else img_np
            # Invert & threshold text
            thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)[1]

            # Find coordinates of all text pixels
            coords = np.column_stack(np.where(thresh > 0))
            if len(coords) < 50:
                return img_np, 0.0

            angle = cv2.minAreaRect(coords)[-1]
            if angle < -45:
                angle = -(90 + angle)
            elif angle > 45:
                angle = 90 - angle
            else:
                angle = -angle

            # Ignore minuscule angles
            if abs(angle) < 0.5 or abs(angle) > 40.0:
                return img_np, 0.0

            # Rotate image
            (h, w) = img_np.shape[:2]
            center = (w // 2, h // 2)
            M = cv2.getRotationMatrix2D(center, angle, 1.0)
            rotated = cv2.warpAffine(
                img_np, M, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE
            )
            return rotated, round(float(angle), 2)
        except Exception as e:
            logger.debug(f"Deskew error: {str(e)}")
            return img_np, 0.0

    @staticmethod
    def denoise(img_np: np.ndarray) -> np.ndarray:
        """
        Applies edge-preserving bilateral filtering to reduce noise while keeping character edges sharp.
        """
        try:
            if len(img_np.shape) == 3:
                return cv2.bilateralFilter(img_np, d=5, sigmaColor=50, sigmaSpace=50)
            else:
                return cv2.bilateralFilter(img_np, d=5, sigmaColor=50, sigmaSpace=50)
        except Exception as e:
            logger.debug(f"Denoise error: {str(e)}")
            return img_np

    @staticmethod
    def enhance_contrast(img_np: np.ndarray) -> np.ndarray:
        """
        Applies CLAHE (Contrast Limited Adaptive Histogram Equalization) in LAB space.
        """
        try:
            if len(img_np.shape) == 3:
                lab = cv2.cvtColor(img_np, cv2.COLOR_RGB2LAB)
                l, a, b = cv2.split(lab)
                clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))
                cl = clahe.apply(l)
                limg = cv2.merge((cl, a, b))
                return cv2.cvtColor(limg, cv2.COLOR_LAB2RGB)
            else:
                clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))
                return clahe.apply(img_np)
        except Exception as e:
            logger.debug(f"Contrast enhancement error: {str(e)}")
            return img_np

    @staticmethod
    def adaptive_threshold(img_np: np.ndarray) -> np.ndarray:
        """
        Converts image to clean high-contrast binary image using Gaussian adaptive thresholding.
        """
        try:
            gray = cv2.cvtColor(img_np, cv2.COLOR_RGB2GRAY) if len(img_np.shape) == 3 else img_np
            binary = cv2.adaptiveThreshold(
                gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 21, 11
            )
            return cv2.cvtColor(binary, cv2.COLOR_GRAY2RGB)
        except Exception as e:
            logger.debug(f"Adaptive threshold error: {str(e)}")
            return img_np

    @staticmethod
    def upscale(img_np: np.ndarray, factor: float = 1.5) -> np.ndarray:
        """
        Upscales image using high-quality Lanczos interpolation.
        """
        try:
            if factor <= 1.0 or factor > 4.0:
                return img_np
            return cv2.resize(img_np, None, fx=factor, fy=factor, interpolation=cv2.INTER_LANCZOS4)
        except Exception as e:
            logger.debug(f"Upscaling error: {str(e)}")
            return img_np

    @classmethod
    def preprocess_page(
        cls,
        image: Image.Image,
        config: OcrConfigModel,
    ) -> Tuple[Image.Image, Dict[str, Any]]:
        """
        Executes the enabled preprocessing steps on a full document page.

        Returns:
            Tuple of (preprocessed_pil_image, metadata_dict)
        """
        if not config.image_preprocessing:
            return image, {"preprocessing_applied": False}

        t0 = time.time()
        img_np = np.array(image.convert("RGB"))
        meta: Dict[str, Any] = {"preprocessing_applied": True, "steps": []}

        # 1. Deskew
        if config.enable_deskew:
            img_np, angle = cls.deskew(img_np)
            if abs(angle) > 0.0:
                meta["steps"].append(f"deskew ({angle}°)")
                logger.info(f"  [PREPROCESS] Deskewed document by {angle}°")

        # 2. Denoise
        if config.enable_denoise:
            img_np = cls.denoise(img_np)
            meta["steps"].append("denoise")

        # 3. Contrast Enhancement (CLAHE)
        if config.enable_contrast_enhance:
            img_np = cls.enhance_contrast(img_np)
            meta["steps"].append("contrast_enhance_clahe")

        # 4. Adaptive Thresholding
        if config.enable_adaptive_threshold:
            img_np = cls.adaptive_threshold(img_np)
            meta["steps"].append("adaptive_threshold")

        # 5. Upscaling
        if config.enable_upscaling and config.upscale_factor > 1.0:
            orig_h, orig_w = img_np.shape[:2]
            # Only upscale if image resolution is relatively low
            if orig_w < 2000 and orig_h < 2000:
                img_np = cls.upscale(img_np, config.upscale_factor)
                meta["steps"].append(f"upscale_{config.upscale_factor}x")
                logger.info(f"  [PREPROCESS] Upscaled document from {orig_w}x{orig_h} to {img_np.shape[1]}x{img_np.shape[0]} px")

        dur_ms = (time.time() - t0) * 1000.0
        meta["duration_ms"] = round(dur_ms, 2)
        logger.info(f"--- [PREPROCESSING COMPLETE] Applied {meta['steps']} in {dur_ms:.1f}ms ---")

        return Image.fromarray(img_np), meta

    @classmethod
    def generate_variants(cls, crop_image: Image.Image, count: int = 3) -> List[Image.Image]:
        """
        Generates distinct preprocessed representations of a text crop:
        Variant 1: Original RGB crop with CLAHE contrast boost
        Variant 2: Sharpened & binarized (Otsu)
        Variant 3: Adaptive Gaussian threshold with slight dilation
        Variant 4: Grayscale with high contrast + gamma enhancement
        """
        variants: List[Image.Image] = []
        crop_np = np.array(crop_image.convert("RGB"))

        # Variant 1: Enhanced contrast RGB
        try:
            v1_np = cls.enhance_contrast(crop_np)
            variants.append(Image.fromarray(v1_np))
        except Exception:
            variants.append(crop_image)

        if count <= 1:
            return variants

        # Variant 2: Sharpened + Otsu Binarized
        try:
            gray = cv2.cvtColor(crop_np, cv2.COLOR_RGB2GRAY)
            blurred = cv2.GaussianBlur(gray, (3, 3), 0)
            otsu = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1]
            v2 = Image.fromarray(cv2.cvtColor(otsu, cv2.COLOR_GRAY2RGB))
            variants.append(v2)
        except Exception:
            pass

        if count <= 2:
            return variants

        # Variant 3: Adaptive Threshold with stroke connection
        try:
            gray = cv2.cvtColor(crop_np, cv2.COLOR_RGB2GRAY)
            adapt = cv2.adaptiveThreshold(
                gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 15, 7
            )
            # Slight dilation to connect broken pen strokes
            kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2))
            dilated = cv2.erode(adapt, kernel, iterations=1)
            v3 = Image.fromarray(cv2.cvtColor(dilated, cv2.COLOR_GRAY2RGB))
            variants.append(v3)
        except Exception:
            pass

        if count <= 3:
            return variants

        # Variant 4: Contrast & Sharpness Boost via PIL
        try:
            enh = ImageEnhance.Contrast(crop_image).enhance(1.8)
            sharp = ImageEnhance.Sharpness(enh).enhance(2.0)
            variants.append(sharp)
        except Exception:
            pass

        return variants if variants else [crop_image]
