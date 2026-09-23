"""XML parsing with fixed safety settings.

Documents and templates come from users. External entities, network
resolution and DTD loading are therefore disabled.
"""

from __future__ import annotations

from lxml import etree

_COMMON = dict(
    resolve_entities=False,
    no_network=True,
    load_dtd=False,
    dtd_validation=False,
    huge_tree=False,
)


def make_parser(*, remove_blank_text: bool = False) -> etree.XMLParser:
    return etree.XMLParser(remove_blank_text=remove_blank_text, **_COMMON)


def parse_bytes(data: bytes, *, remove_blank_text: bool = False) -> etree._ElementTree:
    return etree.ElementTree(etree.fromstring(data, parser=make_parser(remove_blank_text=remove_blank_text)))


class XmlError(ValueError):
    """Invalid or unsafe XML document."""
