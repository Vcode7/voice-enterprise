'use client';

export interface PdfPageImage {
  pageNumber: number;
  dataUrl: string;
  width: number;
  height: number;
}

const PDFJS_SCRIPT_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const PDFJS_WORKER_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

let pdfJsPromise: Promise<any> | null = null;

function loadPdfJsScript(): Promise<any> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('PDF.js can only be loaded in the browser.'));
  }

  if ((window as any).pdfjsLib) {
    return Promise.resolve((window as any).pdfjsLib);
  }

  if (pdfJsPromise) {
    return pdfJsPromise;
  }

  pdfJsPromise = new Promise((resolve, reject) => {
    const existingScript = document.querySelector(`script[src="${PDFJS_SCRIPT_URL}"]`);
    if (existingScript) {
      existingScript.addEventListener('load', () => resolve((window as any).pdfjsLib));
      existingScript.addEventListener('error', () => reject(new Error('Failed to load PDF.js')));
      return;
    }

    const script = document.createElement('script');
    script.src = PDFJS_SCRIPT_URL;
    script.async = true;
    script.onload = () => {
      const pdfjs = (window as any).pdfjsLib;
      if (pdfjs) {
        pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
        resolve(pdfjs);
      } else {
        reject(new Error('PDF.js library failed to initialize.'));
      }
    };
    script.onerror = () => reject(new Error('Failed to load PDF.js script from CDN.'));
    document.head.appendChild(script);
  });

  return pdfJsPromise;
}

/**
 * Convert an uploaded PDF File into an array of rendered high-resolution PNG Data URLs.
 * Renders each page on a browser canvas.
 */
export async function convertPdfToImages(
  file: File,
  maxPages: number = 20,
  scale: number = 2.0
): Promise<PdfPageImage[]> {
  try {
    const pdfjsLib = await loadPdfJsScript();
    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) });
    const pdf = await loadingTask.promise;

    const totalPages = Math.min(pdf.numPages, maxPages);
    const pages: PdfPageImage[] = [];

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      canvas.width = viewport.width;
      canvas.height = viewport.height;

      if (!context) continue;

      const renderContext = {
        canvasContext: context,
        viewport: viewport,
      };

      await page.render(renderContext).promise;
      const dataUrl = canvas.toDataURL('image/png');

      pages.push({
        pageNumber: pageNum,
        dataUrl,
        width: viewport.width,
        height: viewport.height,
      });
    }

    return pages;
  } catch (error) {
    console.error('Failed to render PDF pages:', error);
    throw new Error('Could not parse PDF pages. Please ensure the file is a valid PDF document.');
  }
}
