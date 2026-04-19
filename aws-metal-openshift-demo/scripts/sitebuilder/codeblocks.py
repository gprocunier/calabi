"""Code-block conversion helpers for the Calabi docs site."""

from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

from bs4 import BeautifulSoup
from pygments.lexers import ClassNotFound, guess_lexer

DEFAULT_LANGUAGE = "bash"
SHIKI_THEME = "github-dark-high-contrast"
PROJECT_ROOT = Path(__file__).resolve().parents[2]
SHIKI_HELPER = Path(__file__).resolve().with_name("shiki_highlight.mjs")

LANGUAGE_ALIASES = {
    "": "text",
    "bash": "bash",
    "console": "bash",
    "plaintext": "text",
    "powershell": "powershell",
    "ps1": "powershell",
    "pwsh": "powershell",
    "python": "python",
    "py": "python",
    "javascript": "javascript",
    "js": "javascript",
    "json": "json",
    "shell": "bash",
    "sh": "bash",
    "text": "text",
    "toml": "toml",
    "ts": "typescript",
    "typescript": "typescript",
    "xml": "xml",
    "html": "html",
    "xhtml": "html",
    "svg": "xml",
    "yaml": "yaml",
    "yml": "yaml",
}

POWERSHELL_MARKERS = (
    "write-host",
    "get-ad",
    "get-childitem",
    "new-",
    "set-",
    "add-",
    "remove-",
    "restart-",
    "stop-",
    "start-",
    "out-null",
    "$env:",
    "$psscriptroot",
    "-erroraction",
)

YAML_LINE_RE = re.compile(r"^\s*([A-Za-z0-9_.-]+:|- [A-Za-z0-9_.-]+:)")

LANGUAGE_LABELS = {
    "bash": "Shell",
    "html": "HTML",
    "javascript": "JavaScript",
    "json": "JSON",
    "powershell": "PowerShell",
    "python": "Python",
    "text": "Text",
    "toml": "TOML",
    "typescript": "TypeScript",
    "xml": "XML",
    "yaml": "YAML",
}


def normalize_language(language: str | None) -> str:
    raw = (language or "").strip().lower()
    return LANGUAGE_ALIASES.get(raw, raw or "text")


def extract_pre_language(pre_tag) -> tuple[str, bool]:
    for tag in filter(None, [pre_tag, pre_tag.find("code")]):
        for class_name in tag.get("class", []):
            if class_name.startswith("language-"):
                return normalize_language(class_name.removeprefix("language-")), True
    return "text", False


def infer_language(raw_code: str) -> str:
    stripped = raw_code.strip()
    if not stripped:
        return DEFAULT_LANGUAGE

    lowered = stripped.lower()

    if stripped.startswith("#!") and ("bash" in lowered or "/sh" in lowered):
        return "bash"

    if any(marker in lowered for marker in POWERSHELL_MARKERS):
        return "powershell"

    if (stripped.startswith("{") or stripped.startswith("[")) and _looks_like_json(stripped):
        return "json"

    if _looks_like_yaml(stripped):
        return "yaml"

    if _looks_like_html_or_xml(stripped):
        return "html" if stripped.lstrip().startswith("<!doctype html") or "<html" in lowered else "xml"

    if _looks_like_python(stripped):
        return "python"

    if _looks_like_javascript_or_typescript(stripped):
        return "typescript" if _looks_like_typescript(stripped) else "javascript"

    try:
        lexer = guess_lexer(stripped)
    except ClassNotFound:
        return DEFAULT_LANGUAGE

    for alias in getattr(lexer, "aliases", []):
        normalized = normalize_language(alias)
        if normalized in {"bash", "powershell", "python", "javascript", "typescript", "json", "yaml", "html", "xml", "toml"}:
            return normalized

    return DEFAULT_LANGUAGE


def _looks_like_json(text: str) -> bool:
    try:
        json.loads(text)
    except json.JSONDecodeError:
        return False
    return True


def _looks_like_yaml(text: str) -> bool:
    lines = [line for line in text.splitlines() if line.strip()]
    if not lines:
        return False
    score = sum(1 for line in lines[:8] if YAML_LINE_RE.match(line))
    return score >= 2 or ("apiversion:" in text.lower() and "kind:" in text.lower())


def _looks_like_html_or_xml(text: str) -> bool:
    candidate = text.lstrip()
    return candidate.startswith("<?xml") or (candidate.startswith("<") and "</" in candidate and ">" in candidate)


def _looks_like_python(text: str) -> bool:
    return (
        "def " in text
        or "import " in text
        or "from " in text
        or "print(" in text
        or text.startswith("#!/usr/bin/env python")
    )


