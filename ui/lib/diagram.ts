export function solutionSteps(answer: string): string[] {
  const lines = answer.split(/\r?\n/);
  const start = lines.findIndex(line =>
    /^çözüm akışı(?:\s*[:：])?$/.test(line.replace(/[#*]/g, "").trim().toLocaleLowerCase("tr-TR")),
  );
  if (start === -1) return [];

  const steps: string[] = [];
  for (const raw of lines.slice(start + 1)) {
    if (/^\s*#{1,6}\s/.test(raw)) break;
    const step = raw.replace(/\*\*/g, "").replace(/^\s*[-•]\s+/, "").trim()
      .replace(/\s*↓\s*$/, "").replace(/^\[([^\]]+)\]$/, "$1");
    if (step) steps.push(step);
  }
  return steps;
}

type FlowNode = { id: string; title: string; detail: string; kind: string };
type FlowEdge = { from: string; to: string; label: string };
export type SolutionFlow = { nodes: FlowNode[]; edges: FlowEdge[] };

export function solutionFlow(value: SolutionFlow | undefined, answer: string): SolutionFlow {
  if (Array.isArray(value?.nodes) && Array.isArray(value.edges)) {
    const nodes = value.nodes.filter(node => node && typeof node.id === "string" &&
      typeof node.title === "string" && node.title.trim()).slice(0, 12);
    const ids = new Set(nodes.map(node => node.id));
    const edges = value.edges.filter(edge => edge && ids.has(edge.from) && ids.has(edge.to)).slice(0, 20);
    if (ids.size === nodes.length && nodes.length && (nodes.length === 1 || edges.length)) return { nodes, edges };
  }
  const nodes = solutionSteps(answer).map((title, index) => ({ id: String(index), title, detail: "", kind: "step" }));
  return { nodes, edges: nodes.slice(1).map((node, index) => ({ from: String(index), to: node.id, label: "" })) };
}

function xml(text: string): string {
  return text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/[&<>"']/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
    })[char]!);
}

function wrap(value: unknown, limit: number): string[] {
  if (typeof value !== "string" || !value.trim()) return [];
  return value.trim().replace(/\s+/g, " ")
    .match(new RegExp(`.{1,${limit}}(?: |$)|.{1,${limit}}`, "gu"))!
    .map(line => line.trim()).filter(Boolean);
}

export function renderSolutionDiagram({ nodes, edges }: SolutionFlow): string {
  if (!nodes.length) return "";
  const order = new Map(nodes.map((node, index) => [node.id, index]));
  const ranks = new Map<string, number>();
  const rows: FlowNode[][] = [];
  for (const node of nodes) {
    const parents = edges.filter(edge => edge.to === node.id && order.get(edge.from)! < order.get(node.id)!);
    const rank = Math.max(0, ...parents.map(edge => ranks.get(edge.from)! + 1));
    ranks.set(node.id, rank);
    (rows[rank] ??= []).push(node);
  }

  const cardWidth = 264;
  const gap = 58;
  const bypasses = edges.filter(edge => ranks.get(edge.to)! !== ranks.get(edge.from)! + 1);
  const railCount = Math.ceil(bypasses.length / 2);
  const margin = 28 + railCount * 13;
  const width = Math.max(...rows.map(row => row.length * (cardWidth + gap) - gap)) + margin * 2;
  const positions = new Map<string, { x: number; top: number; bottom: number; rank: number }>();
  const rowBottoms: number[] = [];
  let top = 24;
  const cards = rows.flatMap((row, rank) => {
    const content = row.map(node => ({
      node,
      title: wrap(node.title, node.kind === "decision" ? 18 : 24),
      detail: wrap(node.detail, node.kind === "decision" ? 19 : 28),
    }));
    const height = Math.max(...content.map(({ node, title, detail }) =>
      node.kind === "decision" ? 68 + 2 * (title.length * 21 + detail.length * 19)
        : Math.max(78, 30 + title.length * 21 + detail.length * 19)));
    const bottom = top + height;
    rowBottoms.push(bottom);
    const shapes = content.map(({ node, title, detail }, index) => {
      const x = width / 2 + (index - (row.length - 1) / 2) * (cardWidth + gap);
      const mid = (top + bottom) / 2;
      const left = x - cardWidth / 2;
      positions.set(node.id, { x, top, bottom, rank });
      const outline = node.kind === "decision"
        ? `<polygon points="${x},${top} ${left + cardWidth},${mid} ${x},${bottom} ${left},${mid}" fill="#def1f9" stroke="#548ca4"/>`
        : `<rect x="${left}" y="${top}" width="${cardWidth}" height="${height}" rx="12" fill="${node.kind === "end" ? "#e2f3f8" : "#fff"}" stroke="#9bc4d6"/>`;
      const textTop = mid - (title.length * 21 + detail.length * 19) / 2;
      const titles = title.map((line, i) =>
        `<text x="${x}" y="${textTop + 16 + i * 21}" font-size="16" font-weight="650" fill="#064e68">${xml(line)}</text>`).join("");
      const details = detail.map((line, i) =>
        `<text x="${x}" y="${textTop + title.length * 21 + 15 + i * 19}" font-size="14" fill="#526d7d">${xml(line)}</text>`).join("");
      return outline + titles + details;
    });
    top = bottom + 84;
    return shapes;
  }).join("");

  const connections = edges.map(edge => {
    const from = positions.get(edge.from)!;
    const to = positions.get(edge.to)!;
    const adjacent = to.rank === from.rank + 1;
    const backward = to.rank <= from.rank;
    const bend = from.bottom + 42;
    const bypass = bypasses.indexOf(edge);
    const useLeft = bypass % 2 === 0;
    const rail = (useLeft ? 1 : -1) * (14 + Math.floor(bypass / 2) * 13) + (useLeft ? 0 : width);
    const approach = to.top - 22;
    const path = adjacent
      ? `M${from.x} ${from.bottom} V${bend} H${to.x} V${to.top}`
      : `M${from.x} ${from.bottom} V${bend} H${rail} V${approach} H${to.x} V${to.top}`;
    const labelX = adjacent ? to.x + (to.x === from.x ? 15 : 0) : (rail + from.x) / 2;
    const labelY = adjacent ? bend - 9 : bend + 17;
    const rawLabel = typeof edge.label === "string" ? edge.label.trim() : "";
    const genericLabel = /^(tamam|doğrudan|devam(?: et)?)\s*[.!:…]*$/iu;
    const label = genericLabel.test(rawLabel) ? "" : rawLabel;
    return `<path d="${path}" fill="none" stroke="#537f94" stroke-width="2" marker-end="url(#solution-arrow)" ${backward ? 'stroke-dasharray="6 4"' : ""}/>` +
      (label ? `<text x="${labelX}" y="${labelY}" text-anchor="${adjacent && to.x === from.x ? "start" : "middle"}" font-size="14" font-weight="650" fill="#345c6e" stroke="#f4faff" stroke-width="5" paint-order="stroke">${xml(label)}</text>` : "");
  }).join("");
  const height = rowBottoms.at(-1)! + (edges.some(edge => ranks.get(edge.from) === rows.length - 1) ? 68 : 24);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs><marker id="solution-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L10 5 L0 10 Z" fill="#537f94"/></marker></defs>
  <rect width="100%" height="100%" fill="#f4faff"/>
  <g font-family="system-ui, sans-serif" text-anchor="middle">${connections}${cards}</g>
</svg>`;
}

export function downloadSolutionDiagram(svg: string) {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "ortak-akil-cozum-diyagrami.svg";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
