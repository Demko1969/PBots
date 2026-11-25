import rawCsv from "../tests/fixtures/support.csv?raw";
import { parseCsv } from "../lib/table";
import type { SolutionFlow } from "../lib/diagram";

const csv = { name: "support.csv", text: rawCsv };
const table = parseCsv(csv.text, csv.name);
const index = (name: string) => table.columns.indexOf(name);
const breaches = table.rows.filter(row => Number(row[index("cozum_saat")]) > Number(row[index("sla_hedef_saat")]));
const reopened = breaches.filter(row => row[index("yeniden_acildi")] === "1");
const rate = new Intl.NumberFormat("tr-TR", { style: "percent" }).format(breaches.length / table.rows.length);

export const scenario = {
  question: "ERP destek taleplerinde SLA en çok hangi modüllerde aşılıyor? Önce neyi iyileştirmeliyiz? Çözüm akışını göster.",
  followUp: "İlk hafta hangi göstergeyi izlemeliyiz?",
  csv,
  download: "data:text/csv;charset=utf-8," + encodeURIComponent(csv.text),
};

export const agents = [
  { agentId: 1, role: "SLA Analisti", task: "Çözüm sürelerini eşiklerle karşılaştır ve ihlalleri modüle göre say." },
  { agentId: 2, role: "Destek Süreci Uzmanı", task: "Kritik ve yeniden açılan talepleri incele, erken müdahale için bir ölçüt öner." },
];

export const expertAnswers = [
  `${table.rows.length} talebin ${breaches.length} tanesi SLA hedefini aştı. Üretim ve Finans’ta üçer ihlal var. 24 saatte çözülen T020 hedefi karşıladı.`,
  `SLA’yı aşan ${breaches.length} talebin ${reopened.length} tanesi yeniden açıldı. İlk yanıt süresini ve yeniden açılma nedenlerini birlikte inceleyin.`,
];

export const finalAnswer = `## Önce Üretim ve Finans

**${table.rows.length} talebin ${breaches.length} tanesi (${rate})** SLA sınırını aştı. İhlallerin tamamı Üretim ve Finans modüllerinde görüldü.

1. Kritik talepler için süre dolmadan uyarı oluşturun.
2. Yeniden açılan kayıtların nedenlerini ekiplerle inceleyin.
3. Bir hafta sonra iki modülün SLA ihlali oranını yeniden ölçün.`;

export const followUpAnswer = "İlk hafta **Üretim ve Finans’ın ayrı ayrı SLA ihlali oranını** izleyin. Payda o hafta çözülen talepler, pay ise SLA hedefini aşan talepler olsun. Talep sayısı azsa oranla birlikte ihlal adedini de gösterin.";

export const diagram: SolutionFlow = {
  nodes: [
    { id: "measure", title: "İhlalleri belirle", detail: "Çözüm süresini SLA hedefiyle karşılaştır.", kind: "step" },
    { id: "alert", title: "Kritik talepleri işaretle", detail: "Üretim ve Finans için erken uyarı oluştur.", kind: "step" },
    { id: "review", title: "Yeniden açılmaları incele", detail: "Tekrar açılan kayıtların nedenlerini kaydet.", kind: "step" },
    { id: "check", title: "Haftalık sonucu ölç", detail: "Her modülün ihlal oranını yeniden hesapla.", kind: "end" },
  ],
  edges: [
    { from: "measure", to: "alert", label: "" },
    { from: "alert", to: "review", label: "" },
    { from: "review", to: "check", label: "" },
  ],
};
