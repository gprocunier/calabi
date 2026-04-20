#!/usr/bin/env python3
from __future__ import annotations

import argparse
import pathlib
import re

import jinja2
import yaml


def logical_suffix(name: str) -> str:
    parts = re.split(r"[^A-Za-z0-9]+", name)
    return "".join(part[:1].upper() + part[1:] for part in parts if part)


def main() -> int:
    script_path = pathlib.Path(__file__).resolve()
    cloudformation_dir = script_path.parent

    parser = argparse.ArgumentParser(
        description="Render a CloudFormation stack from the canonical volume inventory."
    )
    parser.add_argument(
        "--inventory",
        default=str(cloudformation_dir / "virt-01-volume-inventory.yml"),
        help="Path to the canonical YAML inventory file.",
    )
    parser.add_argument(
        "--template",
        default=str(cloudformation_dir / "templates" / "virt-lab.yaml.j2"),
        help="Path to the Jinja2 CloudFormation template source.",
    )
    parser.add_argument(
        "--output",
        default=None,
        help="Path to the rendered CloudFormation template. Defaults to the template name without .j2.",
    )
    args = parser.parse_args()

    inventory_path = pathlib.Path(args.inventory)
    template_path = pathlib.Path(args.template)
    output_path = (
        pathlib.Path(args.output)
        if args.output is not None
        else template_path.with_suffix("")
    )

    with inventory_path.open("r", encoding="utf-8") as inventory_file:
        inventory = yaml.safe_load(inventory_file)

    guest_volumes = []
    for volume in inventory["guest_volumes"]:
        volume_data = dict(volume)
        volume_data["logical_suffix"] = logical_suffix(volume["name"])
        guest_volumes.append(volume_data)

    template_loader = jinja2.FileSystemLoader(str(template_path.parent))
    environment = jinja2.Environment(
        loader=template_loader,
        autoescape=False,
        trim_blocks=True,
        lstrip_blocks=True,
    )
    template = environment.get_template(template_path.name)

    rendered = template.render(
        availability_zone=inventory["availability_zone"],
        virt_host=inventory["virt_host"],
        guest_volumes=guest_volumes,
    )

    output_path.write_text(rendered.rstrip() + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
