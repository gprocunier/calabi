#!/usr/bin/env python3
"""Build a static documentation site for Calabi GitHub Pages."""

from __future__ import annotations

import argparse
import datetime as dt
import html
import re
import shutil
from urllib.parse import quote, unquote
from pathlib import Path
from typing import Iterable

from bs4 import BeautifulSoup, NavigableString
from cmarkgfm import Options, github_flavored_markdown_to_html


REPO_ROOT = Path(__file__).resolve().parents[2]
PROJECT_ROOT = REPO_ROOT / "aws-metal-openshift-demo"
DOCS_ROOT = PROJECT_ROOT / "docs"
ROOT_README = REPO_ROOT / "README.md"
PROJECT_README = PROJECT_ROOT / "README.md"
GITHUB_BLOB_BASE = "https://github.com/gprocunier/calabi/blob/main"
GITHUB_REPO_URL = "https://github.com/gprocunier/calabi"

SITE_ORDER = [
    "index",
    "readme",
    "project-readme",
    "prerequisites",
    "redhat-developer-subscription",
    "automation-flow",
    "authentication-model",
    "ad-idm-policy-model",
    "orchestration-plumbing",
    "manual-process",
    "iaas-resource-model",
    "network-topology",
    "host-resource-management",
    "host-memory-oversubscription",
    "openshift-cluster-matrix",
    "odf-declarative-plan",
    "orchestration-guide",
    "investigating",
    "issues",
    "secrets-and-sanitization",
]

PAGE_GROUPS = {
    "Start Here": [
        ("Docs Map", "index.html"),
        ("Lab README", "readme.html"),
        ("Project README", "project-readme.html"),
        ("Automation Flow", "automation-flow.html"),
        ("Manual Process", "manual-process.html"),
        ("Auth Model", "authentication-model.html"),
        ("Code Guide", "orchestration-guide.html"),
    ],
    "Build And Operate": [
        ("Prerequisites", "prerequisites.html"),
        ("Orchestration Plumbing", "orchestration-plumbing.html"),
        ("Resource Management", "host-resource-management.html"),
        ("Cluster Matrix", "openshift-cluster-matrix.html"),
    ],
}

PAGE_ADJACENCY = {
    "index": [
        ("Automation Flow", "automation-flow.html"),
        ("Authentication Model", "authentication-model.html"),
        ("Manual Process", "manual-process.html"),
        ("Orchestration Guide", "orchestration-guide.html"),
    ],
    "automation-flow": [
        ("Prerequisites", "prerequisites.html"),
        ("Orchestration Plumbing", "orchestration-plumbing.html"),
        ("Authentication Model", "authentication-model.html"),
        ("Manual Process", "manual-process.html"),
    ],
    "authentication-model": [
        ("Automation Flow", "automation-flow.html"),
        ("AD / IdM Policy Model", "ad-idm-policy-model.html"),
        ("Manual Process", "manual-process.html"),
        ("Orchestration Guide", "orchestration-guide.html"),
    ],
    "manual-process": [
        ("Automation Flow", "automation-flow.html"),
        ("Authentication Model", "authentication-model.html"),
        ("Orchestration Plumbing", "orchestration-plumbing.html"),
        ("Investigating", "investigating.html"),
    ],
    "orchestration-guide": [
        ("Automation Flow", "automation-flow.html"),
        ("Orchestration Plumbing", "orchestration-plumbing.html"),
        ("Authentication Model", "authentication-model.html"),
        ("Issues Ledger", "issues.html"),
    ],
    "investigating": [
        ("Issues Ledger", "issues.html"),
        ("Manual Process", "manual-process.html"),
        ("Orchestration Guide", "orchestration-guide.html"),
        ("Secrets And Sanitization", "secrets-and-sanitization.html"),
    ],
}

