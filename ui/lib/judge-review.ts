export type DiagramRequirement = "optional" | "flow" | "branches";
export type DiagramPreference = "automatic" | "requested" | "declined";

const currentQuestionMarker = "\n\nGüncel soru:\n";
const previousTurnsMarker = "Sohbet geçmişi (eskiden yeniye): ";
const reviewRequest = /^(?:(?:bu|son|önceki)\s+)?(?:(?:soruyu|cevabı|yanıtı|sonucu|değerlendirmeyi)\s+)?(?:(?:tekrar|yeniden|bir daha)\s+)?(?:değerlendir|kontrol et|hesapla|doğrula)(?:\s+lütfen)?[.!?]*$/u;

function questionText(question: string) {
  const plain = question.split("\n\nCSV analysis context\n")[0];
  const separator = plain.lastIndexOf(currentQuestionMarker);
  const current = plain.slice(separator < 0 ? 0 : separator + currentQuestionMarker.length).trim().toLocaleLowerCase("tr-TR");
  const historyStart = plain.indexOf(previousTurnsMarker);
  if (!reviewRequest.test(current) || historyStart < 0 || separator < historyStart) return { current, subject: current };
  try {
    const turns: unknown = JSON.parse(plain.slice(historyStart + previousTurnsMarker.length, separator));
    if (Array.isArray(turns)) {
      for (let index = turns.length - 1; index >= 0; index--) {
        const previous = turns[index]?.soru;
        if (typeof previous !== "string") continue;
        const subject = previous.trim().toLocaleLowerCase("tr-TR");
        if (subject && !reviewRequest.test(subject)) return { current, subject };
      }
    }
  } catch {
    // A malformed history does not override the current request.
  }
  return { current, subject: current };
}

function readPreference(text: string): DiagramPreference {
  const international = text.replaceAll("ı", "i");
  const label = "(?:diyagram(?:ı|ını)?|(?:(?:çözüm|işlem|süreç|karar)\\s+)?akış(?:ı|ını)?|akış şeması(?:nı)?)";
  if (new RegExp(`${label}\\s+(?:(?:da|de|lütfen)\\s+)?(?:istemiyorum|istemem|gerekmez|gerek yok|olmasın|çizme|ekleme|gösterme|oluşturma|hazırlama|verme|kullanma|olmadan)(?!\\p{L})`, "u").test(text) ||
      /\b(?:no|without) (?:a )?(?:diagram|flowchart)\b/u.test(international) ||
      /\b(?:sans|pas de|aucun) (?:diagramme|schéma|organigramme)\b/u.test(international)) return "declined";
  if (new RegExp(`${label}\\s+(?:(?:da|de|lütfen|olarak|şeklinde)\\s+)?(?:göster|çiz|ekle|oluştur|ver|hazırla|olsun|istiyorum|gerekli)`, "u").test(text) ||
      /\b(?:show|draw|include|create) (?:a |the )?(?:(?:solution|process) )?(?:diagram|flowchart)\b/u.test(international) ||
      /\b(?:affich(?:e|ez|er)|montr(?:e|ez|er)|dessin(?:e|ez|er)|ajout(?:e|ez|er)|inclu(?:s|ez|re)|cré(?:e|ez|er))(?:-moi)?\s+(?:(?:un|le|ce) )?(?:diagramme|schéma|organigramme)\b/u.test(international)) return "requested";
  return "automatic";
}

export function diagramPreference(question: unknown): DiagramPreference {
  return typeof question === "string" ? readPreference(questionText(question).current) : "automatic";
}

export function diagramRequirement(question: unknown): DiagramRequirement {
  if (typeof question !== "string") return "optional";
  const { current, subject } = questionText(question);

  if (readPreference(current) === "declined") return "optional";
  const alternatives = /senaryo|her durum|(?:iki|üç|dört|beş|altı|[2-9]|10)\s+(?:ayrı\s+|farklı\s+)?durum|her (?:ilk durak|yol kapanması)|hangi yolun kapalı|durumdan hangisi|karşılanmad|başarısız|kabul ölçütleri/u;
  const process = /çizelge|takvim|en erken|önkoşul|rota|güzergâh|yol kapanması|dakika|teslimat süresi|akış/u;
  if (alternatives.test(subject) && process.test(subject)) return "branches";
  const observedResult = /(?:her|hangi) (?:test|kontrol|ölçüm|inceleme) sonucu|(?:test|kontrol|ölçüm|inceleme) sonucuna göre|(?:test|kontrol|ölçüm|inceleme)(?:ten|den) sonra/u;
  const actionDecision = /karar|strateji|eylem|ne yap|nasıl (?:ilerle|hareket et)/u;
  if (observedResult.test(subject) && actionDecision.test(subject)) return "branches";
  if (readPreference(subject) === "requested") return "flow";
  return "optional";
}

export function minimumScenarioBranches(question: unknown): number {
  if (typeof question !== "string") return 2;
  const numbers: Record<string, number> = { iki: 2, üç: 3, dört: 4, beş: 5, altı: 6 };
  const matches = questionText(question).subject.matchAll(/(?:^|[^\p{L}\d])(iki|üç|dört|beş|altı|[2-9]|10)\s+(?:ayrı\s+|farklı\s+)?(?:durum|senaryo)(?!da\s+bir)/gu);
  return Math.max(2, ...Array.from(matches, match => numbers[match[1]] ?? Number(match[1])));
}

export function needsReviewLoop(question: unknown): boolean {
  if (typeof question !== "string") return false;
  const { subject } = questionText(question);
  return /başarısız|karşılanmad|geçeme|sağlanmad/u.test(subject) &&
    /tekrar(?:la| kontrol| test)|yeniden (?:kontrol|test|dene)/u.test(subject);
}

