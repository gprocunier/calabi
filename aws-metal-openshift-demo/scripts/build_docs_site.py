#!/usr/bin/env python3
"""Build a static documentation site for Calabi GitHub Pages."""

from __future__ import annotations

import argparse
import html
import re
import shutil
from urllib.parse import quote, unquote
from pathlib import Path
from typing import Iterable

from bs4 import BeautifulSoup, NavigableString
from cmarkgfm import Options, github_flavored_markdown_to_html

from sitebuilder.shell import copy_shell_assets, render_page


REPO_ROOT = Path(__file__).resolve().parents[2]
PROJECT_ROOT = REPO_ROOT / "aws-metal-openshift-demo"
DOCS_ROOT = PROJECT_ROOT / "docs"
ON_PREM_ROOT = REPO_ROOT / "on-prem-openshift-demo"
ON_PREM_DOCS_ROOT = ON_PREM_ROOT / "docs"
ROOT_README = REPO_ROOT / "README.md"
PROJECT_README = PROJECT_ROOT / "README.md"
GITHUB_BLOB_BASE = "https://github.com/gprocunier/calabi/blob/main"
GITHUB_REPO_URL = "https://github.com/gprocunier/calabi"

SITE_ORDER = [
    "index",
    "open-the-lab",
    "docs-map",
    "on-prem-docs-map",
    "on-prem-prerequisites",
    "on-prem-automation-flow",
    "on-prem-manual-process",
    "on-prem-host-sizing-and-resource-policy",
    "on-prem-portability-and-gap-analysis",
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

PATH_SEQUENCES = {
    "AWS Golden Path": [
        "prerequisites",
        "automation-flow",
        "orchestration-plumbing",
        "authentication-model",
        "investigating",
    ],
    "Experimental On-Prem": [
        "on-prem-docs-map",
        "on-prem-prerequisites",
        "on-prem-automation-flow",
        "on-prem-manual-process",
        "docs-map",
    ],
    "Build And Rebuild": [
        "redhat-developer-subscription",
        "openshift-cluster-matrix",
    ],
    "Architecture And Policy": [
        "ad-idm-policy-model",
        "network-topology",
        "iaas-resource-model",
        "host-resource-management",
        "host-memory-oversubscription",
        "odf-declarative-plan",
    ],
    "Operate And Recover": [
        "issues",
        "secrets-and-sanitization",
    ],
    "Change The Code": [
        "orchestration-guide",
        "orchestration-plumbing",
        "automation-flow",
    ],
}

PAGE_PATH = {
    "index": "AWS Golden Path",
    "open-the-lab": "AWS Golden Path",
    "docs-map": "AWS Golden Path",
    "on-prem-docs-map": "Experimental On-Prem",
    "on-prem-prerequisites": "Experimental On-Prem",
    "on-prem-automation-flow": "Experimental On-Prem",
    "on-prem-manual-process": "Experimental On-Prem",
    "prerequisites": "AWS Golden Path",
    "redhat-developer-subscription": "Build And Rebuild",
    "automation-flow": "AWS Golden Path",
    "orchestration-plumbing": "AWS Golden Path",
    "authentication-model": "AWS Golden Path",
    "ad-idm-policy-model": "Architecture And Policy",
    "manual-process": "Teaching Reference",
    "investigating": "AWS Golden Path",
    "issues": "Operate And Recover",
    "secrets-and-sanitization": "Operate And Recover",
    "network-topology": "Architecture And Policy",
    "iaas-resource-model": "Architecture And Policy",
    "host-resource-management": "Architecture And Policy",
    "host-memory-oversubscription": "Architecture And Policy",
    "openshift-cluster-matrix": "Build And Rebuild",
    "odf-declarative-plan": "Architecture And Policy",
    "orchestration-guide": "Teaching Reference",
}

PAGE_ADJACENCY = {
    "index": [
        ("Prerequisites", "prerequisites.html"),
        ("Docs Map", "docs-map.html"),
        ("Automation Flow", "automation-flow.html"),
    ],
    "on-prem-docs-map": [
        ("On-Prem Prerequisites", "on-prem-prerequisites.html"),
        ("On-Prem Automation Flow", "on-prem-automation-flow.html"),
        ("Docs Map", "docs-map.html"),
    ],
    "on-prem-prerequisites": [
        ("On-Prem Docs", "on-prem-docs-map.html"),
        ("On-Prem Automation Flow", "on-prem-automation-flow.html"),
        ("Docs Map", "docs-map.html"),
    ],
    "on-prem-automation-flow": [
        ("On-Prem Prerequisites", "on-prem-prerequisites.html"),
        ("On-Prem Manual Process", "on-prem-manual-process.html"),
        ("Docs Map", "docs-map.html"),
    ],
    "on-prem-manual-process": [
        ("On-Prem Automation Flow", "on-prem-automation-flow.html"),
        ("Docs Map", "docs-map.html"),
        ("Manual Process", "manual-process.html"),
    ],
    "on-prem-host-sizing-and-resource-policy": [
        ("On-Prem Docs", "on-prem-docs-map.html"),
        ("On-Prem Automation Flow", "on-prem-automation-flow.html"),
        ("Docs Map", "docs-map.html"),
    ],
    "on-prem-portability-and-gap-analysis": [
        ("On-Prem Docs", "on-prem-docs-map.html"),
        ("On-Prem Manual Process", "on-prem-manual-process.html"),
        ("Docs Map", "docs-map.html"),
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
    ],
    "manual-process": [
        ("Automation Flow", "automation-flow.html"),
        ("Authentication Model", "authentication-model.html"),
        ("Investigating", "investigating.html"),
    ],
    "orchestration-guide": [
        ("Automation Flow", "automation-flow.html"),
        ("Orchestration Plumbing", "orchestration-plumbing.html"),
        ("Issues Ledger", "issues.html"),
    ],
    "investigating": [
        ("Issues Ledger", "issues.html"),
        ("Manual Process", "manual-process.html"),
        ("Secrets And Sanitization", "secrets-and-sanitization.html"),
    ],
}

PAGE_KIND = {
    "index": ("Overview", "Entry point for the supported AWS deployment path and the surrounding project context."),
    "open-the-lab": ("Overview", "Project-level orientation before dropping into the lab-specific docs."),
    "docs-map": ("Navigation", "Route by task into the supported AWS deployment flow and its adjacent reference material."),
    "on-prem-docs-map": ("Navigation", "Experimental alternate entry path for on-prem host preparation before rejoining the main flow."),
    "prerequisites": ("Build Flow", "Inputs and checks required before starting or repeating the supported AWS build."),
    "redhat-developer-subscription": ("Build Flow", "Subscription setup required for content access in the supported build path."),
    "automation-flow": ("Build Flow", "Primary automation order for building or rebuilding the lab."),
    "manual-process": ("Teaching Reference", "Step-by-step companion reading for understanding what the automation does under the hood."),
    "orchestration-plumbing": ("Build Flow", "Execution-path details for how the automation is staged and run."),
    "authentication-model": ("Architecture", "Supported identity, authorization, and breakglass model for the lab."),
    "ad-idm-policy-model": ("Architecture", "Planned future authorization shape and boundary between AD and IdM."),
    "iaas-resource-model": ("Architecture", "Outer AWS substrate model that the lab stands in for."),
    "network-topology": ("Architecture", "Network segmentation, VLAN intent, and routing shape."),
    "host-resource-management": ("Architecture", "CPU, performance-domain, and host-sizing rationale."),
    "host-memory-oversubscription": ("Architecture", "Memory pressure model and oversubscription policy."),
    "openshift-cluster-matrix": ("Build Flow", "Cluster identity, node inventory, and install-matrix reference."),
    "odf-declarative-plan": ("Architecture", "Storage design intent and planned ODF configuration shape."),
    "orchestration-guide": ("Code Guide", "Where the playbooks, roles, and implementation boundaries live in the repo."),
    "investigating": ("Operate And Recover", "Recovery checkpoints and investigation guidance when the happy path breaks."),
    "issues": ("Operate And Recover", "Known issues and already-fixed problems with commit references."),
    "secrets-and-sanitization": ("Operate And Recover", "Current secret-handling and sanitization model for the repo and lab."),
    "on-prem-prerequisites": ("Experimental Path", "On-prem host requirements before the alternate path can rejoin the main flow."),
    "on-prem-automation-flow": ("Experimental Path", "Automation order for the divergent on-prem bootstrap path."),
    "on-prem-manual-process": ("Experimental Path", "Manual analog for the on-prem branch before the normal Calabi flow resumes."),
    "on-prem-host-sizing-and-resource-policy": ("Experimental Path", "Host resource contract specific to the on-prem branch."),
    "on-prem-portability-and-gap-analysis": ("Experimental Path", "Gaps and portability constraints in the alternate on-prem path."),
}

PAGE_TYPE = {
    "index": ("Golden Path", "golden"),
    "open-the-lab": ("Golden Path", "golden"),
    "docs-map": ("Golden Path", "golden"),
    "prerequisites": ("Golden Path", "golden"),
    "redhat-developer-subscription": ("Golden Path", "golden"),
    "automation-flow": ("Golden Path", "golden"),
    "orchestration-plumbing": ("Golden Path", "golden"),
    "authentication-model": ("Golden Path", "golden"),
    "investigating": ("Golden Path", "golden"),
    "issues": ("Golden Path", "golden"),
    "secrets-and-sanitization": ("Golden Path", "golden"),
    "manual-process": ("Teaching Reference", "teaching"),
    "ad-idm-policy-model": ("Teaching Reference", "teaching"),
    "iaas-resource-model": ("Teaching Reference", "teaching"),
    "network-topology": ("Teaching Reference", "teaching"),
    "host-resource-management": ("Teaching Reference", "teaching"),
    "host-memory-oversubscription": ("Teaching Reference", "teaching"),
    "openshift-cluster-matrix": ("Teaching Reference", "teaching"),
    "odf-declarative-plan": ("Teaching Reference", "teaching"),
    "orchestration-guide": ("Teaching Reference", "teaching"),
    "on-prem-docs-map": ("Experimental", "experimental"),
    "on-prem-prerequisites": ("Experimental", "experimental"),
    "on-prem-automation-flow": ("Experimental", "experimental"),
    "on-prem-manual-process": ("Experimental", "experimental"),
    "on-prem-host-sizing-and-resource-policy": ("Experimental", "experimental"),
    "on-prem-portability-and-gap-analysis": ("Experimental", "experimental"),
}



def slug_for(path: Path) -> str:
    if path == ROOT_README:
        return "index"
    if path == PROJECT_README:
        return "open-the-lab"
    if path.name == "README.md" and path.parent == DOCS_ROOT:
        return "docs-map"
    if path.name == "README.md" and path.parent == ON_PREM_DOCS_ROOT:
        return "on-prem-docs-map"
    if path.parent == ON_PREM_DOCS_ROOT:
        return f"on-prem-{path.stem}"
    return path.stem


def html_name_for(path: Path) -> str:
    slug = slug_for(path)
    return "index.html" if slug == "index" else f"{slug}.html"


def source_label(path: Path) -> str:
    return path.relative_to(REPO_ROOT).as_posix()


def source_url(path: Path) -> str:
    return f"{GITHUB_BLOB_BASE}/{path.relative_to(REPO_ROOT).as_posix()}"


def rewrite_relative_href(href: str, source_path: Path) -> str:
    if href.startswith(("http://", "https://", "mailto:", "#")):
        return href

    path_part, frag = (href.split("#", 1) + [""])[:2]
    candidate = (source_path.parent / path_part).resolve()

    if candidate == ROOT_README:
        new_href = "index.html"
    elif candidate == PROJECT_README:
        new_href = "open-the-lab.html"
    elif candidate.suffix == ".md" and candidate.parent in {DOCS_ROOT, ON_PREM_DOCS_ROOT}:
        new_href = html_name_for(candidate)
    elif candidate.exists() and candidate.parent in {DOCS_ROOT, ON_PREM_DOCS_ROOT}:
        new_href = candidate.name
    elif candidate.exists() and candidate.is_relative_to(REPO_ROOT):
        new_href = source_url(candidate)
    else:
        return href

    if frag:
        new_href = f"{new_href}#{frag}"
    return new_href


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


def body_has_inline_toc(soup: BeautifulSoup) -> bool:
    for heading in soup.find_all(["h2", "h3"]):
        label = heading.get_text(" ", strip=True).lower()
        if label in {"table of contents", "contents"}:
            return True

    main_heading = soup.find("h1")
    limit = 0
    for tag in soup.find_all(["p", "ul", "ol", "h2", "h3"]):
        if main_heading and tag == main_heading:
            continue
        if tag.name in {"h2", "h3"}:
            break
        limit += 1
        if limit > 8:
            break
        if tag.name in {"ul", "ol"}:
            anchors = [a for a in tag.find_all("a", href=True) if a["href"].startswith("#")]
            if len(anchors) >= 4:
                return True
    return False


def extract_header_nav(source_path: Path) -> list[tuple[str, str]]:
    text = source_path.read_text(encoding="utf-8")
    pattern = re.compile(r'<a href="([^"]+)"><kbd>(.*?)</kbd></a>')
    lines = text.splitlines()
    nav_lines: list[str] = []
    capture = False

    for line in lines[:40]:
        stripped = line.strip()
        if not stripped:
            if capture and nav_lines:
                break
            continue
        if stripped.lower() == "nearby docs:":
            capture = True
            continue
        if pattern.search(stripped):
            capture = True
            nav_lines.append(stripped)
            continue
        if capture:
            break

    if not nav_lines:
        return []

    nav: list[tuple[str, str]] = []
    for raw in nav_lines:
        for href, label in pattern.findall(raw):
            clean_label = re.sub(r"\s+", " ", html.unescape(label).replace("\xa0", " ")).strip()
            nav.append((clean_label, rewrite_relative_href(href, source_path)))
    return nav


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


def is_kbd_only_paragraph(tag: BeautifulSoup) -> bool:
    if tag.name != "p":
        return False
    if not tag.find("kbd"):
        return False
    clone = BeautifulSoup(str(tag), "html.parser").p
    if clone is None:
        return False
    for kbd in clone.find_all("kbd"):
        kbd.decompose()
    return clone.get_text(" ", strip=True) == ""


def remove_leading_button_rows(soup: BeautifulSoup, slug: str) -> None:
    first_h2 = soup.find("h2")
    removed_nav = False

    for element in list(soup.contents):
        if element == first_h2:
            break
        if getattr(element, "name", None) == "p" and is_kbd_only_paragraph(element):
            element.decompose()
            removed_nav = True

    if slug == "index" and removed_nav:
        for element in list(soup.contents):
            if element == first_h2:
                break
            if getattr(element, "name", None) == "hr":
                element.decompose()
                break


def trim_landing_page_intro(soup: BeautifulSoup, slug: str) -> None:
    elements = list(soup.contents)

    if slug == "index":
        for element in elements:
            if isinstance(element, NavigableString):
                if not str(element).strip():
                    continue
                break
            name = getattr(element, "name", None)
            if name == "h1":
                element.decompose()
                continue
            if name == "p":
                text = element.get_text(" ", strip=True)
                if text.startswith("A single-host, fully disconnected OpenShift 4 lab"):
                    element.decompose()
                    continue
                if text.startswith("Deploy a production-patterned OpenShift cluster"):
                    element.decompose()
                    continue
            break

    if slug == "open-the-lab":
        for element in elements:
            if isinstance(element, NavigableString):
                if not str(element).strip():
                    continue
                break
            name = getattr(element, "name", None)
            if name == "h1":
                element.decompose()
                continue
            if name == "p":
                text = element.get_text(" ", strip=True)
                if text.startswith("Use the navigation buttons below to jump straight"):
                    element.decompose()
                    continue
            break


def remove_nearby_docs_nav(soup: BeautifulSoup) -> None:
    for para in list(soup.find_all("p")):
        if para.get_text(" ", strip=True).lower() != "nearby docs:":
            continue
        next_para = para.find_next_sibling("p")
        para.decompose()
        if next_para and is_kbd_only_paragraph(next_para):
            next_para.decompose()
        break


def remove_index_launch_grid(soup: BeautifulSoup) -> None:
    for element in soup.find_all(["p", "h2"]):
        if element.name == "h2":
            break
        if element.name == "p" and is_kbd_only_paragraph(element):
            element.decompose()
            break


def normalize_html(soup: BeautifulSoup, slug: str) -> None:
    restore_kbd_links(soup)
    convert_admonitions(soup)
    remove_nearby_docs_nav(soup)
    remove_leading_button_rows(soup, slug)
    trim_landing_page_intro(soup, slug)

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
            continue
        if lang:
            code = pre.find("code")
            if code is not None:
                existing = code.get("class", [])
                lang_class = f"language-{lang}"
                if lang_class not in existing:
                    code["class"] = existing + [lang_class]
            del pre["lang"]


def load_markdown(path: Path) -> tuple[str, str]:
    text = path.read_text(encoding="utf-8")
    text = normalize_list_indentation(text)
    text = preprocess_kbd_links(text)
    options = Options.CMARK_OPT_UNSAFE | Options.CMARK_OPT_GITHUB_PRE_LANG
    html_body = github_flavored_markdown_to_html(text, options=options)
    soup = BeautifulSoup(html_body, "html.parser")
    normalize_html(soup, slug_for(path))
    return str(soup), build_toc(soup)


def rewrite_links(soup: BeautifulSoup, source_path: Path) -> None:
    for tag in soup.find_all(href=True):
        href = tag["href"]
        new_href = rewrite_relative_href(href, source_path)
        if new_href == href and not href.startswith(("http://", "https://", "mailto:", "#")):
            continue
        tag["href"] = new_href

    for tag in soup.find_all(src=True):
        src = tag["src"]
        if src.startswith(("http://", "https://", "data:")):
            continue
        candidate = (source_path.parent / src).resolve()
        if candidate.exists() and candidate.parent == DOCS_ROOT:
            tag["src"] = candidate.name


def link_repo_paths(soup: BeautifulSoup) -> None:
    path_pattern = re.compile(
        r"^(?:\./)?(?:"
        r"aws-metal-openshift-demo|on-prem-openshift-demo|cloudformation|cockpit|docs|inventory|playbooks|roles|scripts|vars|\.githooks"
        r")(?:/|$)"
    )

    def normalize_candidate_text(text: str) -> str | None:
        candidate_text = text.strip()
        if not candidate_text:
            return None

        candidate_text = re.sub(r"^<(?:project-root|repo-root)>/", "", candidate_text)
        if candidate_text.startswith("./"):
            candidate_text = candidate_text[2:]

        if "*" in candidate_text:
            prefix = candidate_text.split("*", 1)[0]
            if "/" not in prefix:
                return None
            if not prefix.endswith("/"):
                prefix = prefix.rsplit("/", 1)[0] + "/"
            candidate_text = prefix

        return candidate_text or None

    def repo_link_target(text: str) -> Path | None:
        candidate_text = normalize_candidate_text(text)
        if candidate_text is None or not path_pattern.match(candidate_text):
            return None

        for root in (PROJECT_ROOT, REPO_ROOT):
            candidate = (root / candidate_text).resolve()
            if candidate.exists() and candidate.is_relative_to(REPO_ROOT):
                return candidate
        return None

    for code in list(soup.find_all("code")):
        if code.find_parent("pre"):
            continue
        if code.find_parent("a"):
            continue

        text = code.get_text(strip=True)
        candidate = repo_link_target(text)
        if candidate is None:
            continue

        anchor = soup.new_tag("a", href=source_url(candidate))
        new_code = soup.new_tag("code")
        new_code.string = text
        anchor.append(new_code)
        code.replace_with(anchor)


def render_execution_contexts(soup: BeautifulSoup) -> None:
    contexts = {
        "RUN LOCALLY": "local",
        "RUN ON BASTION": "bastion",
        "RUN ON GUEST": "guest",
    }

    def badge_for(label: str):
        badge = soup.new_tag(
            "span",
            attrs={"class": ["execution-context-badge", f"execution-context-badge--{contexts[label]}"]},
        )
        badge.string = label
        return badge

    for li in soup.find_all("li"):
        if li.find_parent("pre"):
            continue
        code = li.find("code", recursive=False)
        if code is None:
            continue
        label = code.get_text(" ", strip=True)
        if label not in contexts:
            continue

        code.replace_with(badge_for(label))

    for li in soup.find_all("li"):
        direct_badge = li.find("span", class_="execution-context-badge", recursive=False)
        if direct_badge is None:
            existing = [name for name in li.get("class", []) if name not in {"execution-context-inline", "execution-context-only"}]
            if existing:
                li["class"] = existing
            elif li.has_attr("class"):
                del li["class"]
            continue

        meaningful_children = []
        for child in li.contents:
            if isinstance(child, NavigableString) and not child.strip():
                continue
            meaningful_children.append(child)

        classes = [name for name in li.get("class", []) if name not in {"execution-context-inline", "execution-context-only"}]
        if len(meaningful_children) == 1 and meaningful_children[0] is direct_badge:
            li["class"] = classes + ["execution-context-only"]
        else:
            li["class"] = classes + ["execution-context-inline"]

    for ul in list(soup.find_all("ul")):
        direct_items = ul.find_all("li", recursive=False)
        if not direct_items or not all("execution-context-only" in item.get("class", []) for item in direct_items):
            continue
        row = soup.new_tag("div", attrs={"class": ["execution-context-row"]})
        for item in direct_items:
            for child in list(item.contents):
                row.append(child.extract())
        ul.replace_with(row)

    for li in soup.find_all("li"):
        direct_context_row = li.find("div", class_="execution-context-row", recursive=False)
        if direct_context_row is None:
            continue
        for child in list(li.contents):
            if isinstance(child, NavigableString) and child.strip() == "Example:":
                child.extract()
        li["class"] = li.get("class", []) + ["example-block"]


def first_heading(soup: BeautifulSoup) -> str:
    h1 = soup.find("h1")
    return h1.get_text(" ", strip=True) if h1 else "Calabi"


def title_for_slug(slug: str) -> str:
    lookup = {
        "index": "Calabi",
        "open-the-lab": "Open The Lab",
        "docs-map": "Documentation Map",
        "on-prem-docs-map": "On-Prem Documentation",
    }
    if slug in lookup:
        return lookup[slug]
    path = source_path_for_slug(slug)
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.startswith("# "):
                return line[2:].strip()
    return slug.replace("-", " ").title()


def source_path_for_slug(slug: str) -> Path:
    if slug == "index":
        return ROOT_README
    if slug == "open-the-lab":
        return PROJECT_README
    if slug == "docs-map":
        return DOCS_ROOT / "README.md"
    if slug == "on-prem-docs-map":
        return ON_PREM_DOCS_ROOT / "README.md"
    if slug.startswith("on-prem-"):
        return ON_PREM_DOCS_ROOT / f"{slug.removeprefix('on-prem-')}.md"
    return DOCS_ROOT / f"{slug}.md"


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
    links = links[:3]
    parts = ["<div class=\"adjacent-links\">"]
    for label, href in links:
        parts.append(f'<a href="{href}"><kbd>{html.escape(label)}</kbd></a>')
    parts.append("</div>")
    return "\n".join(parts)


def page_path_name(slug: str) -> str | None:
    return PAGE_PATH.get(slug)


def page_kind_for_slug(slug: str) -> tuple[str, str]:
    return PAGE_KIND.get(slug, ("Guide", "Supporting Calabi documentation."))


def page_type_for_slug(slug: str) -> tuple[str, str]:
    return PAGE_TYPE.get(slug, ("Teaching Reference", "teaching"))


def page_type_label(label: str, css_class: str) -> str:
    return f'<span class="page-type-label page-type-label--{css_class}">{html.escape(label)}</span>'


def page_sequence(slug: str) -> list[str]:
    path_name = page_path_name(slug)
    if not path_name:
        return []
    return PATH_SEQUENCES.get(path_name, [])


def build_path_block(slug: str) -> str:
    sequence = page_sequence(slug)
    if not sequence:
        return ""

    items = []
    for position, seq_slug in enumerate(sequence, start=1):
        current_class = " class=\"is-current\"" if seq_slug == slug else ""
        items.append(
            f'<li{current_class}><a href="{filename_for_slug(seq_slug)}">'
            f"<strong>{html.escape(title_for_slug(seq_slug))}</strong>"
            f"<span>Step {position} of {len(sequence)}</span>"
            "</a></li>"
        )

    return f"""
<section class="context-block">
  <h2>AWS Deployment Path</h2>
  <ul class="path-list">
    {''.join(items)}
  </ul>
</section>
"""


def pager_for_slug(slug: str) -> tuple[tuple[str, str] | None, tuple[str, str] | None]:
    sequence = page_sequence(slug)
    if not sequence or slug not in sequence:
        return None, None
    idx = sequence.index(slug)
    prev_item = None
    next_item = None
    if idx > 0:
        prev_slug = sequence[idx - 1]
        prev_item = (title_for_slug(prev_slug), filename_for_slug(prev_slug))
    if idx + 1 < len(sequence):
        next_slug = sequence[idx + 1]
        next_item = (title_for_slug(next_slug), filename_for_slug(next_slug))
    return prev_item, next_item


def build_pager(slug: str) -> str:
    prev_item, next_item = pager_for_slug(slug)
    if not prev_item and not next_item:
        return ""

    items: list[str] = []
    if prev_item:
        label, href = prev_item
        items.append(
            f'<li><a href="{href}"><strong>Previous</strong><span>{html.escape(label)}</span></a></li>'
        )
    if next_item:
        label, href = next_item
        items.append(
            f'<li><a href="{href}"><strong>Next</strong><span>{html.escape(label)}</span></a></li>'
        )

    return f"""
<section class="next-section">
  <h2>Continue</h2>
  <ul class="pager-list">
    {''.join(items)}
  </ul>
</section>
"""


def build_breadcrumbs(slug: str) -> str:
    if slug == "index":
        return ""

    crumbs = ['<nav class="page-breadcrumbs" aria-label="Breadcrumb">']
    crumbs.append('<a href="index.html">Home</a>')
    if slug != "docs-map":
        crumbs.append("<span>/</span>")
        crumbs.append('<a href="docs-map.html">Docs Map</a>')
    page_kind, _ = page_kind_for_slug(slug)
    crumbs.append("<span>/</span>")
    crumbs.append(f'<span aria-current="page">{html.escape(page_kind)}</span>')
    crumbs.append("</nav>")
    return "".join(crumbs)


def build_page_meta(slug: str) -> str:
    if slug == "index":
        return ""
    page_kind, summary = page_kind_for_slug(slug)
    page_type, page_type_class = page_type_for_slug(slug)
    return f"""
<div class="page-meta">
  <span class="context-type">{page_type_label(page_type, page_type_class)}</span>
  <p class="page-kind">{html.escape(page_kind)}</p>
  <p class="page-summary">{html.escape(summary)}</p>
</div>
"""


def build_other_entry_points_block(slug: str) -> str:
    links = [
        ("Manual Process", "manual-process.html", "Teaching reference for understanding the automation under the hood."),
        ("On-Prem Docs", "on-prem-docs-map.html", "Experimental developer sandbox. Not the supported deployment path."),
    ]

    items = []
    for label, href, summary in links:
        current = ' aria-current="page"' if filename_for_slug(slug) == href else ""
        target_slug = href.removesuffix('.html') if href.endswith('.html') else slug
        page_type, page_type_class = page_type_for_slug(target_slug)
        items.append(
            f'<li><a href="{href}"{current}><strong>{html.escape(label)}</strong>'
            f'<span><span class="entry-point-type">{page_type_label(page_type, page_type_class)}</span> {html.escape(summary)}</span></a></li>'
        )

    return f"""
<section class="context-block context-block--secondary">
  <h2>Other Entry Points</h2>
  <ul class="path-list">
    {''.join(items)}
  </ul>
</section>
"""


def build_nearby_block(slug: str) -> str:
    links = PAGE_ADJACENCY.get(slug)
    if not links:
        return ""

    items = []
    for label, href in links[:3]:
        current = ' aria-current="page"' if filename_for_slug(slug) == href else ""
        target_slug = href.removesuffix('.html') if href.endswith('.html') else slug
        page_type, page_type_class = page_type_for_slug(target_slug)
        items.append(
            f'<li><a href="{href}"{current}><strong>{html.escape(label)}</strong>'
            f'<span><span class="entry-point-type">{page_type_label(page_type, page_type_class)}</span> Curated nearby page for the next likely jump.</span></a></li>'
        )

    return f"""
<section class="context-block">
  <h2>Nearby Docs</h2>
  <ul class="path-list">
    {''.join(items)}
  </ul>
</section>
"""


def build_project_links_block(source_path: Path) -> str:
    return f"""
<section class="context-block">
  <h2>Project Links</h2>
  <ul class="path-list">
    <li><a href="{GITHUB_REPO_URL}"><strong>GitHub Repo</strong><span>Repository root, releases, and project context.</span></a></li>
    <li><a href="{source_url(source_path)}"><strong>Current Source File</strong><span>Exact markdown source for this generated page.</span></a></li>
  </ul>
</section>
"""


def build_page_type_block(slug: str) -> str:
    page_kind, summary = page_kind_for_slug(slug)
    page_type, page_type_class = page_type_for_slug(slug)
    return f"""
<section class="context-block context-block--meta context-block--{page_type_class}">
  <h2>Page Type</h2>
  <p class="context-kicker">{page_type_label(page_type, page_type_class)}</p>
  <p class="context-copy"><strong>{html.escape(page_kind)}.</strong> {html.escape(summary)}</p>
</section>
"""


def build_side_context(slug: str, source_path: Path) -> str:
    blocks = [build_page_type_block(slug)]
    workflow_block = build_path_block(slug)
    if workflow_block:
        blocks.append(workflow_block)
    blocks.append(build_other_entry_points_block(slug))
    nearby_block = build_nearby_block(slug)
    if nearby_block:
        blocks.append(nearby_block)
    blocks.append(build_project_links_block(source_path))
    return "".join(blocks)


def build_toc_block(body_html: str, toc_html: str) -> str:
    if not toc_html or "<li>" not in toc_html:
        return ""
    soup_for_toc = BeautifulSoup(body_html, "html.parser")
    if body_has_inline_toc(soup_for_toc):
        return ""
    return f"""
<section class="toc-block">
  <h2>On This Page</h2>
  {toc_html}
</section>
"""


def build_page_banner_html(slug: str) -> str:
    if slug == "manual-process":
        return """
<section class="page-banner page-banner--teaching">
  <strong>Teaching reference.</strong>
  This page explains what the automation does step by step. Do not follow it as the primary build path; use <a href="automation-flow.html">Automation Flow</a> for the supported deployment sequence.
</section>
"""
    if slug.startswith("on-prem-"):
        return """
<section class="page-banner page-banner--experimental">
  <strong>Experimental.</strong>
  The on-prem path is an unvalidated developer sandbox. For the supported deployment, use the <a href="docs-map.html">AWS docs map</a> and follow the golden path from there.
</section>
"""
    return ""


def build_source_block(slug: str, source_path: Path) -> str:
    if slug in {"index", "open-the-lab", "docs-map", "on-prem-docs-map"}:
        return ""
    return f"""
<section class="source-block">
  <h2>Source</h2>
  <p><a href="{source_url(source_path)}">{source_label(source_path)}</a></p>
</section>
"""


def build_header_nav_html(source_path: Path) -> str:
    links = [
        ("Docs Map", "docs-map.html"),
        ("GitHub", GITHUB_REPO_URL),
    ]
    return "".join(
        f'<a href="{href}"><kbd>{html.escape(label)}</kbd></a>'
        for label, href in links
    )


def first_paragraph_text(soup: BeautifulSoup) -> str:
    for tag in soup.find_all(["p", "li"]):
        classes = set(tag.get("class", []))
        if "admonition-title" in classes:
            continue
        if tag.find_parent(class_=re.compile(r"\badmonition\b")):
            continue
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
    for path in sorted(ON_PREM_DOCS_ROOT.glob("*.md")):
        yield path


def copy_static_assets(output_dir: Path) -> None:
    for docs_root in (DOCS_ROOT, ON_PREM_DOCS_ROOT):
        for asset in docs_root.iterdir():
            if asset.suffix.lower() in {".svg", ".png", ".jpg", ".jpeg", ".gif"}:
                shutil.copy2(asset, output_dir / asset.name)


def build_site(output_dir: Path) -> None:
    if output_dir.exists():
        shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True)
    assets_dir = output_dir / "assets"
    assets_dir.mkdir(parents=True)
    copy_shell_assets(assets_dir)
    copy_static_assets(output_dir)

    for source_path in iter_source_pages():
        body_html, toc_html = load_markdown(source_path)
        soup = BeautifulSoup(body_html, "html.parser")
        rewrite_links(soup, source_path)
        link_repo_paths(soup)
        render_execution_contexts(soup)
        slug = slug_for(source_path)
        title = title_for_slug(slug)
        description = first_paragraph_text(soup)
        output_name = html_name_for(source_path)
        rendered_body = str(soup)
        rendered = render_page(
            page_title=title,
            description=description,
            body_html=rendered_body,
            breadcrumbs_html=build_breadcrumbs(slug),
            page_meta_html=build_page_meta(slug),
            page_banner_html=build_page_banner_html(slug),
            header_nav_html=build_header_nav_html(source_path),
            side_context_html=build_side_context(slug, source_path),
            toc_block=build_toc_block(rendered_body, toc_html),
            source_block=build_source_block(slug, source_path),
            pager_block=build_pager(slug) if slug != "index" else "",
            is_experimental=slug.startswith("on-prem-"),
        )
        (output_dir / output_name).write_text(rendered, encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", required=True, type=Path)
    args = parser.parse_args()
    build_site(args.output_dir.resolve())


if __name__ == "__main__":
    main()
