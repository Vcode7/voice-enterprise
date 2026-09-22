import re
import json
import ast
from typing import Any, Optional, Dict, Union


def extract_first_json_object(text: str) -> Optional[str]:
    start_idx = text.find("{")
    if start_idx == -1:
        return None

    depth = 0
    in_string = False
    is_escaped = False

    for i in range(start_idx, len(text)):
        char = text[i]

        if is_escaped:
            is_escaped = False
            continue

        if char == "\\":
            is_escaped = True
            continue

        if char == '"':
            in_string = not in_string
            continue

        if not in_string:
            if char == "{":
                depth += 1
            elif char == "}":
                depth -= 1
                if depth == 0:
                    return text[start_idx : i + 1]

    return None


def extract_first_json_array(text: str) -> Optional[str]:
    start_idx = text.find("[")
    if start_idx == -1:
        return None

    depth = 0
    in_string = False
    is_escaped = False

    for i in range(start_idx, len(text)):
        char = text[i]

        if is_escaped:
            is_escaped = False
            continue

        if char == "\\":
            is_escaped = True
            continue

        if char == '"':
            in_string = not in_string
            continue

        if not in_string:
            if char == "[":
                depth += 1
            elif char == "]":
                depth -= 1
                if depth == 0:
                    return text[start_idx : i + 1]

    return None


def sanitize_json_string(s: str) -> str:
    cleaned = s.strip()
    # Strip markdown code blocks if wrapped
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s*```$", "", cleaned, flags=re.IGNORECASE)
    # Strip single-line comments // ...
    cleaned = re.sub(r"//[^\n\r]*", "", cleaned)
    # Strip multi-line comments /* ... */
    cleaned = re.sub(r"/\*[\s\S]*?\*/", "", cleaned)
    # Replace Python literals with valid JSON literals
    cleaned = re.sub(r"\bTrue\b", "true", cleaned)
    cleaned = re.sub(r"\bFalse\b", "false", cleaned)
    cleaned = re.sub(r"\bNone\b", "null", cleaned)
    # Fix invalid escape sequences (e.g. \a, \P, \., etc. that are not valid in JSON)
    cleaned = re.sub(r'\\(?!["\\/bfnrtu]|u[0-9a-fA-F]{4})', r'\\\\', cleaned)
    # Remove trailing commas before } or ]
    cleaned = re.sub(r",\s*([}\]])", r"\1", cleaned)
    return cleaned


def repair_truncated_json(s: str) -> str:
    cleaned = s.strip()
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s*```$", "", cleaned, flags=re.IGNORECASE)

    first_brace = cleaned.find("{")
    first_bracket = cleaned.find("[")
    start_idx = 0
    if first_brace != -1 and first_bracket != -1:
        start_idx = min(first_brace, first_bracket)
    elif first_brace != -1:
        start_idx = first_brace
    elif first_bracket != -1:
        start_idx = first_bracket

    cleaned = cleaned[start_idx:]

    in_string = False
    is_escaped = False
    stack = []

    for char in cleaned:
        if is_escaped:
            is_escaped = False
            continue
        if char == "\\":
            is_escaped = True
            continue
        if char == '"':
            in_string = not in_string
            continue
        if not in_string:
            if char in ("{", "["):
                stack.append(char)
            elif char == "}":
                if stack and stack[-1] == "{":
                    stack.pop()
            elif char == "]":
                if stack and stack[-1] == "[":
                    stack.pop()

    if in_string:
        cleaned += '"'

    # Remove incomplete key-value pairs at the end (e.g. , "key": or , "key" or trailing commas)
    cleaned = re.sub(r",\s*$", "", cleaned)
    cleaned = re.sub(r",\s*(\"[^\"]*\"\s*:\s*[^,}\]]*)$", "", cleaned)
    cleaned = re.sub(r",\s*(\"[^\"]*\"\s*:\s*)?$", "", cleaned)
    cleaned = re.sub(r":\s*$", '""', cleaned)

    while stack:
        open_c = stack.pop()
        cleaned = re.sub(r",\s*$", "", cleaned)
        if open_c == "{":
            cleaned += "}"
        elif open_c == "[":
            cleaned += "]"

    return sanitize_json_string(cleaned)


