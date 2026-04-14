"""Shared shell rendering for the Calabi docs site."""

from __future__ import annotations

import datetime as dt
import html
import shutil
from pathlib import Path


ASSET_DIR = Path(__file__).resolve().parent / "assets"


def copy_shell_assets(output_dir: Path) -> None:
    """Copy shared shell assets into the generated site."""
    for asset_name in ("site.css", "site.js"):
        shutil.copy2(ASSET_DIR / asset_name, output_dir / asset_name)


def render_page(
    *,
    page_title: str,
    description: str,
    body_html: str,
    breadcrumbs_html: str = "",
    page_meta_html: str = "",
    header_nav_html: str = "",
    side_context_html: str = "",
    toc_block: str = "",
    source_block: str = "",
    pager_block: str = "",
    is_experimental: bool = False,
) -> str:
    """Render a complete Calabi docs page around prebuilt content blocks."""
    experimental_banner = ""
    site_shell_class = "site-shell"
    if is_experimental:
        site_shell_class += " site-shell--experimental"
        experimental_banner = """
          <div class="experimental-banner">
            <strong>Experimental On-Prem Path.</strong>
            Use these pages only for the divergent early host and bastion-staging steps, then return to the main Calabi docs once the normal flow resumes.
          </div>
"""

    full_title = html.escape(page_title if page_title == "Calabi" else f"{page_title} | Calabi")

    return f"""<!DOCTYPE html>
<html lang="en-US">
  <head>
    <meta charset="UTF-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{full_title}</title>
    <meta name="description" content="{html.escape(description)}">
    <meta name="google-site-verification" content="-cAcLaA0l0O_JyCuMrNDwKoISaFm8JtOsfjnvXLGgA4">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Red+Hat+Display:wght@500;700&family=Red+Hat+Mono:wght@400;500&family=Red+Hat+Text:wght@400;500;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="assets/site.css">
    <script type="module" src="assets/site.js"></script>
  </head>
  <body>
    <div class="{site_shell_class}">
      <header class="site-header">
        <div class="site-header__inner">
          <p class="eyebrow">Calabi Documentation</p>
          <div class="site-brand">
            <div>
              <h1 class="site-brand__title"><a href="index.html">Calabi</a></h1>
              <p class="site-brand__tagline">Single-host disconnected OpenShift on nested KVM, with intent-first docs for architecture, orchestration, auth, and recovery.</p>
            </div>
          </div>
          <div class="site-header__actions">
            {header_nav_html}
          </div>
{experimental_banner}
        </div>
      </header>
      <main class="page-shell">
        <div class="content-column">
          <article class="markdown-body">
            {breadcrumbs_html}
            {page_meta_html}
            {body_html}
          </article>
          {pager_block}
        </div>
        <aside class="side-column">
          {side_context_html}
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
