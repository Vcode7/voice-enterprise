"""
HTML Text Cleaner Utility for Voice ERP Chandra OCR Pipeline.
Extracts clean, human-readable plain text from raw Chandra HTML layout OCR outputs,
ensuring table structures are preserved in readable ASCII format and all HTML tags
(such as <div data-bbox="..." data-label="...">, <table>, <tr>, etc.) are stripped.
"""
import re
from typing import Optional
from bs4 import BeautifulSoup, NavigableString, Tag


def is_html_content(text: Optional[str]) -> bool:
    """Checks if a string contains HTML markup."""
    if not text or not isinstance(text, str):
        return False
    return bool(re.search(r"<[a-zA-Z][^>]*>", text))


def clean_html_to_text(raw_html: Optional[str]) -> str:
    """
    Transforms raw Chandra HTML output into clean, structured plain text for UI presentation.
    Never exposes raw HTML tags, data-bbox attributes, or styling artifacts to the frontend.
    """
    if not raw_html or not str(raw_html).strip():
        return ""

    content = str(raw_html).strip()

    # Fast path: if no HTML tags detected, return cleaned text directly
    if not is_html_content(content):
        return content

    try:
        soup = BeautifulSoup(content, "html.parser")

        # Remove script and style elements if any
        for tag in soup(["script", "style", "meta", "link"]):
            tag.decompose()

        lines = []

        # Process top-level block elements or fallback to recursive walk
        body = soup.body if soup.body else soup

        def process_element(elem):
            if isinstance(elem, NavigableString):
                text = str(elem).strip()
                if text:
                    lines.append(text)
                return

            if not isinstance(elem, Tag):
                return

            tag_name = elem.name.lower()

            # Handle tables specially to format rows cleanly: col1 | col2 | col3
            if tag_name == "table":
                lines.append("")
                table_caption = elem.find("caption")
                if table_caption:
                    cap_text = table_caption.get_text(strip=True)
                    if cap_text:
                        lines.append(f"[{cap_text}]")

                rows = elem.find_all("tr")
                for row in rows:
                    cells = row.find_all(["th", "td"])
                    cell_texts = [c.get_text(strip=True) for c in cells]
                    if any(cell_texts):
                        lines.append(" | ".join(cell_texts))
                lines.append("")
                return

            # Headings
            if tag_name in ("h1", "h2", "h3", "h4", "h5", "h6"):
                head_text = elem.get_text(strip=True)
                if head_text:
                    lines.append(f"\n{head_text}\n")
                return

            # Divs, paragraphs, list items
            if tag_name in ("div", "p", "li", "section", "article"):
                # If element has a nested table, process children individually
                if elem.find("table"):
                    for child in elem.children:
                        process_element(child)
                else:
                    elem_text = elem.get_text(" ", strip=True)
                    if elem_text:
                        lines.append(elem_text)
                return

            # Generic fallback: recurse into children
            for child in elem.children:
                process_element(child)

        process_element(body)

        cleaned_text = "\n".join(lines)
        # Normalize redundant newlines
        cleaned_text = re.sub(r"\n{3,}", "\n\n", cleaned_text).strip()

        if cleaned_text:
            return cleaned_text

        # Ultimate fallback using get_text
        return soup.get_text(separator="\n", strip=True)

    except Exception:
        # Fallback regex tag stripper if BeautifulSoup encounter any parse issues
        text_only = re.sub(r"<[^>]+>", " ", content)
        text_only = re.sub(r"[ \t]+", " ", text_only)
        text_only = re.sub(r"\n\s*\n", "\n", text_only).strip()
        return text_only
