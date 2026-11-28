import assert from "node:assert/strict";
import test from "node:test";
import { answerDiagram, solutionFlow } from "../lib/diagram.ts";

const empty = { nodes: [], edges: [] };
const erpPlan = `Uzman puanları
- Fabrika bazlı: 3.2 / 4.2 / 4.0 / 4.0

12 aylık yol haritası (özet, ay bazlı)
- Ay 1–3 (Hazırlık): Veri temizliği ve test.
- Ay 4–9 (Kademeli geçiş): Ay4: İlk fabrika için prova, Ay5: İlk fabrikayı geçir, Ay7: İkinci fabrikayı geçir, Ay9: Üçüncü fabrikayı geçir.
- Ay 10–12 (Stabilizasyon): KPI doğrulama ve proje kapanışı.

Bütçe dağılımı
- Hazırlık: 720.000 €
`;

test("recovers ordered rollout milestones from a saved answer with an empty diagram", () => {
  const { title, flow } = answerDiagram("ERP geçişi nasıl yapılır?", erpPlan, empty);
  assert.equal(title, "Çözüm akışı");
  assert.deepEqual(flow.nodes.map(node => node.title), [
    "Hazırlık", "İlk fabrika için prova", "İlk fabrikayı geçir",
    "İkinci fabrikayı geçir", "Üçüncü fabrikayı geçir", "Stabilizasyon",
  ]);
  assert.equal(flow.edges.length, flow.nodes.length - 1);
  assert.equal(flow.nodes.at(-1).kind, "end");
});

test("keeps supplied flows and avoids inventing steps for ordinary answers", () => {
  const supplied = {
    nodes: [{ id: "done", title: "Sonuç", kind: "end", detail: "" }],
    edges: [],
  };
  assert.deepEqual(solutionFlow(supplied, erpPlan), supplied);
  assert.equal(answerDiagram("Bir film öner", "The Godfather", empty).title, "Soru ve yanıt");
});

test("extracts unbulleted stages under numbered headings and branches on an explicit failed pilot", () => {
  const answer = `4) 12 aylık yol haritası (özet)
Ay 0–2: Hazırlık — kapsamı onayla.
Ay 9: Pilot (ilk fabrika) — geri dönüş süresini ölç.
Ay 10: Pilot değerlendirme — sonuçları doğrula.
Ay 11: Fabrika 2'yi geçir.
Ay 12: Fabrika 3 ve dağıtım merkezlerini geçir, kapanış ölçümlerini tamamla.
Başarısız senaryo (pilot başarısız): düzeltme ve yeniden pilot.

5) Bütçe dağılımı
- Hazırlık: 720.000 €`;
  const { title, flow } = answerDiagram("Geçiş planı?", answer, empty);
  assert.equal(title, "Çözüm akışı");
  assert.ok(flow.nodes.some(node => node.title === "Fabrika 3 ve dağıtım merkezlerini geçir"));
  assert.deepEqual(flow.edges.filter(edge => edge.from === "pilot-decision").map(edge => edge.label), [
    "Kabul edildi", "Kabul edilmedi",
  ]);
  assert.equal(flow.edges.find(edge => edge.from === "pilot-retry").to, "1");
  assert.ok(!flow.nodes.some(node => node.detail.includes("720.000")));
});

test("retains the failed-pilot branch in a compact bulleted month plan", () => {
  const answer = `12 aylık yol haritası (kısa)
- Ay0–2: Hazırlık, sözleşmeler.
- Ay9: Pilot (Fabrika1) — geri dönüşü ölç.
- Ay10: Pilot değerlendirme, düzeltmeler.
- Ay11: Fabrika2 geçişi.
- Ay12: Fabrika3 ve dağıtım merkezleri; stabilizasyon.
(Pilot başarısızsa +2–4 ay düzeltme ve yeniden pilot.)`;
  const flow = solutionFlow(empty, answer);
  assert.ok(flow.nodes.some(node => node.title === "Pilot (Fabrika1)" && node.detail.startsWith("Ay 9")));
  assert.ok(flow.edges.some(edge => edge.from === "pilot-decision" && edge.label === "Kabul edilmedi"));
  assert.equal(flow.edges.find(edge => edge.from === "pilot-retry").to, "1");
});
