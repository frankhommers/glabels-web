#!/usr/bin/env python3
"""Builds the NIIMBOT product definitions from NIIMBOT's online label catalogue.

NIIMBOT's own app looks its label rolls up in an online catalogue. This script
reads that catalogue once and writes one gLabels template per label size to
backend/glabels_web/templates/extra/niimbot-templates.xml. The result is
committed; the build never goes online. Run it again to pick up new rolls:

    python3 scripts/update-niimbot-templates.py

The catalogue is not a documented service. See
https://printers.niim.blue/other/niimbot-cloud/ for what is known about it.

Geometry, as gLabels wants it for a roll: "width" runs across the roll and
"height" along it, in the direction the label comes out of the printer.
NIIMBOT describes a label as you design it, with a rotation for printing; we
turn that back. A cable label has a tail that wraps around the cable; it
follows the printable part along the roll, so the label gets longer by the
tail. The areas meant for text (the two faces of a cable flag) become guide
rectangles, the start of the tail a guide line.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.request
from collections import Counter, defaultdict
from datetime import UTC, datetime
from pathlib import Path
from xml.sax.saxutils import quoteattr

API = "https://print.niimbot.com/api"
HEADERS = {"Content-Type": "application/json", "niimbot-user-agent": "AppVersionName/999.0.0"}
# "Generic" labels; the other categories are industry designs on these rolls.
CATEGORY_ALL = 40
PAGE_SIZE = 100
PAUSE = 0.4

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "backend" / "glabels_web" / "templates" / "extra" / "niimbot-templates.xml"

# A printer model name as NIIMBOT sells it: "D110", "B21", "B1 Pro", "M2_H".
MODEL = re.compile(r"^[A-Z]{1,2}\d{1,3}[A-Z]?(?:[ _](?:Pro|SE|H|M))?$")
MAX_MODELS = 40


def post(path: str, body: dict) -> dict:
    request = urllib.request.Request(API + path, json.dumps(body).encode(), HEADERS)
    for attempt in range(5):
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                payload = json.load(response)
            if "data" in payload:
                return payload
        except (OSError, ValueError):
            pass
        time.sleep(2 + 2 * attempt)
    raise SystemExit(f"NIIMBOT catalogue does not answer: {path}")


def fetch_catalogue() -> list[dict]:
    items: list[dict] = []
    page = 1
    while True:
        body = {"page": page, "limit": PAGE_SIZE, "languageCode": "en", "categoryIds": [CATEGORY_ALL]}
        data = post("/stdTemplate/page", body)["data"] or {}
        batch = data.get("list") or []
        items += batch
        total = data.get("total") or 0
        print(f"\rcatalogue: {len(items)}/{total}", end="", file=sys.stderr, flush=True)
        if not batch or len(items) >= total:
            break
        page += 1
        time.sleep(PAUSE)
    print(file=sys.stderr)
    return items


def input_areas(barcode: str) -> list[dict]:
    """The areas meant for content; only the detail call has them."""
    data = post("/template/getCloudTemplateByOneCode", {"oneCode": barcode})["data"] or {}
    return [a for a in data.get("inputAreas") or [] if a.get("w") and a.get("h")]


def name_of(item: dict) -> str:
    if item.get("name"):
        return str(item["name"]).strip()
    for entry in item.get("names") or []:
        if entry.get("name"):
            return str(entry["name"]).strip()
    return ""


def turned(item: dict) -> bool:
    return item.get("rotate") in (90, 270)


def shape_of(item: dict) -> tuple[float, float, float]:
    """(across, along, tail) in mm, the label as it lies on the roll."""
    width, height = float(item["width"]), float(item["height"])
    across, along = (height, width) if turned(item) else (width, height)
    tail = float(item.get("cableLength") or 0) if item.get("isCable") else 0.0
    return across, along, tail


def to_roll(area: dict, item: dict) -> tuple[float, float, float, float]:
    """An area from design coordinates to the label as it lies on the roll.

    The printer turns the design clockwise by "rotate" degrees.
    """
    width, height = float(item["width"]), float(item["height"])
    x, y, w, h = (float(area[k]) for k in ("x", "y", "w", "h"))
    rotate = item.get("rotate") or 0
    if rotate == 90:
        return height - y - h, x, h, w
    if rotate == 180:
        return width - x - w, height - y - h, w, h
    if rotate == 270:
        return y, width - x - w, h, w
    return x, y, w, h


def mm(value: float) -> str:
    return f"{round(value, 2):g}mm"


def size_text(value: float) -> str:
    return f"{round(value, 2):g}"


def build(items: list[dict], details: bool) -> str:
    groups: dict[tuple[float, float, float], list[dict]] = defaultdict(list)
    for item in items:
        if not item.get("width") or not item.get("height"):
            continue
        groups[shape_of(item)].append(item)

    templates = []
    for (across, along, tail), members in sorted(groups.items()):
        part = f"{size_text(across)}x{size_text(along)}" + (f"+{size_text(tail)}" if tail else "")
        names = Counter(re.split(r"[-\s(]", name_of(m))[0] for m in members if name_of(m))
        known_as = [n for n, _ in names.most_common(3) if n and n.casefold() != part.casefold()]
        models = Counter()
        for member in members:
            for model in str((member.get("profile") or {}).get("machineName") or "").split(","):
                if MODEL.match(model.strip()):
                    models[model.strip().replace("_", " ")] += 1
        model_list = sorted(models, key=lambda m: (-models[m], m))[:MAX_MODELS]

        kind = "Cable label" if tail else "Label"
        description = f"{kind} {size_text(across)} × {size_text(along)} mm"
        if tail:
            description += f", tail {size_text(tail)} mm"
        if known_as:
            description += f" ({', '.join(known_as)})"
        if model_list:
            description += f" for {', '.join(model_list)}"

        markups = []
        if tail:
            markups.append(f'      <Markup-line x1="0mm" y1={quoteattr(mm(along))} x2={quoteattr(mm(across))} y2={quoteattr(mm(along))}/>')
            if details:
                for member in members:
                    if not member.get("barcode"):
                        continue
                    areas = input_areas(str(member["barcode"]))
                    time.sleep(PAUSE)
                    if areas:
                        for area in areas:
                            x, y, w, h = to_roll(area, member)
                            markups.append(
                                f'      <Markup-rect x1={quoteattr(mm(x))} y1={quoteattr(mm(y))}'
                                f' w={quoteattr(mm(w))} h={quoteattr(mm(h))} r="0.5mm"/>'
                            )
                        break

        length = along + tail
        lines = [
            f'  <Template brand="NIIMBOT" part={quoteattr(part)} _description={quoteattr(description)}',
            f'            size="roll" roll_width={quoteattr(mm(across))} width={quoteattr(mm(across))} height={quoteattr(mm(length))}>',
            '    <Meta category="label"/>',
            '    <Meta category="rectangle-label"/>',
            f'    <Label-rectangle id="0" width={quoteattr(mm(across))} height={quoteattr(mm(length))} round="0mm" x_waste="0mm" y_waste="0mm">',
            *markups,
            '      <Layout nx="1" ny="1" x0="0mm" y0="0mm" dx="0mm" dy="0mm"/>',
            '    </Label-rectangle>',
            '  </Template>',
        ]
        templates.append("\n".join(lines))
        if tail and details:
            print(f"cable label {part}: {len(markups) - 1} text areas", file=sys.stderr)

    header = (
        '<?xml version="1.0"?>\n\n'
        "<!-- NIIMBOT label rolls, one template per size. Generated by\n"
        "     scripts/update-niimbot-templates.py from NIIMBOT's online label catalogue\n"
        f"     on {datetime.now(UTC).date().isoformat()}; edit the script, not this file. -->\n\n"
        "<Glabels-templates>\n\n"
    )
    return header + "\n\n".join(templates) + "\n\n</Glabels-templates>\n"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--catalogue", type=Path, help="read the catalogue from this JSON file instead")
    parser.add_argument("--save-catalogue", type=Path, help="also write the catalogue to this JSON file")
    parser.add_argument("--no-details", action="store_true", help="skip the text areas of cable labels")
    parser.add_argument("--output", type=Path, default=OUTPUT)
    args = parser.parse_args()

    items = json.loads(args.catalogue.read_text()) if args.catalogue else fetch_catalogue()
    if args.save_catalogue:
        args.save_catalogue.write_text(json.dumps(items, ensure_ascii=False))
    xml = build(items, details=not args.no_details)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(xml, encoding="utf-8")
    print(f"{xml.count('<Template ')} templates in {args.output}", file=sys.stderr)


if __name__ == "__main__":
    main()