SITE_CSS = """
:root {
  --rh-red: #ee0000;
  --rh-red-dark: #a30000;
  --rh-red-light: #fce3e3;
  --rh-gray-10: #f5f5f5;
  --rh-gray-20: #e0e0e0;
  --rh-gray-30: #c7c7c7;
  --rh-gray-50: #8a8d90;
  --rh-gray-70: #6a6e73;
  --rh-gray-80: #4d4d4d;
  --rh-gray-90: #151515;
  --rh-link: #0066cc;
  --rh-max-width: 1360px;
  --rh-body-width: 820px;
  --rh-sidebar-width: 260px;
}

* { box-sizing: border-box; }
html { font-size: 16px; scroll-behavior: smooth; }
body {
  margin: 0;
  background: #ffffff;
  color: var(--rh-gray-90);
  font-family: "Red Hat Text", "Helvetica Neue", Arial, sans-serif;
  line-height: 1.5;
}

a {
  color: var(--rh-link);
  text-decoration: underline;
  text-underline-offset: 0.12em;
}

.site-shell {
  min-height: 100vh;
}

.site-header {
  border-top: 4px solid var(--rh-red);
  border-bottom: 1px solid var(--rh-gray-20);
  background: #ffffff;
}

.site-header__inner,
.site-footer,
.page-shell {
  max-width: var(--rh-max-width);
  margin: 0 auto;
  padding-left: 2rem;
  padding-right: 2rem;
}

.site-header__inner {
  padding-top: 1.25rem;
  padding-bottom: 1rem;
}

.site-brand {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem 2rem;
  align-items: baseline;
  justify-content: space-between;
}

.site-brand__title {
  margin: 0;
  font-family: "Red Hat Display", "Red Hat Text", Arial, sans-serif;
  font-size: clamp(2.1rem, 4vw, 3.5rem);
  line-height: 1.05;
  letter-spacing: -0.04em;
}

.site-brand__tagline {
  margin: 0.35rem 0 0;
  max-width: 60rem;
  color: var(--rh-gray-80);
  font-size: 1.05rem;
}

.site-header__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 1rem;
}

.site-header__actions a,
.adjacent-links a,
.quick-links a,
.next-links a {
  text-decoration: none;
}

.site-header__actions kbd,
.adjacent-links kbd,
.quick-links kbd,
.next-links kbd,
.markdown-body a kbd,
.markdown-body kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 2.5rem;
  margin: 0.2rem 0.35rem 0.2rem 0;
  padding: 0.45rem 0.85rem;
  color: var(--rh-gray-90);
  background: #ffffff;
  border: 1px solid var(--rh-gray-80);
  border-radius: 0;
  box-shadow: none;
  font-family: "Red Hat Text", Arial, sans-serif;
  font-size: 0.92rem;
  font-weight: 600;
  white-space: normal;
}

.site-header__actions kbd:hover,
.adjacent-links kbd:hover,
.quick-links kbd:hover,
.next-links kbd:hover,
.markdown-body a kbd:hover,
.markdown-body a kbd:focus,
.markdown-body kbd:hover,
.markdown-body kbd:focus {
  color: #ffffff;
  background: var(--rh-red);
  border-color: var(--rh-red);
}

.page-shell {
  display: grid;
  grid-template-columns: minmax(0, var(--rh-body-width)) minmax(220px, var(--rh-sidebar-width));
  gap: 3rem;
  padding-top: 2rem;
  padding-bottom: 4rem;
}

.content-column {
  min-width: 0;
}

.side-column {
  min-width: 0;
}

.eyebrow {
  margin: 0 0 0.5rem;
  color: var(--rh-gray-70);
  font-size: 0.92rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.adjacent-block,
.toc-block,
.source-block {
  border-top: 1px solid var(--rh-gray-20);
  padding-top: 1rem;
  margin-bottom: 1.75rem;
}

.adjacent-block h2,
.toc-block h2,
.source-block h2 {
  margin: 0 0 0.6rem;
  color: var(--rh-gray-90);
  font-family: "Red Hat Display", "Red Hat Text", Arial, sans-serif;
  font-size: 1.1rem;
  line-height: 1.2;
}

.adjacent-links,
.quick-links,
.next-links {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 0.35rem;
}

.toc-block ul {
  margin: 0;
  padding-left: 1rem;
}

.toc-block li {
  margin: 0.3rem 0;
}

.source-block p {
  margin: 0;
  color: var(--rh-gray-80);
  font-size: 0.95rem;
}

.markdown-body {
  color: var(--rh-gray-90);
  background: #ffffff;
}

.markdown-body h1,
.markdown-body h2,
.markdown-body h3,
.markdown-body h4,
.markdown-body h5,
.markdown-body h6 {
  font-family: "Red Hat Display", "Red Hat Text", Arial, sans-serif;
  color: var(--rh-gray-90);
  font-weight: 500;
  letter-spacing: -0.03em;
  line-height: 1.3;
}

.markdown-body h1 {
  margin-top: 0;
  margin-bottom: 1.25rem;
  padding-top: 0.5rem;
  border-bottom: 0;
  font-size: clamp(2.25rem, 5vw, 4rem);
  line-height: 1.08;
}

.markdown-body h2 {
  margin-top: 2.5rem;
  margin-bottom: 1rem;
  color: var(--rh-red);
  font-size: clamp(1.65rem, 3vw, 2.25rem);
}

.markdown-body h3 {
  margin-top: 1.8rem;
  font-size: 1.3rem;
}

.markdown-body p,
.markdown-body li,
.markdown-body td,
.markdown-body th {
  font-size: 1rem;
  line-height: 1.55;
}

.markdown-body ul,
.markdown-body ol {
  padding-left: 1.25rem;
}

.markdown-body hr {
  height: 1px;
  margin: 2rem 0;
  background: var(--rh-gray-20);
  border: 0;
}

.markdown-body table {
  display: table;
  width: 100%;
  border-collapse: collapse;
  margin: 1rem 0 1.5rem;
}

.markdown-body table th,
.markdown-body table td {
  border: 1px solid var(--rh-gray-20);
  padding: 0.75rem 0.9rem;
  vertical-align: top;
}

.markdown-body table th {
  background: var(--rh-gray-10);
  font-weight: 700;
  text-align: left;
}

.markdown-body code,
.markdown-body pre,
.markdown-body tt {
  font-family: "Red Hat Mono", Consolas, monospace;
}

.markdown-body code {
  background: var(--rh-gray-10);
  border: 1px solid var(--rh-gray-20);
  border-radius: 0;
  padding: 0.08rem 0.28rem;
}

.markdown-body pre {
  padding: 1rem;
  overflow: auto;
  border: 1px solid var(--rh-gray-20);
  border-radius: 0;
  background: var(--rh-gray-10);
}

.markdown-body pre code {
  background: transparent;
  border: 0;
  padding: 0;
}

.markdown-body blockquote {
  margin: 1.25rem 0;
  padding: 0.75rem 1rem;
  color: var(--rh-gray-80);
  border-left: 0.35rem solid var(--rh-gray-30);
}

.admonition {
  border-left-width: 0.35rem;
  border-left-style: solid;
  margin: 1.25rem 0;
  padding: 0.85rem 1rem;
}

.admonition p {
  margin: 0.35rem 0;
}

.admonition-title {
  font-weight: 700;
  margin-bottom: 0.4rem;
}

.admonition-note,
.admonition-tip {
  background: var(--rh-gray-10);
  border-left-color: var(--rh-link);
}

.admonition-important {
  background: #fff4e5;
  border-left-color: #f56a00;
}

.admonition-warning,
.admonition-caution {
  background: var(--rh-red-light);
  border-left-color: var(--rh-red);
}

.markdown-body .mermaid {
  max-width: 100%;
  margin: 1.5rem 0;
  overflow-x: auto;
  border: 1px solid var(--rh-gray-20);
  background: #ffffff;
  padding: 0.85rem;
}

.markdown-body img,
.markdown-body svg {
  max-width: 100%;
  height: auto;
}

.next-section {
  margin-top: 3rem;
  border-top: 1px solid var(--rh-gray-20);
  padding-top: 1rem;
}

.next-section h2 {
  margin: 0 0 0.6rem;
  color: var(--rh-gray-90);
  font-family: "Red Hat Display", "Red Hat Text", Arial, sans-serif;
  font-size: 1.1rem;
}

.site-footer {
  border-top: 1px solid var(--rh-gray-20);
  padding-top: 1.25rem;
  padding-bottom: 2rem;
  color: var(--rh-gray-80);
  font-size: 0.95rem;
}

@media (max-width: 1100px) {
  .page-shell {
    grid-template-columns: 1fr;
    gap: 2rem;
  }

  .side-column {
    order: -1;
  }
}

@media (max-width: 720px) {
  .site-header__inner,
  .site-footer,
  .page-shell {
    padding-left: 1rem;
    padding-right: 1rem;
  }
}
"""