def _looks_like_javascript_or_typescript(text: str) -> bool:
    markers = ("const ", "let ", "function ", "=>", "console.log(", "export ", "import ")
    return any(marker in text for marker in markers)


def _looks_like_typescript(text: str) -> bool:
    markers = (": string", ": number", ": boolean", "interface ", "type ", " as const")
    return any(marker in text for marker in markers)


def run_shiki_highlighter(blocks: list[dict[str, str]]) -> list[dict[str, str]]:
    payload = json.dumps(
        {
            "theme": SHIKI_THEME,
            "fallbackLanguage": DEFAULT_LANGUAGE,
            "blocks": blocks,
        }
    )
    result = subprocess.run(
        ["node", str(SHIKI_HELPER)],
        cwd=PROJECT_ROOT,
        input=payload,
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        stderr = result.stderr.strip()
        hint = ""
        if "Cannot find package 'shiki'" in stderr or "ERR_MODULE_NOT_FOUND" in stderr:
            hint = " Run `npm install` in the project root to install the docs highlighter dependency."
        raise RuntimeError(f"Shiki highlighting failed.{hint}\n{stderr}")
    return json.loads(result.stdout)


def ensure_language_class(tag, language: str) -> None:
    classes = tag.get("class", [])
    lang_class = f"language-{language}"
    if lang_class not in classes:
        tag["class"] = [*classes, lang_class]


def language_label(language: str) -> str:
    return LANGUAGE_LABELS.get(language, language.upper())


def replace_fenced_code_blocks(soup: BeautifulSoup) -> None:
    pending: list[tuple[object, dict[str, str]]] = []

    for pre_tag in list(soup.find_all("pre")):
        if pre_tag.find_parent("rh-code-block"):
            continue

        language, is_explicit = extract_pre_language(pre_tag)
        raw_code = pre_tag.get_text()
        requested_language = language if is_explicit else infer_language(raw_code)
        pending.append((pre_tag, {"code": raw_code, "language": requested_language}))

    if not pending:
        return

    highlighted = run_shiki_highlighter([payload for _, payload in pending])

    for (pre_tag, _), rendered in zip(pending, highlighted, strict=True):
        final_language = normalize_language(rendered.get("language"))
        fragment = BeautifulSoup(rendered["html"], "html.parser")
        new_pre = fragment.find("pre")
        if new_pre is None:
            new_pre = soup.new_tag("pre")
            new_code = soup.new_tag("code")
            new_code.string = pre_tag.get_text()
            new_pre.append(new_code)

        new_code = new_pre.find("code")
        ensure_language_class(new_pre, final_language)
        if new_code is not None:
            ensure_language_class(new_code, final_language)

        wrapper = soup.new_tag(
            "div",
            attrs={
                "class": "codebox",
                "data-language": final_language,
                "data-theme": SHIKI_THEME,
            },
        )
        toolbar = soup.new_tag("div", attrs={"class": "codebox__toolbar"})
        label = soup.new_tag("span", attrs={"class": "codebox__language"})
        label.string = language_label(final_language)
        copy_button = soup.new_tag(
            "button",
            attrs={
                "class": "codebox__copy",
                "type": "button",
                "aria-label": f"Copy {language_label(final_language)} code to clipboard",
                "data-copy-state": "idle",
            },
        )
        copy_button.append(
            BeautifulSoup(
                """
<span class="codebox__copy-icon" aria-hidden="true">
  <svg viewBox="0 0 16 16" focusable="false">
    <path d="M5 1.75A1.75 1.75 0 0 1 6.75 0h5.5A1.75 1.75 0 0 1 14 1.75v7.5A1.75 1.75 0 0 1 12.25 11h-5.5A1.75 1.75 0 0 1 5 9.25zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h5.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25z"></path>
    <path d="M2.75 4A1.75 1.75 0 0 0 1 5.75v7.5C1 14.217 1.784 15 2.75 15h5.5A1.75 1.75 0 0 0 10 13.25V13H8.5v.25a.25.25 0 0 1-.25.25h-5.5a.25.25 0 0 1-.25-.25v-7.5a.25.25 0 0 1 .25-.25H3V4z"></path>
  </svg>
</span>
                """,
                "html.parser",
            )
        )
        copy_label = soup.new_tag("span", attrs={"class": "codebox__copy-label"})
        copy_label.string = "Copy"
        copy_button.append(copy_label)
        toolbar.append(label)
        toolbar.append(copy_button)
        wrapper.append(toolbar)
        wrapper.append(new_pre)
        pre_tag.replace_with(wrapper)
