import sys
import os
import io
import json
import base64
import argparse

def convert_pdf_to_images(file_bytes, max_pages=30, dpi=150):
    images = []
    try:
        import pymupdf as fitz
        try:
            fitz.TOOLS.mupdf_display_errors(False)
        except Exception:
            pass
        doc = fitz.open(stream=file_bytes, filetype="pdf")
        total_pages = len(doc)
        pages_to_process = min(total_pages, max_pages)
        zoom = dpi / 72.0
        matrix = fitz.Matrix(zoom, zoom)

        for i in range(pages_to_process):
            page = doc[i]
            pix = page.get_pixmap(matrix=matrix, alpha=False)
            img_bytes = pix.tobytes("png")
            b64_str = base64.b64encode(img_bytes).decode('ascii')
            images.append({
                "pageNumber": i + 1,
                "label": f"Page {i + 1} of {total_pages}",
                "image_base64": b64_str
            })
    except Exception as e:
        sys.stderr.write(f"[DocumentImageConverter] PDF conversion error: {e}\n")
    return images

def convert_excel_to_images(file_bytes, filename=""):
    images = []
    try:
        import pandas as pd
        import matplotlib
        matplotlib.use('Agg')
        import matplotlib.pyplot as plt

        excel_file = io.BytesIO(file_bytes)
        # Read all sheets
        xls = pd.ExcelFile(excel_file)
        sheet_names = xls.sheet_names

        for idx, sheet_name in enumerate(sheet_names):
            df = pd.read_excel(xls, sheet_name=sheet_name)
            if df.empty:
                continue

            # Limit preview rows if massive sheet
            max_rows = 50
            if len(df) > max_rows:
                df_to_render = df.iloc[:max_rows]
            else:
                df_to_render = df

            # Render dataframe table to image
            num_cols = max(len(df.columns), 3)
            num_rows = min(len(df_to_render) + 1, 55)
            fig_width = min(max(num_cols * 1.5, 8.0), 20.0)
            fig_height = min(max(num_rows * 0.35, 3.0), 25.0)

            fig, ax = plt.subplots(figsize=(fig_width, fig_height))
            ax.axis('tight')
            ax.axis('off')

            cell_text = df_to_render.fillna('').astype(str).values
            col_labels = [str(c) for c in df.columns]

            table = ax.table(cellText=cell_text, colLabels=col_labels, loc='center')
            table.auto_set_font_size(False)
            table.set_fontsize(10)
            table.scale(1.2, 1.2)

            buf = io.BytesIO()
            plt.savefig(buf, format='png', bbox_inches='tight', dpi=150)
            plt.close(fig)

            b64_str = base64.b64encode(buf.getvalue()).decode('ascii')
            images.append({
                "pageNumber": idx + 1,
                "label": f"Sheet: {sheet_name}",
                "image_base64": b64_str
            })
    except Exception as e:
        sys.stderr.write(f"[DocumentImageConverter] Excel conversion error: {e}\n")
    return images

def convert_image_to_images(file_bytes):
    images = []
    try:
        from PIL import Image, ImageSequence
        img = Image.open(io.BytesIO(file_bytes))
        
        frames = []
        try:
            for frame in ImageSequence.Iterator(img):
                frames.append(frame.copy())
        except Exception:
            frames = [img]

        for i, frame in enumerate(frames):
            rgb_frame = frame.convert('RGB')
            buf = io.BytesIO()
            rgb_frame.save(buf, format='PNG')
            b64_str = base64.b64encode(buf.getvalue()).decode('ascii')
            images.append({
                "pageNumber": i + 1,
                "label": f"Image Frame {i + 1}" if len(frames) > 1 else "Document Image",
                "image_base64": b64_str
            })
    except Exception as e:
        sys.stderr.write(f"[DocumentImageConverter] Image conversion error: {e}\n")
    return images

def main():
    parser = argparse.ArgumentParser(description="Convert any document/sheet/page into standardized image(s)")
    parser.add_argument("--input", type=str, help="Path to input document file")
    parser.add_argument("--filename", type=str, default="", help="Original filename to infer format")
    args = parser.parse_args()

    if args.input and os.path.exists(args.input):
        with open(args.input, "rb") as f:
            file_bytes = f.read()
        name = args.filename or os.path.basename(args.input)
    else:
        file_bytes = sys.stdin.buffer.read()
        name = args.filename or "document.bin"

    lower_name = name.lower()
    is_pdf = lower_name.endswith('.pdf') or file_bytes[:5] == b'%PDF-'
    is_excel = lower_name.endswith(('.xlsx', '.xls', '.xlsm', '.csv'))

    results = []
    if is_pdf:
        results = convert_pdf_to_images(file_bytes)
    elif is_excel:
        results = convert_excel_to_images(file_bytes, filename=name)
    else:
        results = convert_image_to_images(file_bytes)

    # Fallback if specific converter yielded empty
    if not results:
        results = convert_image_to_images(file_bytes)

    output_data = {
        "success": len(results) > 0,
        "filename": name,
        "totalPages": len(results),
        "pages": results
    }

    # Print markers around JSON to prevent any log pollution
    sys.stdout.write("\n__DOC_IMAGES_JSON_START__\n")
    sys.stdout.write(json.dumps(output_data))
    sys.stdout.write("\n__DOC_IMAGES_JSON_END__\n")
    sys.stdout.flush()

if __name__ == "__main__":
    main()
