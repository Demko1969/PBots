import assert from "node:assert/strict";
import test from "node:test";
import { canShowStoredDiagram, diagramPreference, diagramRequirement, diagramValidationIssue, hasRequiredDiagram, minimumScenarioBranches, needsReviewLoop } from "../lib/judge-review.ts";
import { conversationPrompt } from "../lib/conversation.ts";

test("recognizes conditional schedules, alternative routes, and requested diagrams", () => {
  const schedule = "Perşembe üç durumdan hangisi belli olur. Ortak planı ve üç durum için devam çizelgesini göster.";
  assert.equal(diagramRequirement(schedule), "branches");
  assert.equal(minimumScenarioBranches(schedule), 3);
  assert.equal(diagramRequirement("Üç durum için ayrı çizelge göster"), "branches");
  assert.equal(diagramRequirement("Kurye hangi yolun kapalı olduğunu öğrenir. Her ilk durak için rotayı göster."), "branches");
  assert.equal(diagramRequirement("İşlemin diyagramını çiz."), "flow");
  assert.equal(diagramRequirement("Rota senaryolarını anlat, diyagram istemiyorum."), "optional");
  assert.equal(diagramRequirement("Geçmiş: Rota senaryoları.\n\nGüncel soru:\nMerhaba"), "optional");
});

test("reevaluating a routed question keeps its diagram requirement", () => {
  const turns = [
    { question: "Kurye hangi yolun kapalı olduğunu öğrenir. Her ilk durak için rotayı göster.", result: { finalAnswer: "Dört rota var." } },
    { question: "soruyu tekrar değerlendir", result: { finalAnswer: "Dört rota doğrulandı." } },
  ];
  assert.equal(diagramRequirement(conversationPrompt("soruyu tekrar değerlendir", turns)), "branches");
  assert.equal(diagramRequirement(conversationPrompt("Kısa bir film öner.", turns)), "optional");
  assert.equal(diagramRequirement(conversationPrompt("soruyu tekrar değerlendir, diyagram istemiyorum", turns)), "optional");
});

test("test outcomes that change the recommended action require branches", () => {
  assert.equal(diagramRequirement(
    "Fabrika hangi maliyet stratejisini izlemeli? Testten sonra gönderme veya hurdaya ayırma kararı var. Her test sonucundan sonra kusur olasılığını hesapla.",
  ), "branches");
  assert.equal(diagramRequirement("Her test sonucundan sonra kusur olasılığı nedir?"), "optional");
});

test("keeps explicit diagram preferences separate from automatic structure hints", () => {
  assert.equal(diagramPreference("Yedekleme için adım adım uygulama planı hazırla."), "automatic");
  assert.equal(diagramPreference("Pilot için dallı bir akış çiz."), "requested");
  assert.equal(diagramPreference("Pilot planı ver, çözüm akışını gösterme."), "declined");
  assert.equal(diagramPreference("Diyagram istiyorum, ancak diyagram gösterme."), "declined");
});

const nodes = [
  { id: "start", title: "Durum", kind: "decision" },
  { id: "a", title: "A sonucu", kind: "end" },
  { id: "b", title: "B sonucu", kind: "end" },
];
const edges = [
  { from: "start", to: "a", label: "A" },
  { from: "start", to: "b", label: "B" },
];

test("requires a connected graph with labeled, complete scenario branches", () => {
  assert.equal(hasRequiredDiagram({ nodes, edges }, "branches"), true);
  assert.equal(hasRequiredDiagram({ nodes, edges }, "branches", 3), false);
  assert.equal(hasRequiredDiagram({ nodes, edges: [] }, "branches"), false);
  assert.equal(hasRequiredDiagram({ nodes, edges: [edges[0]] }, "branches"), false);
  assert.equal(hasRequiredDiagram({ nodes, edges: [edges[0], { ...edges[1], label: "A" }] }, "branches"), false);
  assert.equal(hasRequiredDiagram(undefined, "optional"), true);
});

test("only shows validated diagrams whose new or legacy record permits them", () => {
  const diagram = { nodes, edges };
  assert.equal(canShowStoredDiagram(true, diagram), true);
  assert.equal(canShowStoredDiagram(false, diagram), false);
  assert.equal(canShowStoredDiagram(undefined, diagram), true);
  assert.equal(canShowStoredDiagram(undefined, { nodes: [], edges: [] }), false);
  assert.equal(canShowStoredDiagram(true, { nodes, edges: [edges[0]] }), false);
});

test("explains the missing return edge in a requested pilot retest flow", () => {
  const question = "Pilot başarısız olursa sorunu düzelt ve testi tekrarla. Çözüm akışını göster.";
  assert.equal(diagramRequirement(question), "branches");
  assert.equal(needsReviewLoop(question), true);
  const pilotNodes = [
    { id: "start", title: "Pilot hazırlığını bitir", kind: "step" },
    { id: "test", title: "Pilot testi çalıştır", kind: "step" },
    { id: "gate", title: "Kabul ölçütleri karşılandı mı?", kind: "decision" },
    { id: "repair", title: "Sorunu düzelt", kind: "step" },
    { id: "live", title: "Yayına al", kind: "end" },
  ];
  const pilotEdges = [
    { from: "start", to: "test", label: "" },
    { from: "test", to: "gate", label: "" },
    { from: "gate", to: "repair", label: "Karşılanmadı" },
    { from: "gate", to: "live", label: "Karşılandı" },
    { from: "repair", to: "live", label: "" },
  ];
  assert.match(diagramValidationIssue({ nodes: pilotNodes, edges: pilotEdges }, "branches", 2, true), /önceki test/);
  pilotEdges[4].to = "test";
  assert.equal(diagramValidationIssue({ nodes: pilotNodes, edges: pilotEdges }, "branches", 2, true), undefined);
});

test("recognizes French and English requests for a solution diagram", () => {
  assert.equal(diagramPreference("Montre-moi un diagramme de solution."), "requested");
  assert.equal(diagramPreference("Explique la démarche sans schéma."), "declined");
  assert.equal(diagramPreference("Include a solution diagram."), "requested");
});
