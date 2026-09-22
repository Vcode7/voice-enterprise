import io
from typing import List
from PIL import Image
import pymupdf as fitz

from app.core.logger import logger
from app.config import settings


class PdfProcessor:
    """
    Service to convert PDF document bytes into high-resolution PIL Images.
    Uses PyMuPDF (fitz) for fast, standalone rendering without external system dependencies.
    """

    @staticmethod
    def convert_pdf_bytes_to_images(
        pdf_bytes: bytes,
        dpi: int = settings.PDF_DPI,
        max_pages: int = settings.MAX_PDF_PAGES,
    ) -> List[Image.Image]:
        """
        Converts PDF binary data into a list of PIL Images (one image per page).

        Args:
            pdf_bytes: Binary content of the PDF file.
            dpi: Dots per inch for rendering quality (default 200).
            max_pages: Maximum number of pages to process.

        Returns:
            List of PIL Image objects.
        """
        images: List[Image.Image] = []
        doc = None

        try:
            logger.info(f"Opening PDF document ({len(pdf_bytes)} bytes)...")
            try:
                fitz.TOOLS.mupdf_display_errors(False)
            except Exception:
                pass
            doc = fitz.open(stream=pdf_bytes, filetype="pdf")
            total_doc_pages = len(doc)
            pages_to_process = min(total_doc_pages, max_pages)

            logger.info(
                f"PDF contains {total_doc_pages} pages. Processing {pages_to_process} pages at {dpi} DPI..."
            )

            # Zoom factor calculated from default 72 DPI
            zoom = dpi / 72.0
            matrix = fitz.Matrix(zoom, zoom)

            for page_num in range(pages_to_process):
                page = doc.load_page(page_num)
                pix = page.get_pixmap(matrix=matrix, alpha=False)

                # Convert PyMuPDF pixmap to PIL Image
                img_data = pix.tobytes("png")
                img = Image.open(io.BytesIO(img_data)).convert("RGB")
                images.append(img)
                logger.debug(f"Rendered PDF page {page_num + 1}/{pages_to_process} ({img.width}x{img.height} px)")

            logger.info(f"Successfully converted {len(images)} PDF pages to images.")
            return images

        except Exception as e:
            logger.error(f"Failed to process PDF bytes: {str(e)}", exc_info=True)
            raise ValueError(f"Invalid or corrupted PDF document: {str(e)}")

        finally:
            if doc:
                try:
                    doc.close()
                except Exception:
                    pass
