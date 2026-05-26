#!/usr/bin/env python3
"""
Document to Markdown Converter & Splitter v3.3
Converts PDF/DOCX/PPTX/XLSX/TXT to split markdown files.
Pure converter — no AI, no internet, deterministic.

================================================================================
USAGE EXAMPLES
================================================================================

# 1. Basic single-document conversion (one .md per detected section)
python convert_and_split_docs_to_md_v3_2.py -i "spec.pdf:MY_SPEC" -o docs/

# 2. Convert multiple documents in one run
python convert_and_split_docs_to_md_v3_2.py \
    -i "spec1.pdf:SPEC_A" \
    -i "spec2.pdf:SPEC_B" \
    -o docs/

# 3. Single combined .md file (preamble included inside that one file)
python convert_and_split_docs_to_md_v3_2.py -i "spec.pdf:MY_SPEC" -o docs/ \
    --num_of_md_files 1

# 4. Group all sections into N files (preamble becomes a separate 00_preamble.md)
#    Example: 41 sections with N=4  →  4 files of 11+10+10+10 sections
python convert_and_split_docs_to_md_v3_2.py -i "spec.pdf:MY_SPEC" -o docs/ \
    --num_of_md_files 4

# 5. Force re-conversion even if document is unchanged
python convert_and_split_docs_to_md_v3_2.py -i "spec.pdf:MY_SPEC" -o docs/ \
    --force

# 6. Multi-part conversion (split a huge PDF into halves yourself, then run twice)
#    This is the recommended workaround for large PDFs that exhaust memory.
#    Each --part runs as a fresh process, so memory is fully reclaimed between halves.
#
#    Step 1: Split your PDF externally into part1.pdf and part2.pdf
#    Step 2: Run part 1 (creates the directory fresh)
python convert_and_split_docs_to_md_v3_2.py \
    -i "PCIe_HAS_part1.pdf:PCIE_HAS" -o docs/ --part 1 --num_of_md_files 4
#    Step 3: Run part 2 (appends to the same directory, continues numbering)
python convert_and_split_docs_to_md_v3_2.py \
    -i "PCIe_HAS_part2.pdf:PCIE_HAS" -o docs/ --part 2 --num_of_md_files 4

# 7. Dry run to see what would be processed without converting
python convert_and_split_docs_to_md_v3_2.py -i "spec.pdf:MY_SPEC" -o docs/ --dry-run

# 8. Optional: extract text from images using pytesseract
python convert_and_split_docs_to_md_v3_2.py -i "spec.pdf:MY_SPEC" -o docs/ \
    --ocr-images

================================================================================
NOTES ON --num_of_md_files
================================================================================
  Not passed  → one .md file per detected section (default behavior)
  1           → single .md file containing the whole document (preamble inside)
  N >= 2      → N total .md files, sections distributed across them; preamble
                gets its own 00_preamble.md (NOT counted in N)
  0           → invalid, script will error out

================================================================================
NOTES ON --part
================================================================================
  Not passed  → equivalent to --part 1
  1           → fresh start. Deletes existing label directory if present.
  2 or higher → appends to existing label directory. Looks at highest existing
                file number and continues from there. Errors out if --part 1
                was never run for this label.

================================================================================
MEMORY NOTES (CPU mode)
================================================================================
  This script runs MinerU in CPU mode. Large PDFs (>100 pages) on systems with
  <16 GB RAM may fail with MemoryError. If that happens:
    1. Split the PDF externally into 2-3 parts (~50-100 pages each)
    2. Run with --part 1, --part 2, etc. as shown in example 6 above
  Each --part runs in a fresh Python process so Windows fully reclaims memory
  between runs.

================================================================================
WHAT'S NEW IN v3.3
================================================================================
  - Detects unnumbered top-level section headings and infers their numbers
    from surrounding numbered subsections. Example:

        About this Document   <-- unnumbered, becomes section 1
          1.1 Audience
          1.2 Firmware Version
        Introduction          <-- unnumbered, becomes section 2
          2.1 Features
        Functional Description <-- unnumbered, inferred as section 3
        Clocking               <-- unnumbered, inferred as section 4
        Parameters             <-- unnumbered, inferred as section 5
        SEP Interfaces         <-- unnumbered, becomes section 6
          6.1 Clock and Reset

    Previously these unnumbered headings were silently buried inside the
    previous section. Now they are first-class top-level sections.

  - Grouped-mode filenames shortened from `sections_1_to_4` to `sec_1_to_4`
    so they fit better in narrow file viewers.

================================================================================
"""
import argparse, gc, hashlib, json, os, platform, re, shutil, subprocess, sys
import tempfile, time, traceback, zipfile
from datetime import datetime
from pathlib import Path

VERSION = "3.3.0"
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"

# MinerU memory tuning (CPU mode on low-RAM machines)
# These force smaller per-batch image counts and lower API concurrency
os.environ.setdefault("MINERU_MIN_BATCH_INFERENCE_SIZE", "16")  # default 64; lower = less memory
os.environ.setdefault("MINERU_VIRTUAL_VRAM_SIZE", "1")          # tells MinerU to assume only 1GB available
os.environ.setdefault("MINERU_API_REQUEST_CONCURRENCY", "1")    # default 3; we only run 1 doc at a time

TIMEOUT = 4 * 3600

# ──────────────────────────────────────────────────────────────────────
# Small utilities
# ──────────────────────────────────────────────────────────────────────

def ask(prompt, valid):
    while True:
        try:
            r = input(prompt).strip().lower()
            return r if r in valid else (valid[0] if r == "" else None)
        except: sys.exit(1)

def md5(fp):
    h = hashlib.md5()
    with open(fp, "rb") as f:
        for c in iter(lambda: f.read(8192), b""): h.update(c)
    return h.hexdigest()

def slug(text, n=60):
    t = re.sub(r"[^\w\s-]", "", text.lower().strip())
    t = re.sub(r"[\s-]+", "_", t)
    return re.sub(r"_+", "_", t).strip("_")[:n] or "untitled"

def pdf_pages(fp):
    try:
        d = open(fp, "rb").read()
        c = len(re.findall(rb"/Type\s*/Page(?!s)", d))
        if c > 0: return c
        m = re.search(rb"/Count\s+(\d+)", d)
        return int(m.group(1)) if m else -1
    except: return -1

