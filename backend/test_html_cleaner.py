"""
Unit Test: HTML Cleaner for Frontend Presentation
Verifies:
1. Stripping of all HTML tags (<div data-bbox="...">, <table>, <tr>, <td>, etc.)
2. Preservation of table structures in readable ASCII format (col1 | col2 | col3)
3. Handling of plain text without HTML
4. Edge cases (empty strings, None, malformed tags)
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from app.utils.html_cleaner import clean_html_to_text, is_html_content


def test_html_cleaner():
    print("=" * 60)
    print("RUNNING TEST: HTML Cleaner Utility")
    print("=" * 60)

    # 1. Detection
    assert is_html_content("<div data-bbox='[10, 10, 100, 50]'>Hello</div>") is True
    assert is_html_content("Plain text without any html") is False
    assert is_html_content("") is False
    assert is_html_content(None) is False
    print("[PASS] HTML detection verified.")

    # 2. Rich Chandra HTML layout with data-bbox, classes, and tables
    sample_html = """
    <div data-bbox="[10, 20, 400, 60]" class="doc-title">PLANT PRODUCTION MONITORING SHEET</div>
    <div data-bbox="[10, 70, 200, 95]">Date: 2026-09-09</div>
    <div data-bbox="[220, 70, 400, 95]">Shift: A</div>
    <table>
      <thead>
        <tr><th>Start Time</th><th>End Time</th><th>Qty</th></tr>
      </thead>
      <tbody>
        <tr><td>08:00</td><td>09:00</td><td>150</td></tr>
        <tr><td>09:00</td><td>10:00</td><td>145</td></tr>
      </tbody>
    </table>
    """.strip()

    cleaned = clean_html_to_text(sample_html)
    print("[Cleaned Output Preview]:")
    print(cleaned)

    # Verifications
    assert "<div" not in cleaned, "Found <div in cleaned output"
    assert "data-bbox" not in cleaned, "Found data-bbox in cleaned output"
    assert "<table" not in cleaned, "Found <table in cleaned output"
    assert "<tr>" not in cleaned, "Found <tr> in cleaned output"
    assert "<td>" not in cleaned, "Found <td> in cleaned output"
    assert "PLANT PRODUCTION MONITORING SHEET" in cleaned
    assert "Date: 2026-09-09" in cleaned
    assert "Shift: A" in cleaned
    assert "Start Time | End Time | Qty" in cleaned
    assert "08:00 | 09:00 | 150" in cleaned
    assert "09:00 | 10:00 | 145" in cleaned
    print("[PASS] Complete Chandra HTML cleaned with tabular formatting preserved.")

    # 3. Plain text pass-through
    plain = "Just normal plain text\nLine 2\nLine 3"
    assert clean_html_to_text(plain) == plain
    print("[PASS] Plain text pass-through verified.")

    # 4. Empty and None handling
    assert clean_html_to_text("") == ""
    assert clean_html_to_text("   ") == ""
    assert clean_html_to_text(None) == ""
    print("[PASS] Empty and None inputs handled safely.")

    print("=" * 60)
    print("ALL HTML CLEANER TESTS PASSED!")
    print("=" * 60)


if __name__ == "__main__":
    test_html_cleaner()
