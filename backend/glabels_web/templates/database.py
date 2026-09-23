"""Reading the gLabels template database (XML), from upstream and the user.

The order follows upstream ``XmlTemplateParser``: all complete templates
first, then the ``equiv`` references. Forward references are not supported,
just like in the desktop app.
"""

from __future__ import annotations

import copy
import logging
from dataclasses import dataclass, field
from pathlib import Path

from lxml import etree

from ..units import UnitError, parse_length
from ..xml_safe import make_parser
from .models import Category, Frame, Layout, Markup, PaperSize, Template, Vendor
from .writer import TemplateWriteError, safe_filename, write_template_file

log = logging.getLogger(__name__)

_SHAPE_BY_TAG = {
    "Label-rectangle": "rectangle",
    "Label-round": "round",
    "Label-ellipse": "ellipse",
    "Label-cd": "cd",
    "Label-continuous": "continuous",
}

_MARKUP_BY_TAG = {
    "Markup-margin": "margin",
    "Markup-line": "line",
    "Markup-circle": "circle",
    "Markup-rect": "rect",
    "Markup-ellipse": "ellipse",
}


def _length(node: etree._Element, name: str, default: float | None = None) -> float | None:
    """Length attribute in points, as tolerant as upstream.

    The bundled database contains the odd unreadable value (``round="in"``,
    for example). The desktop app silently falls back to the default there;
    one data error must not make a whole product disappear from the list.
    """
    raw = node.get(name)
    if raw is None or raw == "":
        return default
    try:
        return parse_length(raw)
    except UnitError:
        log.warning("unreadable length %s=%r in <%s>, using the default", name, raw, node.tag)
        return default


def _i18n(node: etree._Element, name: str, default: str = "") -> str:
    # Translated variants live under "_name"; for now we show the source text.
    return node.get("_" + name) or node.get(name) or default


