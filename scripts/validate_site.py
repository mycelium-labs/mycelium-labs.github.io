#!/usr/bin/env python3
"""Validate local links, assets, fragments, and duplicate IDs in docs/."""

from html.parser import HTMLParser
from pathlib import Path
from typing import Optional
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1] / "docs"


class Document(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.ids: list[str] = []
        self.refs: list[tuple[str, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, Optional[str]]]) -> None:
        values = dict(attrs)
        if values.get("id"):
            self.ids.append(values["id"] or "")
        for attr in ("href", "src"):
            if values.get(attr):
                self.refs.append((attr, values[attr] or ""))


def document(path: Path) -> Document:
    parsed = Document()
    parsed.feed(path.read_text(encoding="utf-8"))
    return parsed


def target_for(source: Path, path: str) -> Path:
    if path == "":
        return source.resolve()
    if path.startswith("/"):
        candidate = ROOT / unquote(path.lstrip("/"))
    else:
        candidate = source.parent / unquote(path)
    if path == "/" or candidate.is_dir():
        candidate /= "index.html"
    return candidate.resolve()


def main() -> int:
    pages = {path.resolve(): document(path) for path in sorted(ROOT.glob("*.html"))}
    errors: list[str] = []
    for path, parsed in pages.items():
        relative = path.relative_to(ROOT)
        duplicates = sorted({value for value in parsed.ids if parsed.ids.count(value) > 1})
        for value in duplicates:
            errors.append(f"{relative}: duplicate id #{value}")
        for attr, raw in parsed.refs:
            parts = urlsplit(raw)
            if parts.scheme or parts.netloc or raw.startswith(("mailto:", "data:", "javascript:")):
                continue
            target = target_for(path, parts.path)
            if not target.exists():
                errors.append(f"{relative}: {attr} target missing: {raw}")
                continue
            if parts.fragment and target.suffix == ".html":
                target_doc = pages.get(target) or document(target)
                if unquote(parts.fragment) not in target_doc.ids:
                    errors.append(f"{relative}: fragment missing: {raw}")
    if errors:
        print("Site validation failed:")
        print("\n".join(f"- {error}" for error in errors))
        return 1
    print(f"Validated {len(pages)} HTML pages: local targets, fragments, and IDs are sound.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