def get_available_ram_gb():
    """Best-effort available RAM check. Returns None if psutil not installed."""
    try:
        import psutil
        return psutil.virtual_memory().available / (1024**3)
    except ImportError:
        return None

# ──────────────────────────────────────────────────────────────────────
# HTML table → markdown
# ──────────────────────────────────────────────────────────────────────

def html_to_md_table(html):
    try:
        rows = re.findall(r"<tr[^>]*>(.*?)</tr>", html, re.DOTALL|re.I)
        if not rows: return html
        grid, spans = [], {}
        for ri, rh in enumerate(rows):
            cells = re.findall(r"<(?:td|th)([^>]*)>(.*?)</(?:td|th)>", rh, re.DOTALL|re.I)
            row, ci = [], 0
            for attrs, content in cells:
                while (ri, ci) in spans: row.append(spans.pop((ri, ci))); ci += 1
                txt = re.sub(r"<[^>]+>", "", content).strip()
                txt = re.sub(r"\s+", " ", txt)
                cs = int(m.group(1)) if (m := re.search(r"colspan\s*=\s*['\"]?(\d+)", attrs)) else 1
                rs = int(m.group(1)) if (m := re.search(r"rowspan\s*=\s*['\"]?(\d+)", attrs)) else 1
                for c in range(cs):
                    row.append(txt)
                    for r in range(1, rs): spans[(ri+r, ci+c)] = txt
                    ci += 1
            while (ri, ci) in spans: row.append(spans.pop((ri, ci))); ci += 1
            grid.append(row)
        if not grid: return html
        mc = max(len(r) for r in grid)
        for r in grid:
            while len(r) < mc: r.append("")
        w = [max(3, max(len(grid[r][c]) for r in range(len(grid)))) for c in range(mc)]
        lines = []
        for i, row in enumerate(grid):
            lines.append("| " + " | ".join(row[c].ljust(w[c]) for c in range(mc)) + " |")
            if i == 0: lines.append("| " + " | ".join("-"*w[c] for c in range(mc)) + " |")
        return "\n".join(lines)
    except: return html

def convert_html_tables(content):
    return re.sub(r"<table[^>]*>.*?</table>",
        lambda m: "\n\n" + html_to_md_table(m.group(0)) + "\n\n",
        content, flags=re.DOTALL|re.I)

# ──────────────────────────────────────────────────────────────────────
# Image renaming: match NEAREST caption to each image
# ──────────────────────────────────────────────────────────────────────

def rename_images(md, images_dir):
    lines = md.split("\n")
    captions = {}
    cap_re = re.compile(r"^[*_]*\s*((?:Figure|Fig\.?|Table|Diagram)\s*\d+[\.\:]\s*.+?)[\s*_]*$", re.I)
    for i, line in enumerate(lines):
        cm = cap_re.match(line.strip())
        if cm: captions[i] = cm.group(1)

    rmap = {}
    used_captions = set()
    for idx, line in enumerate(lines):
        im = re.search(r"!\[([^\]]*)\]\(([^)]+)\)", line)
        if not im: continue
        old = os.path.basename(im.group(2))
        ext = os.path.splitext(old)[1] or ".png"
        alt = im.group(1).strip()

        best_cap, best_dist = "", 999
        best_ci = -1
        for ci, cap in captions.items():
            if ci in used_captions: continue
            dist = abs(ci - idx)
            if dist < best_dist and dist <= 10:
                best_cap, best_dist = cap, dist
                best_ci = ci

        if not best_cap and alt:
            alt_cm = re.match(r"((?:Figure|Fig\.?|Table|Diagram)\s*\d+[\.\:]?\s*.+)", alt, re.I)
            if alt_cm: best_cap = alt_cm.group(1)

        if best_cap:
            if best_ci >= 0: used_captions.add(best_ci)
            new = slug(best_cap, 80) + ext
        else:
            new = old
            for i in range(idx-1, max(-1, idx-20), -1):
                hm = re.match(r"^#{1,6}\s+(.+)$", lines[i])
                if hm: new = slug(hm.group(1), 50) + f"_img{idx}" + ext; break

        base = os.path.splitext(new)[0]
        final, c = new, 2
        while final in rmap.values() and final != old:
            final = f"{base}_{c}{ext}"; c += 1
        rmap[old] = final

    if images_dir and images_dir.exists():
        for o, n in rmap.items():
            if o != n:
                op, np_ = images_dir/o, images_dir/n
                if op.exists() and not np_.exists():
                    try: op.rename(np_)
                    except: rmap[o] = o

    for o, n in rmap.items():
        if o != n: md = md.replace(o, n)
    return md

# ──────────────────────────────────────────────────────────────────────
# DOCX image extraction fallback
# ──────────────────────────────────────────────────────────────────────

def extract_docx_images(docx_path, dest_images_dir):
    count = 0
    try:
        dest_images_dir.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(docx_path, 'r') as z:
            for name in z.namelist():
                if name.startswith("word/media/"):
                    ext = os.path.splitext(name)[1].lower()
                    if ext in (".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tiff", ".emf", ".wmf"):
                        img_name = os.path.basename(name)
                        img_data = z.read(name)
                        (dest_images_dir / img_name).write_bytes(img_data)
                        count += 1
    except Exception as e:
        print(f"  [WARN] DOCX image extraction failed: {e}")
    return count

# ──────────────────────────────────────────────────────────────────────
# Optional pytesseract OCR for images
# ──────────────────────────────────────────────────────────────────────

def ocr_images(md, images_dir):
    try:
        import pytesseract; from PIL import Image
    except ImportError:
        print("  [WARN] pytesseract/Pillow not installed. Skipping image OCR.")
        return md
    lines = md.split("\n")
    inserts = {}
    for idx, line in enumerate(lines):
        im = re.search(r"!\[([^\]]*)\]\(([^)]+)\)", line)
        if not im: continue
        name = os.path.basename(im.group(2))
        p = images_dir / name if images_dir else None
        if not p or not p.exists(): continue
        try:
            txt = pytesseract.image_to_string(Image.open(p)).strip()
            if txt and len(txt) > 10:
                inserts[idx] = f"> ⚠️ **Auto-extracted text from {name} (may be inaccurate):**\n> {txt[:500].replace(chr(10), chr(10)+'> ')}\n"
        except: pass
    if not inserts: return md
    new = []
    for i, l in enumerate(lines):
        if i in inserts: new.append(inserts[i])
        new.append(l)
    print(f"  [OCR] Text from {len(inserts)} images")
    return "\n".join(new)