def slug_for(path: Path) -> str:
    if path == ROOT_README:
        return "project-readme"
    if path == PROJECT_README:
        return "readme"
    if path.name == "README.md" and path.parent == DOCS_ROOT:
        return "index"
    return path.stem


def html_name_for(path: Path) -> str:
    slug = slug_for(path)
    return "index.html" if slug == "index" else f"{slug}.html"


def source_label(path: Path) -> str:
    return path.relative_to(REPO_ROOT).as_posix()


def source_url(path: Path) -> str:
    return f"{GITHUB_BLOB_BASE}/{path.relative_to(REPO_ROOT).as_posix()}"


def normalize_list_indentation(text: str) -> str:
    lines = text.splitlines()
    out: list[str] = []
    stack: list[int] = []
    item_pattern = re.compile(r"^(\s*)(?:[-*+]|\d+\.)\s+")

    for raw in lines:
        stripped = raw.lstrip(" ")
        indent = len(raw) - len(stripped)

        if stripped == "":
            out.append(raw)
            continue

        while stack and indent <= stack[-1]:
            stack.pop()

        if stack and indent > stack[-1] and indent < stack[-1] + 4:
            raw = (" " * (stack[-1] + 4)) + stripped
            indent = stack[-1] + 4

        out.append(raw)

        match = item_pattern.match(raw)
        if match:
            item_indent = len(match.group(1))
            while stack and item_indent <= stack[-1]:
                stack.pop()
            stack.append(item_indent)

    return "\n".join(out)


