const diagramLabel = /(?:^|(?<=[.!?]\s))\s*(?:#{1,6}\s+|[-*]\s+)?(?:\*\*)?(?:(?:çözüm|süreç|karar)\s+akışı(?:\s+diyagramı)?|akış (?:diyagramı|şeması)|diyagram(?: yolu| taslağı| akışı)?|(?:solution |process )?diagram|diagramme(?: de (?:solution|processus))?|schéma de solution|flowchart)(?:\s*\([^\n)]{1,40}\))?(?:\*\*)?\s*[:：]/iu;
const nextSection = /^(?:#{1,6}\s+)?(?:\*\*)?[\p{L}][\p{L}\s]{2,45}(?:\*\*)?\s*[:：]/u;
const connectors = /→|-->|->|⇒|\b(?:flowchart|graph)\s+(?:TD|TB|LR|RL|BT)\b/iu;

export function splitExpertAnswer(text: string) {
  const notes: string[] = [];
  const visible: string[] = [];
  let collecting = false;
  let diagramFence = false;
  const lines = text.replace(/\r\n?/g, "\n").split("\n");

  for (const raw of lines) {
    const line = raw.trim();
    if (diagramFence) {
      if (/^\x60{3}\s*$/.test(line)) diagramFence = false;
      else if (line) notes.push(line);
      continue;
    }
    if (/^\x60{3}\s*(?:mermaid|plantuml|graphviz|dot)\b/iu.test(line)) {
      collecting = false;
      diagramFence = true;
      continue;
    }

    const label = diagramLabel.exec(line);
    if (label) {
      const before = line.slice(0, label.index).trim();
      if (before) visible.push(before);
      const body = line.slice(label.index + label[0].length).replace(/^\*\*\s*/, "").trim();
      if (body) notes.push(body);
      collecting = true;
      continue;
    }
    if (collecting && (!line || (nextSection.test(line) && !connectors.test(line)))) collecting = false;
    if (collecting || /^(?:flowchart|graph)\s+(?:TD|TB|LR|RL|BT)\b/iu.test(line)) {
      if (line) notes.push(line);
      collecting = true;
    } else {
      visible.push(raw);
    }
  }

  return { answer: visible.join("\n").trim(), diagramNotes: notes.join("\n").slice(0, 6000) };
}

export function publicExpert<T extends { answer?: string; diagramNotes?: string }>(expert: T): Omit<T, "diagramNotes"> {
  const visible = { ...expert };
  delete visible.diagramNotes;
  if (typeof visible.answer === "string") visible.answer = splitExpertAnswer(visible.answer).answer;
  return visible;
}