@dataclass
class TemplateDatabase:
    """The product database: bundled definitions plus the user's own."""

    paper_sizes: dict[str, PaperSize] = field(default_factory=dict)
    categories: dict[str, Category] = field(default_factory=dict)
    vendors: dict[str, Vendor] = field(default_factory=dict)
    templates: dict[str, Template] = field(default_factory=dict)
    # Templates we recognise but do not fully support (yet).
    unsupported: list[str] = field(default_factory=list)
    # Source XML per template; used to fill the Template section of a new
    # document without losing information from the database.
    _elements: dict[str, etree._Element] = field(default_factory=dict, repr=False)
    _system_dir: Path = field(default_factory=Path, repr=False)
    _user_dir: Path | None = field(default=None, repr=False)
    _stamp: tuple[float, int] = field(default=(0.0, 0), repr=False)

    # ---------------------------------------------------------------- loading
    @classmethod
    def load(cls, system_dir: Path, user_dir: Path | None = None) -> "TemplateDatabase":
        db = cls()
        db._system_dir = system_dir
        db._user_dir = user_dir
        db.reload()
        return db

    def reload(self) -> None:
        """Read the whole database again."""
        self.paper_sizes.clear()
        self.categories.clear()
        self.vendors.clear()
        self.templates.clear()
        self.unsupported.clear()
        self._elements.clear()

        system_dir = self._system_dir
        self._load_paper_sizes(system_dir / "paper-sizes.xml")
        self._load_categories(system_dir / "categories.xml")
        self._load_vendors(system_dir / "vendors.xml")
        self._load_template_dir(system_dir, source="system")
        if self._user_dir is not None and self._user_dir.is_dir():
            self._load_template_dir(self._user_dir, source="user")
        self._stamp = self._user_stamp()

    def _user_stamp(self) -> tuple[float, int]:
        """Fingerprint of the folder with user definitions."""
        if self._user_dir is None or not self._user_dir.is_dir():
            return (0.0, 0)
        newest = 0.0
        count = 0
        for path in self._user_dir.glob("*.xml"):
            if path.is_file():
                count += 1
                newest = max(newest, path.stat().st_mtime)
        return (newest, count)

    def refresh_if_changed(self) -> bool:
        """Reload when something changed outside the web interface."""
        if self._user_stamp() == self._stamp:
            return False
        self.reload()
        return True

    @property
    def user_dir(self) -> Path | None:
        return self._user_dir

    def _parse_file(self, path: Path) -> etree._Element | None:
        try:
            return etree.parse(str(path), parser=make_parser()).getroot()
        except (OSError, etree.XMLSyntaxError) as exc:
            log.warning("template file skipped %s: %s", path, exc)
            return None

    def _load_paper_sizes(self, path: Path) -> None:
        root = self._parse_file(path)
        if root is None:
            return
        for node in root.iterfind("Paper-size"):
            pid = node.get("id")
            if not pid:
                continue
            self.paper_sizes[pid] = PaperSize(
                id=pid,
                name=_i18n(node, "name", pid),
                width_pt=_length(node, "width", 0.0) or 0.0,
                height_pt=_length(node, "height", 0.0) or 0.0,
                pwg_class=node.get("pwg_class"),
            )

    def _load_categories(self, path: Path) -> None:
        root = self._parse_file(path)
        if root is None:
            return
        for node in root.iterfind("Category"):
            cid = node.get("id")
            if cid:
                self.categories[cid] = Category(id=cid, name=_i18n(node, "name", cid))

    def _load_vendors(self, path: Path) -> None:
        root = self._parse_file(path)
        if root is None:
            return
        for node in root.iterfind("Vendor"):
            name = node.get("name")
            if name:
                self.vendors[name] = Vendor(name=name, url=node.get("url"))

    def _load_template_dir(self, directory: Path, *, source: str) -> None:
        skip = {"paper-sizes.xml", "categories.xml", "vendors.xml"}
        files = sorted(p for p in directory.glob("*.xml") if p.name not in skip)

        roots: list[tuple[Path, etree._Element]] = []
        for path in files:
            root = self._parse_file(path)
            if root is not None and root.tag == "Glabels-templates":
                roots.append((path, root))

        # Pass 1: complete definitions. Pass 2: equiv references.
        for equiv_pass in (False, True):
            for path, root in roots:
                for node in root.iterfind("Template"):
                    if bool(node.get("equiv")) != equiv_pass:
                        continue
                    try:
                        tmpl = self._parse_template(node, source=source)
                    except Exception as exc:  # defensive: one error must not break the database
                        log.warning("template skipped in %s: %s", path.name, exc)
                        continue
                    if tmpl is not None:
                        self.templates[tmpl.key] = tmpl
                        source_node = node
                        if tmpl.equiv_part:
                            # An equiv reference has no geometry of its own.
                            source_node = self._elements.get(f"{tmpl.brand}\u241f{tmpl.equiv_part}", node)
                        self._elements[tmpl.key] = source_node

    def _parse_template(self, node: etree._Element, *, source: str) -> Template | None:
        brand = node.get("brand") or ""
        part = node.get("part") or ""
        if not brand or not part:
            # Obsolete "name" attribute: "<brand> <part>".
            name = node.get("name") or ""
            fields = name.split()
            if len(fields) < 2:
                return None
            brand, part = fields[0], fields[1]

        categories = [m.get("category") for m in node.iterfind("Meta") if m.get("category")]
        product_url = next((m.get("product_url") for m in node.iterfind("Meta") if m.get("product_url")), None)

        equiv_part = node.get("equiv")
        if equiv_part:
            base = self.templates.get(f"{brand}␟{equiv_part}")
            if base is None:
                log.warning("equiv not found: %s %s -> %s", brand, part, equiv_part)
                return None
            return base.model_copy(
                update={
                    "part": part,
                    "equiv_part": equiv_part,
                    "categories": list(dict.fromkeys(base.categories + categories)),
                    "product_url": product_url or base.product_url,
                    "source": source,
                }
            )

        paper_id = node.get("size") or ""
        paper = self.paper_sizes.get(paper_id)
        if paper is not None:
            page_w, page_h = paper.width_pt, paper.height_pt
        else:
            page_w = _length(node, "width", 0.0) or 0.0
            page_h = _length(node, "height", 0.0) or 0.0

        frames = []
        for child in node:
            shape = _SHAPE_BY_TAG.get(str(child.tag))
            if shape is None:
                if isinstance(child.tag, str) and child.tag not in ("Meta",):
                    self.unsupported.append(f"{brand} {part}: {child.tag}")
                continue
            frames.append(self._parse_frame(child, shape))

        if not frames:
            return None

        return Template(
            brand=brand,
            part=part,
            description=_i18n(node, "description"),
            size=paper_id or None,
            page_width_pt=page_w,
            page_height_pt=page_h,
            roll_width_pt=_length(node, "roll_width", 0.0) or 0.0,
            categories=categories,
            product_url=product_url,
            frames=frames,
            source=source,
        )

    def _parse_frame(self, node: etree._Element, shape: str) -> Frame:
        waste = _length(node, "waste", 0.0) or 0.0
        frame = Frame(
            id=node.get("id") or "0",
            shape=shape,  # type: ignore[arg-type]
            width_pt=_length(node, "width"),
            height_pt=_length(node, "height"),
            radius_pt=_length(node, "radius"),
            hole_pt=_length(node, "hole"),
            round_pt=_length(node, "round", 0.0),
            x_waste_pt=_length(node, "x_waste", waste) or 0.0,
            y_waste_pt=_length(node, "y_waste", waste) or 0.0,
            min_height_pt=_length(node, "min_height"),
            max_height_pt=_length(node, "max_height"),
            default_height_pt=_length(node, "default_height"),
        )
        for child in node:
            markup_type = _MARKUP_BY_TAG.get(str(child.tag))
            if markup_type is not None:
                values = {}
                for key, raw in child.attrib.items():
                    try:
                        values[str(key)] = parse_length(raw)
                    except ValueError:
                        continue
                frame.markups.append(Markup(type=markup_type, values=values))  # type: ignore[arg-type]
            elif str(child.tag) == "Layout":
                frame.layouts.append(
                    Layout(
                        nx=int(child.get("nx") or 1),
                        ny=int(child.get("ny") or 1),
                        x0_pt=_length(child, "x0", 0.0) or 0.0,
                        y0_pt=_length(child, "y0", 0.0) or 0.0,
                        dx_pt=_length(child, "dx", 0.0) or 0.0,
                        dy_pt=_length(child, "dy", 0.0) or 0.0,
                    )
                )
        return frame

    # ----------------------------------------------------------------- search
    def get(self, brand: str, part: str) -> Template | None:
        return self.templates.get(f"{brand}␟{part}")

    def brands(self) -> list[str]:
        return sorted({t.brand for t in self.templates.values()}, key=str.casefold)

    def search(
        self,
        *,
        text: str = "",
        brand: str | None = None,
        category: str | None = None,
        paper_size: str | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> tuple[list[Template], int]:
        needle = text.casefold().strip()
        found = []
        for tmpl in self.templates.values():
            if brand and tmpl.brand.casefold() != brand.casefold():
                continue
            if category and category not in tmpl.categories:
                continue
            if paper_size and (tmpl.size or "").casefold() != paper_size.casefold():
                continue
            if needle:
                haystack = f"{tmpl.brand} {tmpl.part} {tmpl.description}".casefold()
                if not all(word in haystack for word in needle.split()):
                    continue
            found.append(tmpl)
        found.sort(key=lambda t: (t.brand.casefold(), t.part.casefold()))
        return found[offset : offset + limit], len(found)

    def parse_template_element(self, node: etree._Element) -> Template | None:
        """Read the ``<Template>`` section of a document.

        A document carries its own product definition; that one is
        authoritative, even if the product is not (or no longer) in our
        database.
        """
        return self._parse_template(node, source="system")

    # ----------------------------------------------- template for a document
    def document_template_element(self, brand: str, part: str) -> etree._Element:
        """Build the ``<Template>`` section for a new document.

        We copy the element from the database instead of rebuilding it from
        our projection; that keeps every attribute of the product definition
        intact. The translated description is stored as a plain
        ``description``, the way the desktop app writes it too.
        """
        template = self.get(brand, part)
        source = self._elements.get(f"{brand}\u241f{part}")
        if template is None or source is None:
            raise KeyError(f"unknown template: {brand} {part}")

        node = copy.deepcopy(source)
        node.set("brand", template.brand)
        node.set("part", template.part)
        node.attrib.pop("equiv", None)
        node.attrib.pop("_description", None)
        node.set("description", template.description)
        # Category meta belongs to the product database, not the document; the
        # desktop app does not write it either.
        for meta in node.findall("Meta"):
            if meta.get("category") is not None and meta.get("product_url") is None:
                node.remove(meta)
        return node

    # ------------------------------------------------ managing user definitions
    def save_user_template(self, template: Template) -> Template:
        """Store a user product definition.

        Bundled definitions are left alone: they belong to the upstream
        database. An existing user definition with the same name is replaced.
        """
        if self._user_dir is None:
            raise TemplateWriteError("no folder for user definitions is configured")

        existing = self.get(template.brand, template.part)
        if existing is not None and existing.source != "user":
            raise TemplateWriteError(
                f"{template.brand} {template.part} is a bundled definition; "
                "choose another brand or part number"
            )

        write_template_file(template, self._user_dir)
        self.reload()
        stored = self.get(template.brand, template.part)
        if stored is None:
            raise TemplateWriteError("the definition could not be read back after saving")
        return stored

    def delete_user_template(self, brand: str, part: str) -> None:
        template = self.get(brand, part)
        if template is None:
            raise KeyError(f"{brand} {part}")
        if template.source != "user":
            raise TemplateWriteError("bundled definitions cannot be deleted")
        if self._user_dir is None:
            raise TemplateWriteError("no folder for user definitions is configured")

        path = self._user_dir / safe_filename(brand, part)
        if path.exists():
            path.unlink()
        else:
            # The file may have been renamed by hand; find it by content.
            for candidate in self._user_dir.glob("*.xml"):
                root = self._parse_file(candidate)
                if root is None:
                    continue
                nodes = root.findall("Template")
                if any(
                    (node.get("brand") or "") == brand and (node.get("part") or "") == part
                    for node in nodes
                ):
                    candidate.unlink()
                    break
        self.reload()
