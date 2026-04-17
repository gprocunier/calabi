"""Code-block conversion helpers for the Calabi docs site."""

from __future__ import annotations

from bs4 import BeautifulSoup
from pygments import lex
from pygments.lexers import BashLexer, PowerShellLexer
from pygments.token import Token

LANGUAGE_ALIASES = {
    "": "plain",
    "bash": "bash",
    "console": "bash",
    "shell": "bash",
    "sh": "bash",
    "powershell": "powershell",
    "ps1": "powershell",
    "pwsh": "powershell",
    "plaintext": "plain",
    "text": "plain",
}

LEXERS = {
    "bash": BashLexer(),
    "powershell": PowerShellLexer(),
}

TOKEN_CLASS_MAP = [
    (Token.Comment, "comment"),
    (Token.Keyword, "keyword"),
    (Token.Name.Builtin, "builtin"),
    (Token.Name.Function, "function"),
    (Token.Name.Class, "class-name"),
    (Token.Name.Namespace, "namespace"),
    (Token.Name.Attribute, "attr-name"),
    (Token.Name.Tag, "tag"),
    (Token.Name.Entity, "entity"),
    (Token.Name.Variable, "variable"),
    (Token.Name.Constant, "constant"),
    (Token.Literal.String, "string"),
    (Token.Literal.Number, "number"),
    (Token.Operator, "operator"),
    (Token.Punctuation, "punctuation"),
    (Token.Generic.Deleted, "deleted"),
    (Token.Generic.Inserted, "inserted"),
]


def normalize_language(language: str | None) -> str:
    raw = (language or "").strip().lower()
    return LANGUAGE_ALIASES.get(raw, raw or "plain")



def prism_class_for_token(token_type: Token) -> str | None:
    for pygments_type, prism_class in TOKEN_CLASS_MAP:
        if token_type in pygments_type:
            return prism_class
    return None



def extract_pre_language(pre_tag) -> str:
    for tag in filter(None, [pre_tag, pre_tag.find("code")]):
        for class_name in tag.get("class", []):
            if class_name.startswith("language-"):
                return normalize_language(class_name.removeprefix("language-"))
    return "plain"



def append_prerendered_tokens(*, soup: BeautifulSoup, code_tag, raw_code: str, language: str) -> None:
    lexer = LEXERS.get(language)
    if lexer is None:
        code_tag.string = raw_code
        return

    for token_type, value in lex(raw_code, lexer):
        if not value:
            continue
        prism_class = prism_class_for_token(token_type)
        if prism_class is None:
            code_tag.append(value)
            continue
        span = soup.new_tag("span", attrs={"class": f"token {prism_class}"})
        span.string = value
        code_tag.append(span)



def replace_fenced_code_blocks(soup: BeautifulSoup) -> None:
    for pre_tag in list(soup.find_all("pre")):
        if pre_tag.find_parent("rh-code-block"):
            continue

        language = extract_pre_language(pre_tag)
        raw_code = pre_tag.get_text()
        block_language = language if language != "plain" else "text"

        wrapper = soup.new_tag(
            "rh-code-block",
            attrs={
                "actions": "copy wrap",
                "line-numbers": "hidden",
            },
        )
        if language in LEXERS:
            wrapper["highlighting"] = "prerendered"

        new_pre = soup.new_tag("pre", attrs={"class": f"language-{block_language}"})
        new_code = soup.new_tag("code", attrs={"class": f"language-{block_language}"})
        append_prerendered_tokens(soup=soup, code_tag=new_code, raw_code=raw_code, language=language)
        new_pre.append(new_code)
        wrapper.append(new_pre)
        pre_tag.replace_with(wrapper)