# ──────────────────────────────────────────────────────────────────────
# Section detection and splitting
# ──────────────────────────────────────────────────────────────────────

def split_sections(md):
    """Split markdown into sections by headings (both numbered AND unnumbered).
    Returns list of section dicts: {heading, num, lines, top_level, inferred}
      heading      - the heading text
      num          - the numbered prefix like "1.2.3" or "" for unnumbered
      lines        - list of lines belonging to this section
      top_level    - the integer of the first dotted component, e.g. "3.1.2" -> 3
                     0 for preamble; will be filled in later for unnumbered headings
                     by infer_top_level_numbers()
      inferred     - True if top_level was inferred (not directly numbered)
    """
    lines = md.split("\n")
    secs = []
    cur = {"heading": "Preamble", "num": "", "lines": [], "top_level": 0, "inferred": False}

    # Match either: "## 1.2.3 Title"  OR  "## Title"  (unnumbered)
    sec_re = re.compile(r"^(#{1,6})\s+((\d+(?:\.\d+)*\.?)\s+.+)$")
    hdr_re = re.compile(r"^(#{1,6})\s+(.+)$")

    for line in lines:
        sm = sec_re.match(line)
        if sm:
            # Numbered heading
            if cur["lines"] or cur["heading"] != "Preamble": secs.append(cur)
            num = sm.group(3).rstrip(".")
            top = int(num.split(".")[0]) if num.split(".")[0].isdigit() else 0
            cur = {"heading": sm.group(2).strip(), "num": num, "lines": [line],
                   "top_level": top, "inferred": False}
            continue

        hm = hdr_re.match(line)
        if hm:
            # Unnumbered heading - might be a top-level section without a number
            heading_text = hm.group(2).strip()
            # Skip if this looks like a numbered heading we already matched (defensive)
            # Also skip if heading text starts with a digit (handled by sec_re above)
            if cur["lines"] or cur["heading"] != "Preamble": secs.append(cur)
            cur = {"heading": heading_text, "num": "", "lines": [line],
                   "top_level": 0, "inferred": False}
            continue

        cur["lines"].append(line)
    if cur["lines"]: secs.append(cur)

    # Run inference: assign top_level numbers to unnumbered headings based on
    # the surrounding numbered context
    secs = infer_top_level_numbers(secs)

    return secs


def infer_top_level_numbers(secs):
    """Walk through sections and infer top_level numbers for unnumbered headings.

    Strategy:
    1. Numbered sections already have top_level set from their number prefix
    2. For each unnumbered heading, check if a numbered subsection (N.x) follows
       it BEFORE any other numbered top-level (M.something different from N).
       If so, this unnumbered heading IS section N.
    3. For unnumbered headings between two known top-level sections that have
       no following N.x, they fill in the missing top-level numbers in order.

    Example:
        About this Document    (unnumbered)  --> top_level=1 (next is 1.1)
        1.1 Audience           (numbered)    --> top_level=1
        Introduction           (unnumbered)  --> top_level=2 (next is 2.1)
        2.1 Features           (numbered)    --> top_level=2
        Functional Description (unnumbered)  --> top_level=3 (counted: between 2 and 6)
        Clocking               (unnumbered)  --> top_level=4
        Parameters             (unnumbered)  --> top_level=5
        SEP Interfaces         (unnumbered)  --> top_level=6 (next is 6.1)
        6.1 Clock and Reset    (numbered)    --> top_level=6
    """
    n = len(secs)
    if n == 0: return secs

    def is_unnumbered_heading(s):
        return (not s["num"]) and s["top_level"] == 0 and s["heading"] != "Preamble"

    # Pass 1: For each unnumbered heading, find the next NUMBERED section.
    # If that next numbered section has top_level T, then this heading IS section T.
    # We do this from right to left so multiple consecutive unnumbered headings
    # can each be evaluated against the same following numbered anchor.
    for i in range(n):
        if not is_unnumbered_heading(secs[i]):
            continue
        # Look forward for the next NUMBERED section
        next_top = None
        for j in range(i + 1, n):
            if secs[j]["num"] and secs[j]["top_level"] > 0:
                next_top = secs[j]["top_level"]
                break
        if next_top is not None:
            # Mark with a tentative inferred top_level so the next pass can refine
            secs[i]["_next_top"] = next_top

    # Pass 2: Walk through sections in order, tracking the "expected" current top level.
    # When we hit an unnumbered heading, we need to figure out what number it should be.
    cur_top = 0  # highest top_level we have established so far
    warnings = []

    for i in range(n):
        s = secs[i]
        if s["num"] and s["top_level"] > 0:
            # Numbered section - update cur_top to its top_level
            if s["top_level"] > cur_top:
                cur_top = s["top_level"]
            continue

        if not is_unnumbered_heading(s):
            continue

        # Unnumbered heading
        next_top = s.get("_next_top")  # the next numbered section's top_level

        if next_top is None:
            # No more numbered sections after this. It's a trailing top-level (like an appendix).
            # Assign it cur_top + 1 and increment cur_top.
            inferred = cur_top + 1
            s["top_level"] = inferred
            s["num"] = str(inferred)
            s["inferred"] = True
            cur_top = inferred
            continue

        # next_top is the top_level of the next numbered section
        # Cases:
        #   (a) next_top > cur_top + 1
        #       e.g. cur_top=2, next_top=6: there are top-levels 3,4,5,6 missing
        #       This heading is the FIRST of those missing tops (3 if it's the first
        #       unnumbered between, 4 if it's the second, etc.)
        #       But wait - the LAST one before the anchor with top=6 should be 6 itself
        #       (because the anchor is N.x meaning section N).
        #
        #   (b) next_top == cur_top + 1
        #       e.g. cur_top=1, next_top=2: this heading IS section 2.
        #
        #   (c) next_top <= cur_top
        #       Backwards numbering or duplicate. Treat as a sub-heading inside cur_top.

        if next_top <= cur_top:
            # Heading is inside the current top-level (e.g., a sub-heading without number)
            s["top_level"] = cur_top
            s["inferred"] = True
            continue

        # Now we know next_top > cur_top.
        # We need to figure out what this heading's number is.
        # Look ahead: how many CONSECUTIVE unnumbered headings (including this one)
        # come before the next numbered anchor?
        consecutive_unnumbered = []
        for j in range(i, n):
            if is_unnumbered_heading(secs[j]) and secs[j].get("_next_top") == next_top:
                consecutive_unnumbered.append(j)
            else:
                break

        # Number of unnumbered headings sharing the same _next_top
        k = len(consecutive_unnumbered)
        # The LAST of these k headings is section `next_top`
        # The PREVIOUS ones are next_top-1, next_top-2, etc.
        # First one is at index next_top - k + 1 ... but that has to be > cur_top
        first_inferred = next_top - k + 1

        if first_inferred <= cur_top:
            # We have more unnumbered headings than slots available
            # e.g., cur_top=2, next_top=6, k=5  -> first_inferred = 2, but cur_top=2 already
            # Squeeze them into available slots
            warnings.append(f"Found {k} unnumbered top-level heading(s) before section "
                          f"{next_top}, but only {next_top - cur_top} slot(s) available "
                          f"(after section {cur_top}). Assigning sequentially.")
            first_inferred = cur_top + 1
            slots = next_top - cur_top
            for offset, idx in enumerate(consecutive_unnumbered):
                if offset < slots:
                    inferred = first_inferred + offset
                    secs[idx]["top_level"] = inferred
                    secs[idx]["num"] = str(inferred)
                    secs[idx]["inferred"] = True
                else:
                    # Extras become inner content of the last assigned top
                    secs[idx]["top_level"] = first_inferred + slots - 1
                    secs[idx]["inferred"] = True
            # Process them all in one pass; advance loop
            cur_top = max(cur_top, first_inferred + slots - 1)
            # Skip past these in the outer loop
            # (the for loop will revisit but they'll all be assigned now)
            continue

        # Normal case: assign each of the k headings to next_top - k + 1 .. next_top
        for offset, idx in enumerate(consecutive_unnumbered):
            inferred = first_inferred + offset
            secs[idx]["top_level"] = inferred
            secs[idx]["num"] = str(inferred)
            secs[idx]["inferred"] = True
        cur_top = next_top  # the last consecutive heading reaches next_top

    # Clean up the temporary _next_top key
    for s in secs:
        s.pop("_next_top", None)

    # Print warnings to user
    for w in warnings:
        print(f"  [WARN] {w}")

    return secs