def preprocess_kbd_links(text: str) -> str:
    pattern = re.compile(r'<a href="([^"]+)"><kbd>(.*?)</kbd></a>')

    def repl(match: re.Match[str]) -> str:
        href = quote(match.group(1), safe="")
        label = quote(html.unescape(match.group(2)), safe="")
        return f"[[KBDLINK::{href}::{label}]]"

    return pattern.sub(repl, text)


def preprocess_mermaid(text: str) -> str:
    pattern = re.compile(r"```mermaid\s*\n(.*?)```", re.DOTALL)

    def repl(match: re.Match[str]) -> str:
        content = html.escape(match.group(1).strip())
        return f'<div class="mermaid">\n{content}\n</div>'

    return pattern.sub(repl, text)


def anchor_slug(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return slug or "section"


def build_toc(soup: BeautifulSoup) -> str:
    headings = soup.find_all(["h2", "h3"])
    if not headings:
        return ""
    items: list[str] = ["<ul>"]
    for heading in headings:
        label = heading.get_text(" ", strip=True)
        href = heading.get("id", "")
        if not href:
            continue
        items.append(f'<li><a href="#{href}">{html.escape(label)}</a></li>')
    items.append("</ul>")
    return "\n".join(items)


def restore_kbd_links(soup: BeautifulSoup) -> None:
    pattern = re.compile(r"\[\[KBDLINK::(.*?)::(.*?)\]\]")

    for text_node in list(soup.find_all(string=pattern)):
        parent = text_node.parent
        if parent is None:
            continue
        replacement = BeautifulSoup("", "html.parser")
        cursor = 0
        for match in pattern.finditer(str(text_node)):
            if match.start() > cursor:
                replacement.append(NavigableString(str(text_node)[cursor:match.start()]))
            href = html.escape(unquote(match.group(1)), quote=True)
            label = html.escape(unquote(match.group(2)))
            fragment = BeautifulSoup(
                f'<a href="{href}"><kbd>{label}</kbd></a>',
                "html.parser",
            )
            replacement.append(fragment)
            cursor = match.end()
        if cursor < len(str(text_node)):
            replacement.append(NavigableString(str(text_node)[cursor:]))
        text_node.replace_with(replacement)


def convert_admonitions(soup: BeautifulSoup) -> None:
    pattern = re.compile(r"^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(.*)$", re.DOTALL)
    for blockquote in list(soup.find_all("blockquote")):
        first = blockquote.find("p")
        if first is None:
            continue
        text = first.get_text("\n", strip=True)
        match = pattern.match(text)
        if not match:
            continue
        kind = match.group(1).lower()
        rest = match.group(2).strip()
        wrapper = soup.new_tag("div", attrs={"class": f"admonition admonition-{kind}"})
        title = soup.new_tag("p", attrs={"class": "admonition-title"})
        title.string = kind.title()
        wrapper.append(title)
        first_html = first.decode_contents()
        first_html = re.sub(r"^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*", "", first_html, count=1)
        first.clear()
        if first_html.strip():
            fragment = BeautifulSoup(first_html, "html.parser")
            for child in list(fragment.contents):
                first.append(child.extract())
        else:
            first.decompose()
        for child in list(blockquote.children):
            wrapper.append(child.extract())
        blockquote.replace_with(wrapper)


def normalize_html(soup: BeautifulSoup) -> None:
    restore_kbd_links(soup)
    convert_admonitions(soup)
    for para in list(soup.find_all("p")):
        if para.get_text(" ", strip=True).lower() == "nearby docs:":
            para.decompose()
    seen_ids: set[str] = set()
    for heading in soup.find_all(["h1", "h2", "h3"]):
        if not heading.get("id"):
            candidate = anchor_slug(heading.get_text(" ", strip=True))
            base = candidate
            idx = 2
            while candidate in seen_ids:
                candidate = f"{base}-{idx}"
                idx += 1
            heading["id"] = candidate
        seen_ids.add(heading["id"])

    for pre in soup.find_all("pre"):
        lang = pre.get("lang")
        if lang == "mermaid":
            div = soup.new_tag("div", attrs={"class": "mermaid"})
            code = pre.get_text("\n", strip=True)
            div.string = code
            pre.replace_with(div)


def load_markdown(path: Path) -> tuple[str, str]:
    text = path.read_text(encoding="utf-8")
    text = normalize_list_indentation(text)
    text = preprocess_kbd_links(text)
    text = preprocess_mermaid(text)
    options = Options.CMARK_OPT_UNSAFE | Options.CMARK_OPT_GITHUB_PRE_LANG
    html_body = github_flavored_markdown_to_html(text, options=options)
    soup = BeautifulSoup(html_body, "html.parser")
    normalize_html(soup)
    return str(soup), build_toc(soup)


def rewrite_links(soup: BeautifulSoup, source_path: Path) -> None:
    for tag in soup.find_all(href=True):
        href = tag["href"]
        if href.startswith(("http://", "https://", "mailto:", "#")):
            continue
        path_part, frag = (href.split("#", 1) + [""])[:2]
        candidate = (source_path.parent / path_part).resolve()

        if candidate == ROOT_README:
            new_href = "project-readme.html"
        elif candidate == PROJECT_README:
            new_href = "readme.html"
        elif candidate.suffix == ".md" and candidate.parent == DOCS_ROOT:
            new_href = html_name_for(candidate)
        elif candidate.exists() and candidate.parent == DOCS_ROOT:
            new_href = candidate.name
        elif candidate.exists() and candidate.is_relative_to(REPO_ROOT):
            new_href = source_url(candidate)
        else:
            continue

        if frag:
            new_href = f"{new_href}#{frag}"
        tag["href"] = new_href

    for tag in soup.find_all(src=True):
        src = tag["src"]
        if src.startswith(("http://", "https://", "data:")):
            continue
        candidate = (source_path.parent / src).resolve()
        if candidate.exists() and candidate.parent == DOCS_ROOT:
            tag["src"] = candidate.name


def first_heading(soup: BeautifulSoup) -> str:
    h1 = soup.find("h1")
    return h1.get_text(" ", strip=True) if h1 else "Calabi"


def title_for_slug(slug: str) -> str:
    lookup = {
        "index": "Documentation Map",
        "readme": "Lab README",
        "project-readme": "Calabi",
    }
    if slug in lookup:
        return lookup[slug]
    path = DOCS_ROOT / f"{slug}.md"
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.startswith("# "):
                return line[2:].strip()
    return slug.replace("-", " ").title()


def filename_for_slug(slug: str) -> str:
    return "index.html" if slug == "index" else f"{slug}.html"


def build_adjacent_links(slug: str) -> str:
    links = PAGE_ADJACENCY.get(slug)
    if not links:
        try:
            idx = SITE_ORDER.index(slug)
        except ValueError:
            links = [("Docs Map", "index.html")]
        else:
            dynamic: list[tuple[str, str]] = [("Docs Map", "index.html")]
            if idx > 0:
                prev_slug = SITE_ORDER[idx - 1]
                dynamic.append((title_for_slug(prev_slug), filename_for_slug(prev_slug)))
            if idx + 1 < len(SITE_ORDER):
                next_slug = SITE_ORDER[idx + 1]
                dynamic.append((title_for_slug(next_slug), filename_for_slug(next_slug)))
            links = dynamic
    parts = ["<div class=\"adjacent-links\">"]
    for label, href in links:
        parts.append(f'<a href="{href}"><kbd>{html.escape(label)}</kbd></a>')
    parts.append("</div>")
    return "\n".join(parts)


def build_quick_links() -> str:
    parts = []
    for heading, links in PAGE_GROUPS.items():
        parts.append("<section class=\"adjacent-block\">")
        parts.append(f"<h2>{html.escape(heading)}</h2>")
        parts.append("<div class=\"quick-links\">")
        for label, href in links:
            parts.append(f'<a href="{href}"><kbd>{html.escape(label)}</kbd></a>')
        parts.append("</div></section>")
    return "\n".join(parts)


def render_page(
    *,
    page_title: str,
    description: str,
    body_html: str,
    toc_html: str,
    slug: str,
    source_path: Path,
) -> str:
    adjacent = build_adjacent_links(slug)
    quick = build_quick_links()
    next_links = adjacent
    toc_block = ""
    if toc_html and "<li>" in toc_html:
        toc_block = f"""
<section class="toc-block">
  <h2>On This Page</h2>
  {toc_html}
</section>
"""

    source_block = f"""
<section class="source-block">
  <h2>Source</h2>
  <p><a href="{source_url(source_path)}">{source_label(source_path)}</a></p>
</section>
"""

    return f"""<!DOCTYPE html>
<html lang="en-US">
  <head>
    <meta charset="UTF-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{html.escape(page_title)} | Calabi</title>
    <meta name="description" content="{html.escape(description)}">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Red+Hat+Display:wght@500;700&family=Red+Hat+Mono:wght@400;500&family=Red+Hat+Text:wght@400;500;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="assets/site.css">
    <script type="module">
      import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
      mermaid.initialize({{ startOnLoad: true, theme: 'base', securityLevel: 'loose' }});
    </script>
  </head>
  <body>
    <div class="site-shell">
      <header class="site-header">
        <div class="site-header__inner">
          <p class="eyebrow">Calabi Documentation</p>
          <div class="site-brand">
            <div>
              <h1 class="site-brand__title">Calabi</h1>
              <p class="site-brand__tagline">Single-host disconnected OpenShift on nested KVM, with intent-first docs for architecture, orchestration, auth, and recovery.</p>
            </div>
          </div>
          <div class="site-header__actions">
            <a href="index.html"><kbd>DOCS MAP</kbd></a>
            <a href="readme.html"><kbd>LAB README</kbd></a>
            <a href="automation-flow.html"><kbd>AUTOMATION FLOW</kbd></a>
            <a href="manual-process.html"><kbd>MANUAL PROCESS</kbd></a>
            <a href="authentication-model.html"><kbd>AUTH MODEL</kbd></a>
            <a href="{GITHUB_REPO_URL}"><kbd>GITHUB REPO</kbd></a>
          </div>
        </div>
      </header>
      <main class="page-shell">
        <div class="content-column">
          <section class="adjacent-block">
            <h2>Read Alongside</h2>
            {adjacent}
          </section>
          <article class="markdown-body">
            {body_html}
          </article>
          <section class="next-section">
            <h2>Next Step</h2>
            {next_links}
          </section>
        </div>
        <aside class="side-column">
          {quick}
          {toc_block}
          {source_block}
        </aside>
      </main>
      <footer class="site-footer">
        Generated from repository docs on {dt.date.today().isoformat()}.
      </footer>
    </div>
  </body>
</html>
"""


def first_paragraph_text(soup: BeautifulSoup) -> str:
    for tag in soup.find_all(["p", "li"]):
        if tag.find("kbd"):
            continue
        text = tag.get_text(" ", strip=True)
        if text and not text.lower().startswith("nearby docs"):
            return text
    return "Calabi documentation."


def iter_source_pages() -> Iterable[Path]:
    yield ROOT_README
    yield PROJECT_README
    for path in sorted(DOCS_ROOT.glob("*.md")):
        yield path


def copy_static_assets(output_dir: Path) -> None:
    for asset in DOCS_ROOT.iterdir():
        if asset.suffix.lower() in {".svg", ".png", ".jpg", ".jpeg", ".gif"}:
            shutil.copy2(asset, output_dir / asset.name)


def build_site(output_dir: Path) -> None:
    if output_dir.exists():
        shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True)
    assets_dir = output_dir / "assets"
    assets_dir.mkdir(parents=True)
    (assets_dir / "site.css").write_text(SITE_CSS.strip() + "\n", encoding="utf-8")
    copy_static_assets(output_dir)

    for source_path in iter_source_pages():
        body_html, toc_html = load_markdown(source_path)
        soup = BeautifulSoup(body_html, "html.parser")
        rewrite_links(soup, source_path)
        title = first_heading(soup)
        description = first_paragraph_text(soup)
        slug = slug_for(source_path)
        output_name = html_name_for(source_path)
        rendered = render_page(
            page_title=title,
            description=description,
            body_html=str(soup),
            toc_html=toc_html,
            slug=slug,
            source_path=source_path,
        )
        (output_dir / output_name).write_text(rendered, encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", required=True, type=Path)
    args = parser.parse_args()
    build_site(args.output_dir.resolve())


if __name__ == "__main__":
    main()
