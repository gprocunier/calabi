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