export function diagramValidationIssue(
  value: unknown, requirement: DiagramRequirement, minimumBranches = 2, requireLoop = false,
): string | undefined {
  if (requirement === "optional") return;
  if (!value || typeof value !== "object") return "diagram.nodes ve diagram.edges alanları eksik.";
  const { nodes, edges } = value as { nodes?: unknown[]; edges?: unknown[] };
  if (!Array.isArray(nodes) || nodes.length < 2 || nodes.length > 32 ||
      !Array.isArray(edges) || !edges.length || edges.length > 64) return "Akışta 2–32 düğüm ve 1–64 bağlantı bulunmalı.";

  const graph = new Map<string, { kind: string; title: string; incoming: string[]; outgoing: Map<string, string> }>();
  for (const node of nodes) {
    if (!node || typeof node !== "object") return "Düğümler birer nesne olmalı.";
    const { id, title, kind } = node as Record<string, unknown>;
    if (typeof id !== "string" || !id.trim() || graph.has(id) ||
        typeof title !== "string" || !title.trim() || typeof kind !== "string" ||
        !["step", "decision", "end"].includes(kind)) return "Her düğümün benzersiz kimliği, başlığı ve geçerli türü olmalı.";
    if (/^(?:soru|yanıt|cevap|öneri|sonuç)\s*[:.]?$/iu.test(title.trim())) return "Düğüm başlıkları soru veya yanıt etiketi yerine somut eylem, karar ya da sonuç belirtmeli.";
    graph.set(id, { kind, title: title.toLocaleLowerCase("tr-TR"), incoming: [], outgoing: new Map() });
  }
  for (const edge of edges) {
    if (!edge || typeof edge !== "object") return "Bağlantılar birer nesne olmalı.";
    const { from, to, label } = edge as Record<string, unknown>;
    if (typeof from !== "string" || typeof to !== "string" || typeof label !== "string") return "Bağlantıda kaynak, hedef ve etiket alanları bulunmalı.";
    const parent = graph.get(from);
    const child = graph.get(to);
    if (!parent || !child || from === to || parent.outgoing.has(to)) return "Bağlantılar var olan farklı düğümleri bağlamalı ve tekrarlanmamalı.";
    parent.outgoing.set(to, label.trim().toLocaleLowerCase("tr-TR"));
    child.incoming.push(from);
  }
  const roots = [...graph].filter(([, node]) => !node.incoming.length);
  const ends = [...graph].filter(([, node]) => node.kind === "end");
  if (roots.length !== 1) return "Akışın bağlantıyla girilmeyen tek bir başlangıç düğümü olmalı.";
  if (!ends.length || ends.some(([, node]) => node.outgoing.size)) return "En az bir end düğümü olmalı ve bitiş düğümünden bağlantı çıkmamalı.";

  function reachable(pending: string[], backwards: boolean) {
    const seen = new Set<string>();
    for (const id of pending) {
      if (seen.has(id)) continue;
      seen.add(id);
      const node = graph.get(id)!;
      pending.push(...(backwards ? node.incoming : node.outgoing.keys()));
    }
    return seen.size === graph.size;
  }
  if (!reachable([roots[0][0]], false) || !reachable(ends.map(([id]) => id), true)) {
    return "Her düğüme başlangıçtan ulaşılabilmeli ve her düğümden bir bitişe gidilebilmeli.";
  }
  let branches = 1;
  for (const node of graph.values()) {
    if (node.kind !== "decision") continue;
    const labels = [...node.outgoing.values()];
    if (labels.length < 2 || !labels.every(label => label && !/^(devam|tamam|doğrudan)$/u.test(label)) || new Set(labels).size !== labels.length) return "Her gerçek kararın en az iki ayrı ve koşulu belirten etiketli dalı olmalı.";
    branches += labels.length - 1;
  }
  if (requirement === "branches" && branches < minimumBranches) return `En az ${minimumBranches} senaryo dalı gerekli.`;
  if (requireLoop) {
    function reaches(from: string, target: string, seen = new Set<string>()): boolean {
      if (from === target) return true;
      if (seen.has(from)) return false;
      seen.add(from);
      return [...graph.get(from)!.outgoing.keys()].some(next => reaches(next, target, seen));
    }
    const failure = /hayır|başarısız|karşılanmad|sağlanmad|geçmedi|reddedil|hata|sapma|yetersiz|uygunsuz/u;
    const repairs = [...graph].filter(([, node]) =>
      node.kind === "step" && /düzelt|onar|gider|iyileştir|revize|yenile/u.test(node.title));
    const retry = [...graph].some(([id, node]) => node.kind === "decision" &&
      [...node.outgoing].some(([next, label]) => failure.test(label) &&
        repairs.some(([repair]) => reaches(next, repair, new Set([id])) && reaches(repair, id))));
    if (!retry) return "Başarısız karar dalı düzeltmeden sonra önceki test veya kontrol adımına dönmeli.";
  }
}


export function hasRequiredDiagram(value: unknown, requirement: DiagramRequirement, minimumBranches = 2, requireLoop = false): boolean {
  return !diagramValidationIssue(value, requirement, minimumBranches, requireLoop);
}

export function canShowStoredDiagram(showDiagram: unknown, diagram: unknown): boolean {
  return (showDiagram === true || showDiagram === undefined) && hasRequiredDiagram(diagram, "flow");
}

export function canReuseSavedResult(
  result: { showDiagram?: boolean; diagramIssue?: string; diagram?: unknown } | undefined,
  question: string,
): boolean {
  return !!result && (result.showDiagram === false || !!result.diagramIssue || hasRequiredDiagram(
    result.diagram, diagramRequirement(question), minimumScenarioBranches(question), needsReviewLoop(question),
  ));
}