def has_numbered_sections(secs):
    """True if we found any numbered top-level section (including inferred ones)."""
    return any(s["num"] and s["top_level"] > 0 for s in secs)

def group_by_top_level(secs):
    """Group consecutive sections by their top-level number.
    Returns: (preamble_section_or_None, list_of_top_level_groups)
    Each group is a list of section dicts that share the same top_level number.
    Preamble is split out separately.
    """
    preamble = None
    body = []
    for s in secs:
        if s["heading"] == "Preamble" and not s["num"]:
            preamble = s
        else:
            body.append(s)

    # Group consecutive sections by top_level number
    groups = []
    cur_group = []
    cur_top = None
    for s in body:
        if cur_top is None or s["top_level"] != cur_top:
            if cur_group: groups.append(cur_group)
            cur_group = [s]
            cur_top = s["top_level"]
        else:
            cur_group.append(s)
    if cur_group: groups.append(cur_group)
    return preamble, groups

def distribute_into_n_files(top_level_groups, n):
    """Distribute top-level groups into N files using Option B logic.
    Front-loads extras: ceil(remaining/files_left) per file.
    Returns: list of N lists, each containing top-level groups.
    If n > number of groups, returns one group per file (cannot create more files than groups).
    """
    total = len(top_level_groups)
    if n >= total:
        return [[g] for g in top_level_groups]

    result = []
    idx = 0
    files_left = n
    remaining = total
    while files_left > 0 and idx < total:
        # ceil(remaining / files_left)
        take = (remaining + files_left - 1) // files_left
        result.append(top_level_groups[idx:idx+take])
        idx += take
        remaining -= take
        files_left -= 1
    return result

def get_section_range_label(file_groups):
    """Given a list of top-level groups in one file, return a short label.
    Examples:
      one section:        'sec_3'
      multiple sections:  'sec_1_to_4'
    """
    if not file_groups: return "empty"
    first_top = file_groups[0][0]["top_level"]
    last_top = file_groups[-1][-1]["top_level"]
    if first_top == last_top:
        return f"sec_{first_top}"
    return f"sec_{first_top}_to_{last_top}"

# ──────────────────────────────────────────────────────────────────────
# Footnote handling (collect from raw markdown, distribute after split)
# ──────────────────────────────────────────────────────────────────────

def handle_footnotes_presplit(md):
    lines = md.split("\n")
    fn_re = re.compile(r"^\s*[\(\[]\s*(\d+)\s*[\)\]]\s+(.+)")
    footnotes = {}
    fn_lines = set()
    for i, line in enumerate(lines):
        m = fn_re.match(line)
        if m:
            footnotes[m.group(1)] = line.strip()
            fn_lines.add(i)
            for j in range(i+1, min(len(lines), i+5)):
                if lines[j].strip() and not fn_re.match(lines[j]) and (lines[j].startswith("  ") or lines[j].startswith("\t")):
                    footnotes[m.group(1)] += " " + lines[j].strip()
                    fn_lines.add(j)
                else:
                    break

    if not footnotes:
        return md

    cleaned = []
    for i, line in enumerate(lines):
        if i in fn_lines:
            continue
        if line.strip() == "---" or line.strip() == "___":
            near_fn = False
            for j in range(i+1, min(len(lines), i+3)):
                if j in fn_lines: near_fn = True; break
                if lines[j].strip(): break
            for j in range(i-1, max(-1, i-3), -1):
                if j in fn_lines: near_fn = True; break
                if lines[j].strip(): break
            if near_fn:
                continue
        cleaned.append(line)

    cleaned.append("\n<!-- FOOTNOTES_DATA")
    for num, text in sorted(footnotes.items(), key=lambda x: int(x[0])):
        cleaned.append(f"FN:{num}:{text}")
    cleaned.append("FOOTNOTES_END -->")

    return "\n".join(cleaned)


