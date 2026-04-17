import "@rhds/elements/rh-code-block/rh-code-block.js";
import { RhIcon } from "@rhds/elements/rh-icon/rh-icon.js";
import copy from "@rhds/icons/ui/copy.js";
import wrapText from "@rhds/icons/ui/wrap-text.js";
import overflowText from "@rhds/icons/ui/overflow-text.js";
import caretUp from "@rhds/icons/microns/caret-up.js";

const ICON_SETS = new Map([
  ["ui", new Map([
    ["copy", copy],
    ["wrap-text", wrapText],
    ["overflow-text", overflowText],
  ])],
  ["microns", new Map([
    ["caret-up", caretUp],
  ])],
]);

RhIcon.resolve = async (set, icon) => {
  const template = ICON_SETS.get(set)?.get(icon);
  if (!template) {
    throw new Error(`Could not load icon "${icon}" from set "${set}".`);
  }
  return template.cloneNode(true);
};
