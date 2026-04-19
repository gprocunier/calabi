import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";

mermaid.initialize({
  startOnLoad: true,
  theme: "base",
  securityLevel: "loose",
  flowchart: {
    useMaxWidth: true,
    htmlLabels: true,
    nodeSpacing: 30,
    rankSpacing: 42,
  },
  themeVariables: {
    fontFamily: '"Red Hat Text", "Helvetica Neue", Arial, sans-serif',
    fontSize: "18px",
    primaryColor: "#fff4e5",
    primaryBorderColor: "#e0e0e0",
    primaryTextColor: "#151515",
    lineColor: "#8a8d90",
    clusterBkg: "#ffffff",
    clusterBorder: "#c7c7c7",
  },
});

const COPY_LABELS = {
  idle: "Copy",
  copied: "Copied",
  failed: "Copy failed",
};

async function copyCode(button) {
  const codebox = button.closest(".codebox");
  const code = codebox?.querySelector("pre code");
  const label = button.querySelector(".codebox__copy-label");
  if (!code || !label) {
    return;
  }

  try {
    await navigator.clipboard.writeText(code.textContent ?? "");
    button.dataset.copyState = "copied";
  } catch {
    button.dataset.copyState = "failed";
  }

  label.textContent = COPY_LABELS[button.dataset.copyState] ?? COPY_LABELS.idle;
  window.setTimeout(() => {
    button.dataset.copyState = "idle";
    label.textContent = COPY_LABELS.idle;
  }, 1800);
}

function toggleWrap(button) {
  const codebox = button.closest(".codebox");
  const nextWrapped = !codebox?.classList.contains("codebox--wrapped");
  if (!codebox) {
    return;
  }

  codebox.classList.toggle("codebox--wrapped", nextWrapped);
  button.setAttribute("aria-pressed", nextWrapped ? "true" : "false");
}

document.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  const copyButton = target?.closest(".codebox__copy");
  if (copyButton instanceof HTMLButtonElement) {
    void copyCode(copyButton);
    return;
  }

  const wrapButton = target?.closest(".codebox__wrap");
  if (wrapButton instanceof HTMLButtonElement) {
    toggleWrap(wrapButton);
  }
});