def clean_and_parse_json(text: str) -> Any:
    if not text or not isinstance(text, str):
        raise ValueError("Empty text provided for JSON parsing.")

    raw = text.strip()

    def try_loads(s: str) -> Optional[Any]:
        if not s or not s.strip():
            return None
        # 1. Standard json.loads
        try:
            return json.loads(s)
        except Exception:
            pass
        # 2. Relaxed control character check (strict=False)
        try:
            return json.loads(s, strict=False)
        except Exception:
            pass
        # 3. Sanitized with strict=False
        try:
            sanitized = sanitize_json_string(s)
            return json.loads(sanitized, strict=False)
        except Exception:
            pass
        # 4. Try ast.literal_eval for python-style dicts
        try:
            val = ast.literal_eval(s)
            if isinstance(val, (dict, list)):
                return val
        except Exception:
            pass
        return None

    # 1. Match code fences
    code_block_regex = r"```(?:json)?\s*([\s\S]*?)\s*```"
    matches = re.findall(code_block_regex, raw, flags=re.IGNORECASE)
    for block in matches:
        content = block.strip()
        extracted = extract_first_json_object(content) or extract_first_json_array(content) or content
        res = try_loads(extracted)
        if res is not None:
            return res

    # 2. Extract first matching balanced JSON object or array
    extracted_obj = extract_first_json_object(raw) or extract_first_json_array(raw)
    if extracted_obj:
        res = try_loads(extracted_obj)
        if res is not None:
            return res

    # 3. Direct slice between first { and last } or first [ and last ]
    cleaned = sanitize_json_string(raw)
    first_b = cleaned.find("{")
    last_b = cleaned.rfind("}")
    if first_b != -1 and last_b != -1 and last_b > first_b:
        res = try_loads(cleaned[first_b : last_b + 1])
        if res is not None:
            return res

    first_sq = cleaned.find("[")
    last_sq = cleaned.rfind("]")
    if first_sq != -1 and last_sq != -1 and last_sq > first_sq:
        res = try_loads(cleaned[first_sq : last_sq + 1])
        if res is not None:
            return res

    # 4. Attempt repair of truncated JSON
    try:
        repaired = repair_truncated_json(raw)
        res = try_loads(repaired)
        if res is not None:
            return res
    except Exception:
        pass

    # 5. Fallback: regex extraction of fieldValues if present
    fallback_dict = {}
    fv_match = re.search(r'"fieldValues"\s*:\s*\{([^}]+)\}', raw)
    if fv_match:
        fv_content = fv_match.group(1)
        kvs = re.findall(r'"([^"]+)"\s*:\s*"([^"]*)"', fv_content)
        if kvs:
            fallback_dict["fieldValues"] = {k: v for k, v in kvs}

    if fallback_dict:
        return fallback_dict

    raise ValueError(f"Could not parse valid JSON from LLM response ({len(raw)} chars)")


def normalize_numeric_field_value(val: Any) -> str:
    if val is None:
        return ""
    if isinstance(val, (int, float)):
        return str(val)

    s = str(val).strip()
    if not s:
        return ""

    lower = re.sub(r"[\s_\-–—]+", "", s.lower())
    if lower in ("unknown", "na", "n/a", "notavailable", "none", "null", "nil", "-", "--", "?", "empty", "undefined"):
        return ""

    if ":" in s:
        after_colon = s.split(":")[-1].strip()
        if re.search(r"\d", after_colon):
            s = after_colon

    s = re.sub(r"^[\"'(\[{;:\s]+|[\"')\]};:\s]+$", "", s)
    dot_count = s.count(".")
    s = re.sub(r"[.,:;_\-\s]+$", "", s).strip()

    if not re.search(r"\d", s):
        return ""

    s = re.sub(r"(\d)\s*,\s*(\d)", r"\1\2", s)

    if "+" in s:
        parts = [p.strip() for p in s.split("+")]
        if len(parts) >= 2 and all(re.match(r"^\d+(?:\.\d+)?$", p) for p in parts):
            total = sum(float(p) for p in parts)
            return str(int(total)) if total.is_integer() else str(round(total, 4))

    if dot_count > 1:
        is_neg = s.startswith("-")
        digits = re.sub(r"[^\d]", "", s)
        return f"-{digits}" if is_neg else digits

    if dot_count == 1:
        idx = s.find(".")
        before = re.sub(r"[^\d+-]", "", s[:idx])
        after = re.sub(r"[^\d]", "", s[idx + 1 :])
        if after:
            clean_int = before if before else "0"
            return f"{clean_int}.{after}"
        else:
            digits = re.sub(r"[^\d]", "", s)
            is_neg = s.startswith("-")
            return f"-{digits}" if is_neg else digits

    is_neg = s.startswith("-")
    digits = re.sub(r"[^\d]", "", s)
    return f"-{digits}" if is_neg else digits