def handle_footnotes_postsplit(sections):
    footnotes = {}
    for sec in sections:
        new_lines = []
        in_fn_data = False
        for line in sec["lines"]:
            if "<!-- FOOTNOTES_DATA" in line:
                in_fn_data = True; continue
            if "FOOTNOTES_END -->" in line:
                in_fn_data = False; continue
            if in_fn_data:
                m = re.match(r"FN:(\d+):(.+)", line)
                if m: footnotes[m.group(1)] = m.group(2)
                continue
            new_lines.append(line)
        sec["lines"] = new_lines

    if not footnotes:
        return sections

    ref_re = re.compile(r"(?<!\d)[\(\[](\d+)[\)\]](?!\s*[\.\d])")

    for sec in sections:
        content = "\n".join(sec["lines"])
        referenced = set()
        for m in ref_re.finditer(content):
            num = m.group(1)
            if num in footnotes:
                referenced.add(num)

        if referenced:
            sec["lines"].append("")
            sec["lines"].append("---")
            sec["lines"].append("**Footnotes:**")
            sec["lines"].append("")
            for num in sorted(referenced, key=int):
                sec["lines"].append(footnotes[num])

    return sections

# ──────────────────────────────────────────────────────────────────────
# Filename builder for legacy per-section mode
# ──────────────────────────────────────────────────────────────────────

def make_name(idx, sec):
    h, num = sec["heading"], sec["num"]
    if num:
        np_ = num.replace(".", "_")
        txt = re.sub(r"^\d+(\.\d+)*\.?\s*", "", h).strip()
        return f"{idx:02d}_{np_}_{slug(txt, 50)}.md" if txt else f"{idx:02d}_{np_}.md"
    generic = {"preamble","overview","introduction","summary","related information",
               "revision history","contents","table of contents"}
    if h.lower().strip() in generic:
        for line in sec["lines"][:20]:
            m = re.match(r"^#{1,6}\s+(\d+(?:\.\d+)*\.?\s+.+)$", line)
            if m:
                sn = re.match(r"(\d+(?:\.\d+)*)", m.group(1))
                txt = re.sub(r"^\d+(\.\d+)*\.?\s*", "", m.group(1)).strip()
                if sn: return f"{idx:02d}_{sn.group(1).replace('.','_')}_{slug(txt,50)}.md"
                return f"{idx:02d}_{slug(txt,50)}.md"
    return f"{idx:02d}_{slug(h)}.md"

# ──────────────────────────────────────────────────────────────────────
# Excel
# ──────────────────────────────────────────────────────────────────────

def xlsx_to_md(fp):
    try: import openpyxl
    except: print("  [WARN] openpyxl not installed."); return None
    wb = openpyxl.load_workbook(fp, read_only=True, data_only=True)
    parts = []
    for sn in wb.sheetnames:
        rows = [[str(c) if c is not None else "" for c in r] for r in wb[sn].iter_rows(values_only=True)]
        if not rows: continue
        mc = max(len(r) for r in rows)
        for r in rows:
            while len(r) < mc: r.append("")
        w = [max(3, max(len(rows[r][c]) for r in range(len(rows)))) for c in range(mc)]
        parts.append(f"# {sn}\n")
        for i, row in enumerate(rows):
            parts.append("| " + " | ".join(row[c].ljust(w[c]) for c in range(mc)) + " |")
            if i == 0: parts.append("| " + " | ".join("-"*w[c] for c in range(mc)) + " |")
        parts.append("")
    wb.close()
    return "\n".join(parts)

# ──────────────────────────────────────────────────────────────────────
# Environment / preflight checks
# ──────────────────────────────────────────────────────────────────────

def check_py():
    v = sys.version_info
    print(f"[CHECK] Python {v.major}.{v.minor}.{v.micro}")
    if v < (3,10): print("[ERROR] Need 3.10+"); sys.exit(1)
    if v >= (3,14): print("[ERROR] 3.14+ unsupported"); sys.exit(1)

def check_mineru():
    try:
        r = subprocess.run(["mineru","-v"], capture_output=True, text=True, timeout=30)
        print(f"[OK] MinerU: {(r.stdout or r.stderr).strip()}"); return True
    except FileNotFoundError:
        print("[ERROR] MinerU not found. pip install mineru"); return False
    except: return True

def preflight_memory_warning(fp, label):
    """Print a warning for large PDFs on low-RAM systems."""
    p = Path(fp)
    if p.suffix.lower() != ".pdf": return
    pg = pdf_pages(fp)
    if pg <= 0: return
    avail = get_available_ram_gb()
    if pg >= 100:
        print(f"  [INFO] {pg}-page PDF in CPU mode.")
        if avail is not None:
            print(f"  [INFO] Available RAM: {avail:.1f} GB")
            if avail < 8 and pg >= 100:
                print(f"  [WARN] Low available RAM with a large document.")
                print(f"  [WARN] If this run fails with MemoryError, split the PDF")
                print(f"  [WARN] into 2 halves externally and re-run with --part 1 / --part 2.")
        else:
            print(f"  [INFO] (psutil not installed — cannot check available RAM)")
            if pg >= 150:
                print(f"  [WARN] Very large PDF. If this fails with MemoryError, split")
                print(f"  [WARN] the PDF externally and use --part 1 / --part 2.")

# ──────────────────────────────────────────────────────────────────────
# Input parsing
# ──────────────────────────────────────────────────────────────────────

def parse_input(inp):
    if ":" in inp:
        parts = inp.rsplit(":", 1)
        if len(parts)==2 and parts[1] and not parts[1].startswith(("\\","/")):
            return parts[0], parts[1].strip().upper()
    return inp, re.sub(r"[^A-Z0-9_]","",Path(inp).stem.upper().replace(" ","_"))

def doc_status(fp, label, meta, force, part_num):
    """Return status string. Considers part number for multi-part documents."""
    if force: return "new" if label not in meta.get("documents",{}) else "changed"
    sz = os.path.getsize(fp); h = md5(fp)
    d = meta.get("documents",{}).get(label,{})
    if not d: return "new"
    # For multi-part, look up the specific part
    parts_meta = d.get("parts", {})
    pkey = str(part_num)
    if pkey in parts_meta:
        if parts_meta[pkey].get("file_size")==sz and parts_meta[pkey].get("md5_checksum")==h:
            return "unchanged"
        return "changed"
    # Single-part legacy: if no parts key, fall back to old behavior
    if not parts_meta and part_num == 1:
        if d.get("file_size")==sz and d.get("md5_checksum")==h:
            return "unchanged"
        return "changed"
    return "new"

def load_meta(out):
    p = out / ".conversion_metadata.json"
    try: return json.loads(p.read_text()) if p.exists() else {"version":VERSION,"documents":{}}
    except: return {"version":VERSION,"documents":{}}

