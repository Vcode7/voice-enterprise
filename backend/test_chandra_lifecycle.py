import sys
import os
import time
from PIL import Image, ImageDraw, ImageFont
import torch

# Ensure backend root is in sys.path
sys.path.insert(0, os.path.abspath(os.path.dirname(__file__)))

from app.services.chandra_engine import get_chandra_engine
from app.models.schemas import HandwritingScanningTemplate, HandwritingFieldConfig, HandwritingTableColumnConfig

def create_synthetic_test_image() -> Image.Image:
    """Creates a simple synthetic plant sheet image with printed and handwritten text."""
    img = Image.new("RGB", (800, 600), color=(250, 250, 248))
    draw = ImageDraw.Draw(img)
    
    # Title
    draw.text((30, 30), "PLANT SHIFT PRODUCTION REPORT", fill=(20, 20, 20))
    draw.text((30, 70), "Date: 2026-09-08", fill=(30, 30, 30))
    draw.text((30, 100), "Shift: Morning Shift A", fill=(10, 10, 80))
    draw.text((30, 130), "Supervisor: John Doe", fill=(10, 10, 80))
    
    # Table header
    draw.line([(30, 170), (770, 170)], fill=(100, 100, 100), width=2)
    draw.text((35, 180), "Part No", fill=(0, 0, 0))
    draw.text((200, 180), "Qty Produced", fill=(0, 0, 0))
    draw.text((400, 180), "Status", fill=(0, 0, 0))
    draw.line([(30, 210), (770, 210)], fill=(100, 100, 100), width=1)
    
    # Row 1
    draw.text((35, 220), "PRT-9001", fill=(20, 20, 100))
    draw.text((200, 220), "150", fill=(20, 20, 100))
    draw.text((400, 220), "Pass", fill=(20, 20, 100))
    
    # Row 2
    draw.text((35, 250), "PRT-9002", fill=(20, 20, 100))
    draw.text((200, 250), "75", fill=(20, 20, 100))
    draw.text((400, 250), "Rework", fill=(20, 20, 100))
    
    draw.line([(30, 280), (770, 280)], fill=(100, 100, 100), width=1)
    return img

def main():
    print("=== Testing Chandra 2 Lifecycle & VRAM Cleanup ===")
    vram_init = get_chandra_engine().get_vram_info()
    print(f"1. Initial VRAM: Allocated={vram_init['allocated_mb']} MB, Reserved={vram_init['reserved_mb']} MB")
    
    engine = get_chandra_engine()
    print("2. Loading Chandra 2 (4-bit)...")
    engine.load_model()
    
    vram_loaded = engine.get_vram_info()
    print(f"3. Loaded VRAM: Allocated={vram_loaded['allocated_mb']} MB, Reserved={vram_loaded['reserved_mb']} MB")
    
    test_template = HandwritingScanningTemplate(
        id="test_tmpl",
        name="Plant Production Template",
        fields=[
            HandwritingFieldConfig(field_name="Date"),
            HandwritingFieldConfig(field_name="Shift"),
            HandwritingFieldConfig(field_name="Supervisor"),
        ],
        table_columns=[
            HandwritingTableColumnConfig(column_name="Part No"),
            HandwritingTableColumnConfig(column_name="Qty Produced"),
            HandwritingTableColumnConfig(column_name="Status"),
        ]
    )
    
    test_img = create_synthetic_test_image()
    print("4. Running Full Image Structured Extraction...")
    res = engine.extract_full_image(test_img, template=test_template)
    print(f"   Success: {res.success}")
    print(f"   Processing Time: {res.processing_time_ms} ms")
    print(f"   Field Values: {res.field_values}")
    print(f"   Table Rows: {res.table_rows}")
    print(f"   Structured Text Preview:\n{res.structured_text[:200]}...")
    
    print("\n5. Testing Detected Region Crop Inference...")
    crop = test_img.crop((30, 95, 250, 125)) # "Shift: Morning Shift A"
    crop_res = engine.infer_crop_batch([crop], field_labels=["Shift"])
    print(f"   Crop Result: {crop_res}")
    
    print("\n6. Unloading Chandra 2 and releasing VRAM...")
    engine.unload_model()
    
    vram_unloaded = engine.get_vram_info()
    print(f"7. Final Unloaded VRAM: Allocated={vram_unloaded['allocated_mb']} MB, Reserved={vram_unloaded['reserved_mb']} MB")
    
    diff = vram_unloaded["allocated_mb"] - vram_init["allocated_mb"]
    print(f"8. VRAM Delta vs Initial: {diff:.1f} MB")
    if diff <= 50.0:
        print(">>> SUCCESS: Model unloaded cleanly, VRAM returned to baseline! <<<")
    else:
        print(f">>> WARNING: Residual VRAM detected: {diff} MB <<<")

if __name__ == "__main__":
    main()