def save_meta(out, meta):
    meta["last_run"] = datetime.now().isoformat(); meta["version"] = VERSION
    (out/".conversion_metadata.json").write_text(json.dumps(meta,indent=2))

# ──────────────────────────────────────────────────────────────────────
# MinerU runner with stdout/stderr capture and error detection
# ──────────────────────────────────────────────────────────────────────

def run_mineru(fp, td, ocr=False):
    """Run MinerU with output capture so we can detect MemoryError vs Timeout."""
    cmd = ["mineru","-p",str(fp),"-o",str(td),"-b","pipeline","-d","cpu"]
    if ocr: cmd += ["-m","ocr"]
    print(f"  {' '.join(cmd)}")
    print(f"  [ENV] MINERU_MIN_BATCH_INFERENCE_SIZE={os.environ.get('MINERU_MIN_BATCH_INFERENCE_SIZE')} "
          f"MINERU_API_REQUEST_CONCURRENCY={os.environ.get('MINERU_API_REQUEST_CONCURRENCY')}")
    try:
        # Use Popen so we can stream output to user AND capture it for analysis
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            encoding="utf-8",
            errors="replace",
        )
        captured = []
        try:
            for line in proc.stdout:
                sys.stdout.write(line)
                sys.stdout.flush()
                captured.append(line)
            proc.wait(timeout=TIMEOUT)
        except subprocess.TimeoutExpired:
            proc.kill()
            return False, "timeout (subprocess wall-clock exceeded)"
        captured_text = "".join(captured)
        if proc.returncode == 0:
            return True, None
        # Inspect output for known failure modes
        if "MemoryError" in captured_text:
            return False, "MemoryError inside MinerU worker (out of RAM)"
        if "Timed out waiting for result" in captured_text:
            return False, "MinerU worker died (likely OOM crash, parent reported timeout)"
        if "CUDA out of memory" in captured_text:
            return False, "GPU out of memory"
        return False, f"MinerU exited with code {proc.returncode}"
    except FileNotFoundError:
        return False, "mineru command not found"
    except Exception as e:
        return False, str(e)
    finally:
        # Aggressive cleanup so Windows reclaims memory before next document
        gc.collect()
        time.sleep(2)

def find_output(td):
    mds = sorted(Path(td).rglob("*.md"))
    if not mds: return None, None
    mf = mds[0]; idir = None
    for n in ["images","imgs","figures"]:
        c = mf.parent / n
        if c.exists(): idir = c; break
    return mf, idir

def check_scanned(md, sz):
    t = re.sub(r"[#|*`\-=\[\]()!>\n\r\t ]", "", md)
    e = sz * 0.3
    return e > 0 and len(t) < e * 0.05 and len(t) < 500

# ──────────────────────────────────────────────────────────────────────
# File numbering for multi-part appending
# ──────────────────────────────────────────────────────────────────────

def get_highest_existing_number(dd):
    """Look at existing NN_*.md files in dd and return the highest NN found, or 0."""
    if not dd.exists(): return 0
    highest = 0
    pat = re.compile(r"^(\d{2})_")
    for f in dd.glob("*.md"):
        m = pat.match(f.name)
        if m:
            n = int(m.group(1))
            if n > highest: highest = n
    return highest

# ──────────────────────────────────────────────────────────────────────
# Main per-document processing
# ──────────────────────────────────────────────────────────────────────

def process(fp, label, out, meta, force=False, ocr_img=False,
            num_of_md_files=None, part_num=1):
    """Process a single document. part_num >= 1.
    num_of_md_files: None=per-section default, 1=single file, N>=2=N files distribution.
    """
    p = Path(fp); ext = p.suffix.lower()
    st = doc_status(fp, label, meta, force, part_num)
    if st == "unchanged":
        print(f"\n[SKIP] {label} part {part_num}"); return True, 0
    print(f"\n[{st.upper()}] {label} (part {part_num}) — {p.name}")

    dd = out / label

    # Handle directory creation/deletion based on part_num
    if part_num == 1:
        # Fresh start - delete entire directory
        if dd.exists():
            shutil.rmtree(dd)
        dd.mkdir(parents=True, exist_ok=True)
        starting_index = 1
    else:
        # part 2+: must have existing directory from a prior --part 1 run
        if not dd.exists():
            print(f"  [ERROR] --part {part_num} specified but no existing directory found at {dd}")
            print(f"  [ERROR] Run --part 1 first for label {label}")
            return False, 0
        # Check that metadata records a part 1 (or earlier parts)
        existing_parts = meta.get("documents",{}).get(label,{}).get("parts",{})
        if "1" not in existing_parts:
            print(f"  [ERROR] --part {part_num} specified but no record of --part 1 for label {label}")
            print(f"  [ERROR] Run --part 1 first")
            return False, 0
        starting_index = get_highest_existing_number(dd) + 1
        print(f"  [INFO] Appending to existing directory, starting at file {starting_index:02d}_")

    # ── Non-MinerU file types ──
    if ext == ".xlsx":
        md = xlsx_to_md(fp)
        if not md: return False, 0
        fn = f"{starting_index:02d}_{slug(p.stem)}.md"
        (dd / fn).write_text(md, encoding="utf-8")
        record_part_meta(meta, label, fp, part_num, sections=1, images=0)
        print(f"  [OK] {fn}"); return True, 1

    if ext in (".txt", ".md", ""):
        fn = f"{starting_index:02d}_{slug(p.stem)}.md"
        (dd / fn).write_text(p.read_text(encoding="utf-8",errors="replace"), encoding="utf-8")
        record_part_meta(meta, label, fp, part_num, sections=1, images=0)
        print(f"  [OK] {fn}"); return True, 1

    if ext not in (".pdf",".docx",".pptx"):
        print(f"  [ERROR] Unsupported: {ext}"); return False, 0

    # ── PDF / DOCX / PPTX via MinerU ──
    td = Path(tempfile.mkdtemp(prefix=f"mineru_{label}_p{part_num}_"))
    try:
        pg = pdf_pages(fp) if ext == ".pdf" else -1
        if pg > 0: print(f"  {pg} pages, ~{max(1,pg*4//60)} min")
        preflight_memory_warning(fp, label)
        print("  [CONVERTING]...")
        ok, err = run_mineru(fp, td)
        if not ok:
            print(f"  [ERROR] {err}")
            if "MemoryError" in (err or "") or "OOM" in (err or "") or "out of memory" in (err or "").lower():
                print(f"  [HINT] Split the PDF into 2-3 smaller files externally,")
                print(f"  [HINT] then re-run as separate parts with --part 1, --part 2, etc.")
            return False, 0

        mdf, idir = find_output(td)
        if not mdf: print("  [ERROR] No output"); return False, 0
        md = mdf.read_text(encoding="utf-8", errors="replace")
        print(f"  [OK] {len(md.splitlines())} lines from MinerU")

        ocr_used = False
        if check_scanned(md, os.path.getsize(fp)):
            print("  [INFO] Low text — auto OCR...")
            shutil.rmtree(td); td = Path(tempfile.mkdtemp(prefix=f"mineru_{label}_p{part_num}_ocr_"))
            ok2, _ = run_mineru(fp, td, True)
            if ok2:
                mdf2, idir2 = find_output(td)
                if mdf2: md = mdf2.read_text(encoding="utf-8",errors="replace"); idir = idir2; ocr_used = True

        # HTML tables
        ht = len(re.findall(r"<table", md, re.I))
        if ht: md = convert_html_tables(md); print(f"  [OK] {ht} HTML tables")

        # Image directory setup
        di = dd / "images"; ic = 0
        if idir and idir.exists():
            di.mkdir(parents=True, exist_ok=True)
            # Copy images, merging with any existing
            for img in idir.iterdir():
                if img.is_file():
                    target = di / img.name
                    if target.exists():
                        # Avoid name collision between parts
                        stem, suf = img.stem, img.suffix
                        c = 2
                        while (di / f"{stem}_p{part_num}_{c}{suf}").exists(): c += 1
                        target = di / f"{stem}_p{part_num}_{c}{suf}"
                    shutil.copy2(img, target)
                    ic += 1

        # DOCX image fallback
        if ext == ".docx" and ic == 0:
            print("  [INFO] MinerU missed DOCX images — extracting directly...")
            fc = extract_docx_images(fp, di)
            if fc > 0:
                ic = fc
                print(f"  [OK] Extracted {fc} images from DOCX")

        # Rename images by caption
        md = rename_images(md, di if di.exists() else None)

        # Optional OCR on images
        if ocr_img and di.exists(): md = ocr_images(md, di)

        # Footnote handling
        md = handle_footnotes_presplit(md)

        # Section detection and writing
        files_written = write_output_files(md, dd, label, num_of_md_files, starting_index, part_num)

        record_part_meta(meta, label, fp, part_num, sections=files_written, images=ic, ocr_used=ocr_used)
        return True, files_written
    finally:
        if td.exists(): shutil.rmtree(td, ignore_errors=True)


def record_part_meta(meta, label, fp, part_num, sections, images, ocr_used=False):
    """Store per-part metadata."""
    docs = meta.setdefault("documents", {})
    doc = docs.setdefault(label, {"parts": {}})
    if "parts" not in doc:
        doc["parts"] = {}
    doc["parts"][str(part_num)] = {
        "source_path": str(fp),
        "source_filename": Path(fp).name,
        "file_size": os.path.getsize(fp),
        "md5_checksum": md5(fp),
        "sections_created": sections,
        "images_extracted": images,
        "ocr_used": ocr_used,
        "converted_at": datetime.now().isoformat(),
    }


def write_output_files(md, dd, label, num_of_md_files, starting_index, part_num):
    """Write the markdown to one or more files based on num_of_md_files setting.
    Returns the number of files written.
    """
    secs = split_sections(md)
    secs = handle_footnotes_postsplit(secs)

    has_numbered = has_numbered_sections(secs)

    # ── Mode A: --num_of_md_files NOT passed → original per-section behavior ──
    if num_of_md_files is None:
        return write_per_section(secs, dd, starting_index)

    # ── Mode B: --num_of_md_files 1 → single file with preamble inside ──
    if num_of_md_files == 1:
        return write_single_file(md, secs, dd, label, starting_index, part_num)

    # ── Mode C: --num_of_md_files N (N >= 2) → N files + separate preamble ──
    if not has_numbered:
        print("  [WARN] No numbered sections found in this document.")
        c = ask("  Proceed by grouping headings in order? [y/n]: ", ["y","n"])
        if c != "y":
            print("  [ABORT] Skipping this document.")
            return 0

    return write_grouped_files(secs, dd, num_of_md_files, starting_index, part_num)


def write_per_section(secs, dd, starting_index):
    """Original behavior: one file per section."""
    used = set()
    written = 0
    for i, s in enumerate(secs):
        idx = starting_index + i
        fn = make_name(idx, s)
        # Replace the index in the generated name to be safe
        fn = re.sub(r"^\d{2}_", f"{idx:02d}_", fn)
        while fn in used: fn = fn.replace(".md", f"_{idx}b.md")
        used.add(fn)
        ct = "\n".join(s["lines"])
        ct = re.sub(r"!\[([^\]]*)\]\((?!images/)([^)]*)\)",
            lambda m: f"![{m.group(1)}](images/{os.path.basename(m.group(2))})", ct)
        (dd/fn).write_text(ct, encoding="utf-8")
        print(f"  [OK] {fn} ({len(s['lines'])} lines)")
        written += 1
    return written


def write_single_file(md_full, secs, dd, label, starting_index, part_num):
    """Single file mode: everything (including preamble) in one .md file."""
    # Reconstruct content from sections (post footnote handling)
    parts = []
    for s in secs:
        parts.append("\n".join(s["lines"]))
    content = "\n".join(parts)
    content = re.sub(r"!\[([^\]]*)\]\((?!images/)([^)]*)\)",
        lambda m: f"![{m.group(1)}](images/{os.path.basename(m.group(2))})", content)
    suffix = f"_part{part_num}" if part_num > 1 or label_has_multiple_parts(dd) else ""
    fn = f"{starting_index:02d}_{slug(label.lower())}{suffix}_full.md"
    (dd/fn).write_text(content, encoding="utf-8")
    print(f"  [OK] {fn} (single file mode, {len(content.splitlines())} lines)")
    return 1


def label_has_multiple_parts(dd):
    """Heuristic: any existing files in dd suggest multi-part."""
    if not dd.exists(): return False
    return any(f.suffix == ".md" for f in dd.iterdir())


def write_grouped_files(secs, dd, n, starting_index, part_num):
    """Group sections into N files using Option B distribution.
    Preamble (anything before section 1) becomes its own 00_preamble file
    (NOT counted in N), and is renamed with starting_index for multi-part runs.
    """
    preamble, top_groups = group_by_top_level(secs)

    written = 0

    # Write preamble (if any content) as a separate file - NOT counted in N
    if preamble and any(line.strip() for line in preamble["lines"]):
        # Use index 00 for first part, otherwise use a part-aware index
        if part_num == 1:
            pre_fn = "00_preamble.md"
        else:
            pre_fn = f"{starting_index:02d}_preamble_part{part_num}.md"
            starting_index += 1
        ct = "\n".join(preamble["lines"])
        ct = re.sub(r"!\[([^\]]*)\]\((?!images/)([^)]*)\)",
            lambda m: f"![{m.group(1)}](images/{os.path.basename(m.group(2))})", ct)
        (dd/pre_fn).write_text(ct, encoding="utf-8")
        print(f"  [OK] {pre_fn} (preamble, not counted in N)")
        written += 1

    if not top_groups:
        print("  [WARN] No body sections found after preamble")
        return written

    file_groups = distribute_into_n_files(top_groups, n)
    actual_n = len(file_groups)
    if actual_n < n:
        print(f"  [INFO] Requested {n} files but only {len(top_groups)} top-level sections exist; producing {actual_n} files")

    for i, file_group in enumerate(file_groups):
        idx = starting_index + i
        label = get_section_range_label(file_group)
        fn = f"{idx:02d}_{label}.md"
        # Flatten all sections in this file group
        all_lines = []
        for tg in file_group:
            for sec in tg:
                all_lines.extend(sec["lines"])
        content = "\n".join(all_lines)
        content = re.sub(r"!\[([^\]]*)\]\((?!images/)([^)]*)\)",
            lambda m: f"![{m.group(1)}](images/{os.path.basename(m.group(2))})", content)
        (dd/fn).write_text(content, encoding="utf-8")
        print(f"  [OK] {fn} ({sum(len(tg) for tg in file_group)} top-level sections, {len(all_lines)} lines)")
        written += 1

    return written

# ──────────────────────────────────────────────────────────────────────
# Main entry
# ──────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(
        description="Convert documents (PDF/DOCX/PPTX/XLSX/TXT) to split markdown.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="See the top of this script for full usage examples.",
    )
    ap.add_argument("-i","--input",action="append",required=True,
                    help='"path:LABEL" — repeat for multiple documents')
    ap.add_argument("-o","--output",required=True,
                    help="Output directory")
    ap.add_argument("--dry-run",action="store_true",
                    help="Show what would be processed without converting")
    ap.add_argument("--force",action="store_true",
                    help="Re-convert even if document is unchanged")
    ap.add_argument("--ocr-images",action="store_true",
                    help="Run pytesseract on extracted images (requires pytesseract)")
    ap.add_argument("--num_of_md_files", type=int, default=None,
                    help="Output file count: 1 = single combined file (preamble inside), "
                         "N>=2 = N section files + separate 00_preamble.md, "
                         "not passed = one file per section (default)")
    ap.add_argument("--part", type=int, default=1,
                    help="Part number for multi-part documents. Default 1 (fresh start). "
                         "Use 2+ to append to an existing label directory after splitting "
                         "a large PDF externally.")
    args = ap.parse_args()

    # Validate --num_of_md_files
    if args.num_of_md_files is not None:
        if args.num_of_md_files < 1:
            print(f"[ERROR] --num_of_md_files must be 1 or greater (got {args.num_of_md_files})")
            sys.exit(1)

    # Validate --part
    if args.part < 1:
        print(f"[ERROR] --part must be 1 or greater (got {args.part})")
        sys.exit(1)

    print(f"{'='*50}\nDocument Converter v{VERSION}\n{'='*50}")
    check_py()
    avail = get_available_ram_gb()
    if avail is not None:
        print(f"[INFO] Available system RAM: {avail:.1f} GB")
    else:
        print(f"[INFO] (install psutil for RAM monitoring: pip install psutil)")

    inputs = [parse_input(i) for i in args.input]
    out = Path(args.output); out.mkdir(parents=True, exist_ok=True)
    meta = load_meta(out)

    if args.dry_run:
        print("="*50+"\nDRY RUN\n"+"="*50)
        for fp, lb in inputs:
            p = Path(fp)
            if not p.exists(): print(f"  [MISSING] {lb}"); continue
            s = doc_status(fp, lb, meta, args.force, args.part)
            if s == "unchanged": print(f"  [SKIP] {lb} part {args.part}")
            else:
                pg = pdf_pages(fp) if p.suffix.lower()==".pdf" else -1
                print(f"  [{s.upper()}] {lb} part {args.part} — {p.name}" + (f" ({pg} pages)" if pg>0 else ""))
        return

    need = any(Path(f).suffix.lower() in (".pdf",".docx",".pptx") for f,_ in inputs)
    if need and not check_mineru(): sys.exit(1)

    valid = []
    for fp, lb in inputs:
        p = Path(fp)
        if not p.exists(): print(f"[MISS] {fp}"); continue
        if p.suffix.lower() == ".vsdx": print(f"[VISIO] {p.name} — export as PNG"); continue
        valid.append((fp, lb))

    cv = sk = fl = 0; start = datetime.now()
    for fp, lb in valid:
        try:
            ok, n = process(fp, lb, out, meta, args.force, args.ocr_images,
                          num_of_md_files=args.num_of_md_files,
                          part_num=args.part)
            if ok and n > 0: cv += 1
            elif ok: sk += 1
            else:
                fl += 1
                if ask("  Continue? [Y/n] ",["y","n"]) == "n": break
        except:
            traceback.print_exc(); fl += 1
            if ask("  Continue? [Y/n] ",["y","n"]) == "n": break

    save_meta(out, meta)
    el = (datetime.now()-start).total_seconds()
    tot = sum(
        sum(p.get("sections_created",0) for p in d.get("parts",{}).values())
        for d in meta.get("documents",{}).values()
    )
    print(f"\n{'='*50}\nDONE — {cv} converted, {sk} skipped, {fl} failed")
    print(f"Total: {tot} files, {int(el//60)}m {int(el%60)}s")
    print(f"Output: {out.resolve()}\n{'='*50}")


if __name__ == "__main__":
    main()
