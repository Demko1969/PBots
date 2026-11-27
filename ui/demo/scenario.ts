import rawCsv from "../tests/fixtures/support.csv?raw";
import ticketTr from "./erp-finans-talebi.png?inline";
import ticketEn from "./erp-finance-ticket.en.png?inline";
import ticketFr from "./erp-finance-ticket.fr.png?inline";
import { parseCsv } from "../lib/table";
import type { SolutionFlow } from "../lib/diagram";
import type { Language } from "../lib/language";
import type { Agent } from "../lib/evaluation-run";
import type { DemoScenario } from "../app/page";

type Copy = readonly [turkish: string, english: string, french: string];

function translate(copy: Copy, language: Language) {
  return copy[language === "en" ? 1 : language === "fr" ? 2 : 0];
}

const csv = { name: "support.csv", text: rawCsv };
const table = parseCsv(csv.text, csv.name);
const index = (name: string) => table.columns.indexOf(name);
const overdue = table.rows.filter(row => Number(row[index("cozum_saat")]) > Number(row[index("sla_hedef_saat")]));
const reopened = overdue.filter(row => row[index("yeniden_acildi")] === "1");
const moduleBreaches = (module: string) => overdue.filter(row => row[index("modul")] === module).length;
const production = moduleBreaches("Üretim");
const finance = moduleBreaches("Finans");
const critical = overdue.filter(row => row[index("oncelik")] === "Kritik");
const replyTimes = critical.map(row => Number(row[index("ilk_yanit_saat")])).sort((a, b) => a - b);
const firstReply = replyTimes[0];
const lastReply = replyTimes.at(-1);
const longest = critical.find(row => Number(row[index("ilk_yanit_saat")]) === lastReply);
const longestId = longest?.[index("talep_no")];
const longestResolution = longest?.[index("cozum_saat")];
const rate = (locale: Language) => new Intl.NumberFormat(locale, { style: "percent" }).format(overdue.length / table.rows.length);
const images = { tr: ticketTr, en: ticketEn, fr: ticketFr };
const screenshot = new File(
  [Uint8Array.from(atob(ticketTr.split(",")[1]), character => character.charCodeAt(0))],
  "erp-finans-talebi.png",
  { type: "image/png" },
);

type ExpertCopy = { role: Copy; task: Copy; answer: Copy };
type TurnCopy = { question: Copy; experts: ExpertCopy[]; finalAnswer: Copy };

const turns: TurnCopy[] = [
  {
    question: [
      "ERP destek taleplerinde SLA en çok nerede aşılıyor ve önce neyi düzeltmeliyiz?",
      "Where are our ERP support tickets missing their SLA, and what should we fix first?",
      "Quels tickets de support ERP dépassent le délai prévu par le SLA, et que faut-il corriger en priorité ?",
    ],
    experts: [
      {
        role: ["SLA Analisti", "SLA Analyst", "Analyste SLA"],
        task: [
          "Çözüm sürelerini SLA hedefleriyle karşılaştır ve ihlalleri modüle göre say.",
          "Compare resolution times with the SLA targets and count breaches by module.",
          "Compare les délais de résolution aux objectifs du SLA et compte les dépassements par module.",
        ],
        answer: [
          `${table.rows.length} talebin ${overdue.length} tanesi SLA hedefini aştı. İhlallerin ${production} tanesi Üretim’de, ${finance} tanesi Finans’ta; diğer modüllerde ihlal yok. İki modülü ayrı ayrı izleyin, böylece birindeki iyileşme diğerindeki gecikmeyi gizlemez.`,
          `${overdue.length} of ${table.rows.length} tickets missed their SLA. Production and Finance account for every breach, with ${production} in Production and ${finance} in Finance. Track the two modules separately so an improvement in one cannot mask delays in the other.`,
          `${overdue.length} tickets sur ${table.rows.length} ont dépassé le délai prévu. Tous les dépassements se concentrent dans les modules Production (${production}) et Finance (${finance}). Suivez les deux modules séparément pour qu’une amélioration dans l’un ne masque pas les retards dans l’autre.`,
        ],
      },
      {
        role: ["Destek Süreci Uzmanı", "Support Process Specialist", "Spécialiste des processus de support"],
        task: [
          "SLA hedefini aşan taleplerin yeniden açılma durumunu incele ve hangi süreç adımının araştırılması gerektiğini belirle.",
          "Check which overdue tickets were reopened and identify the part of the support process worth reviewing.",
          "Repère les tickets en retard qui ont été rouverts et précise quelle étape du support examiner.",
        ],
        answer: [
          `SLA hedefini aşan ${overdue.length} talebin ${reopened} tanesi yeniden açıldı. Kayıtlar, yeniden açılmanın gecikmeye neden olup olmadığını göstermiyor. Üretim ve Finans’ta her talebin kapatılmadan önce nasıl doğrulandığını ve neden yeniden açıldığını inceleyin.`,
          `${reopened} of the ${overdue.length} overdue tickets were reopened. The records do not establish whether reopening caused the delays. Review how Production and Finance verified each fix before closing the ticket, and why it was reopened.`,
          `${overdue.length} tickets étaient en retard et ${reopened} d’entre eux ont été rouverts. Les données ne permettent pas de déterminer si la réouverture a causé le retard. Vérifiez comment les équipes Production et Finance ont validé la résolution avant la clôture, puis pourquoi chaque ticket a été rouvert.`,
        ],
      },
      {
        role: ["Talep Önceliklendirme Uzmanı", "Ticket Prioritization Specialist", "Spécialiste du tri des tickets"],
        task: [
          "Talep önceliğini ve ilk yanıt sürelerini kullanarak erken müdahalenin nerede işe yarayabileceğini belirle.",
          "Use priority and first-response times to identify where earlier intervention could help.",
          "Utilise la priorité et le délai de première réponse pour déterminer où intervenir plus tôt.",
        ],
        answer: [
          `SLA’yı aşan ${critical.length} kritik talepte ilk yanıt ${firstReply} ila ${lastReply} saat sürdü. Örneğin ${longestId}, ilk yanıtı ${lastReply} saatte aldı ve ${longestResolution} saatte çözüldü. İlk yanıtı üç saati geçen kritik talepler için bir erken uyarı deneyin.`,
          `The ${critical.length} overdue critical tickets waited ${firstReply} to ${lastReply} hours for a first response. Ticket ${longestId} waited ${lastReply} hours and took ${longestResolution} hours to resolve. Pilot an alert when a critical ticket is still unanswered after three hours.`,
          `Les ${critical.length} tickets critiques en retard ont attendu entre ${firstReply} et ${lastReply} heures une première réponse. Le ticket ${longestId} a attendu ${lastReply} heures et sa résolution a pris ${longestResolution} heures. Testez une alerte lorsqu’un ticket critique reste sans réponse après trois heures.`,
        ],
      },
    ],
    finalAnswer: [
      `## Önce Üretim ve Finans’ta müdahale edin

${table.rows.length} talebin ${overdue.length} tanesi (**${rate("tr")}**) SLA’yı aştı. Tüm ihlaller bu iki modülde olduğu için **yanıtsız kritik talepler için üç saatlik uyarıyı** önce burada deneyin. Kritik taleplerin ilk yanıta en az ${firstReply} saat beklemesi, süre dolmadan müdahale edilebilecek bir nokta gösteriyor.

Geciken taleplerin yeniden açılmış olması, kapanış kontrollerini de incelemeyi gerektiriyor. Bir hafta sonra iki modülün ihlal oranını ayrı ayrı kontrol edin.`,
      `## Start with Production and Finance

${overdue.length} of ${table.rows.length} tickets (**${rate("en")}**) missed their SLA. Every breach was in those two modules, so pilot a **three-hour alert for unanswered critical tickets** there first. The critical tickets’ first-response delays show where the team can intervene before the resolution deadline.

The overdue tickets were also reopened, which makes the closure checks worth reviewing. After one week, compare the breach rate separately for each module.`,
      `## Commencez par les modules Production et Finance

${overdue.length} tickets sur ${table.rows.length} (**${rate("fr")}**) ont dépassé le délai prévu. Tous les dépassements concernent ces deux modules. Testez-y d’abord **une alerte pour les tickets critiques sans réponse après trois heures**. Les délais de première réponse montrent à quel moment l’équipe peut intervenir avant l’échéance.

Les tickets en retard ont aussi été rouverts. Examinez donc les contrôles avant clôture, puis mesurez séparément le taux de dépassement de chaque module après une semaine.`,
    ],
  },
  {
    question: [
      "İlk hafta hangi göstergeyi izlemeliyiz?",
      "What metric should we track in the first week?",
      "Quel indicateur suivre la première semaine ?",
    ],
    experts: [{
      role: ["Performans Ölçüm Uzmanı", "Performance Measurement Specialist", "Spécialiste de la mesure de performance"],
      task: ["İlk hafta için tek gösterge seç ve modül bazında nasıl hesaplanacağını açıkla.", "Choose a first-week metric and explain how to calculate it for each module.", "Choisis un indicateur pour la première semaine et explique comment le calculer par module."],
      answer: ["Üretim ve Finans için SLA ihlali oranını ayrı ayrı ölçün. O hafta süresini aşan kayıt sayısını o hafta kapanan toplam kayıt sayısına bölün ve her iki sayıyı da verin.", "Measure the SLA breach rate separately for Production and Finance. Divide that week’s late closures by all tickets closed that week and show both counts.", "Mesurez le taux de dépassement du SLA séparément pour Production et Finance. Divisez le nombre de tickets clôturés en retard dans la semaine par le nombre total de clôtures, et affichez les deux volumes."],
    }],
    finalAnswer: [
      "İlk hafta **Üretim ve Finans’ın ayrı ayrı SLA ihlali oranını** izleyin. O hafta SLA hedefini aşarak çözülen talep sayısını o hafta çözülen tüm taleplere bölün. Oranın yanında ihlal ve toplam talep sayılarını da gösterin.",
      "Track the **SLA breach rate separately for Production and Finance**. Divide the tickets resolved late that week by all tickets resolved that week. Show the counts alongside the rate, especially when the volume is low.",
      "Suivez le **taux de dépassement du SLA pour chaque module, Production et Finance**. Divisez le nombre de tickets résolus en retard pendant la semaine par le total des tickets résolus sur la même période. Affichez les volumes à côté du taux.",
    ],
  },
  {
    question: [
      "Ekran görüntüsünde bu talebin geciktiğini ne gösteriyor?",
      "What in the screenshot shows that this ticket is overdue?",
      "Quels éléments de la capture montrent que ce ticket est en retard ?",
    ],
    experts: [{
      role: ["SLA Analisti", "SLA Analyst", "Analyste SLA"],
      task: ["Son tarihi, kontrol zamanını, talep durumunu ve SLA rozetini incele. Gecikmeyi hesapla.", "Check the deadline, time checked, ticket status, and SLA badge. Calculate the delay.", "Vérifie l’échéance, l’heure du contrôle, le statut du ticket et le badge SLA. Calcule le retard."],
      answer: ["SLA son tarihi 14:00, kontrol zamanı 16:30. Talep hâlâ açık ve kırmızı rozet 2 saat 30 dakikalık gecikmeyi doğruluyor.", "The deadline was 14:00 and the ticket was still open when checked at 16:30. The red badge confirms an SLA breach of 2 hours and 30 minutes.", "L’échéance était à 14 h et le ticket était encore ouvert lors du contrôle à 16 h 30. Le badge rouge confirme un dépassement de 2 h 30."],
    }],
    finalAnswer: [
      "Finans talebi **2 saat 30 dakika gecikmiş**. Son tarih 12 Kasım **14:00**, kontrol zamanı **16:30** ve talep hâlâ **Açık**. Kırmızı **SLA aşıldı** rozeti de gecikmeyi gösteriyor.",
      "The Finance ticket is **2 hours and 30 minutes overdue**. The SLA deadline was **14:00** on November 12. The ticket was still **Open** when checked at **16:30**, and the red **SLA breached** badge shows the same delay.",
      "Le ticket Finance est **en retard de 2 h 30**. L’échéance était fixée au 12 novembre à **14 h**. Lors du contrôle à **16 h 30**, le ticket était toujours **Ouvert**. Le badge rouge **SLA dépassé** indique le même retard.",
    ],
  },
  {
    question: [
      "Benzer SLA ihlallerini önlemek için nasıl bir uyarı kurabiliriz?",
      "What alert could prevent similar SLA breaches?",
      "Quelle alerte pourrait éviter des dépassements similaires ?",
    ],
    experts: [
      {
        role: ["İzleme ve Uyarı Uzmanı", "Monitoring and Alerting Specialist", "Spécialiste de la surveillance et des alertes"],
        task: ["Son tarihten önce uyarı vermek için bir eşik öner ve örnek talebe uygula.", "Propose a threshold for an advance alert and apply it to the sample ticket.", "Propose un seuil d’alerte avant l’échéance et applique-le au ticket d’exemple."],
        answer: ["Son tarihe 60 dakika kala talep hâlâ açıksa uyarı gönderin. T-ERP-024 için uyarı 13:00’te tetiklenirdi.", "Send an alert if the ticket is still open 60 minutes before its deadline. For T-ERP-024, the alert would have fired at 13:00.", "Envoyez une alerte si le ticket est toujours ouvert 60 minutes avant l’échéance. Pour T-ERP-024, l’alerte se serait déclenchée à 13 h."],
      },
      {
        role: ["Destek Operasyonları Uzmanı", "Support Operations Specialist", "Spécialiste des opérations de support"],
        task: ["Açık talepler için uyarının alıcısını ve eskalasyon koşulunu belirle.", "Choose who receives the alert and when an open ticket should be escalated.", "Détermine qui doit recevoir l’alerte et quand transmettre un ticket ouvert au responsable."],
        answer: ["İlk uyarıyı talep sahibine gönderin. Kayıt son tarihte hâlâ açıksa Finans destek sorumlusuna iletin.", "Send the first alert to the ticket owner. If the ticket is still open at the deadline, escalate it to the Finance support lead.", "Envoyez la première alerte à la personne chargée du ticket. Si le ticket est toujours ouvert à l’échéance, transmettez-le au responsable du support Finance."],
      },
    ],
    finalAnswer: [
      "**SLA süresinin bitmesine 60 dakika kala** talep hâlâ açıksa talep sahibine bildirim gönderin. T-ERP-024 için uyarı **13:00’te** giderdi. Kayıt **14:00’te** hâlâ açıksa Finans destek sorumlusuna otomatik olarak iletin.",
      "Notify the ticket owner **60 minutes before the SLA deadline** if the ticket is still open. For T-ERP-024, send the alert at **13:00**. If the ticket remains open at **14:00**, automatically escalate it to the Finance support lead.",
      "Prévenez la personne chargée du ticket **60 minutes avant l’échéance du SLA** si le ticket est toujours ouvert. Pour T-ERP-024, envoyez l’alerte à **13 h**. S’il reste ouvert à **14 h**, transmettez-le automatiquement au responsable du support Finance.",
    ],
  },
];

const diagramNodes: readonly [id: string, title: Copy, detail: Copy][] = [
  ["measure", ["İhlalleri belirle", "Locate the breaches", "Localiser les dépassements"], ["Üretim ve Finans’ı ayrı ayrı incele.", "Check Production and Finance separately.", "Examiner Production et Finance séparément."]],
  ["alert", ["Kritik taleplere uyarı ekle", "Set a critical-ticket alert", "Configurer une alerte"], ["Üç saat yanıtsızsa uyarı gönder.", "Alert after three hours without a response.", "Alerter après trois heures sans réponse."]],
  ["review", ["Kapanışları incele", "Review closure checks", "Examiner les clôtures"], ["Kayıtların neden yeniden açıldığını incele.", "Check why overdue tickets were reopened.", "Vérifier pourquoi les tickets ont été rouverts."]],
  ["check", ["Haftalık sonucu ölç", "Check results after a week", "Mesurer après une semaine"], ["Her modülün ihlal oranını yeniden ölç.", "Measure each module’s breach rate.", "Mesurer le taux de dépassement par module."]],
];

function diagram(language: Language): SolutionFlow {
  return {
    nodes: diagramNodes.map(([id, title, detail], index) => ({
      id, title: translate(title, language), detail: translate(detail, language),
      kind: index === diagramNodes.length - 1 ? "end" : "step",
    })),
    edges: diagramNodes.slice(1).map(([id], index) => ({ from: diagramNodes[index][0], to: id, label: "" })),
  };
}

const tableLabels: Copy[] = [
  ["talep_no", "ticket_id", "id_ticket"], ["modul", "module", "module"], ["oncelik", "priority", "priorite"],
  ["ilk_yanit_saat", "first_response_hours", "premiere_reponse_heures"], ["cozum_saat", "resolution_hours", "resolution_heures"],
  ["sla_hedef_saat", "sla_target_hours", "objectif_sla_heures"], ["memnuniyet_1_5", "satisfaction_1_5", "satisfaction_1_5"],
  ["yeniden_acildi", "reopened", "rouvert"], ["Üretim", "Production", "Production"], ["Finans", "Finance", "Finance"],
  ["Satış", "Sales", "Ventes"], ["Stok", "Inventory", "Stock"], ["Normal", "Normal", "Normale"], ["Düşük", "Low", "Basse"],
  ["Yüksek", "High", "Haute"], ["Kritik", "Critical", "Critique"],
];

const byQuestion = new Map(turns.map((turn, index) => [turn.question[0], { turn, index }]));
export const questions = turns.map(turn => turn.question[0]);
export const ticketEvidence = "Örnek T-ERP-024 Finans talebi açık. SLA son tarihi 12 Kasım 14:00, kontrol zamanı 12 Kasım 16:30. Rozette “SLA aşıldı · 2 sa 30 dk” yazıyor.";

export function scriptStep(index: number) {
  const turn = turns[index];
  return {
    agents: turn.experts.map((expert, index) => ({ agentId: index + 1, role: expert.role[0], task: expert.task[0] })),
    expertAnswers: turn.experts.map(expert => expert.answer[0]),
    finalAnswer: turn.finalAnswer[0],
    diagram: index === 0 ? diagram("tr") : undefined,
  };
}

export const scenario: DemoScenario = {
  question: questions[0],
  followUps: questions.slice(1).map((question, index) => ({ question, attachment: index === 1 ? screenshot : undefined })),
  model: { id: "demo" },
  installationUrl: "https://github.com/Demko1969/PBots/blob/main/deployment/README.md",
  expertCount: prompt => byQuestion.get(prompt)?.turn.experts.length ?? 0,
  csv,
  download: "data:text/csv;charset=utf-8," + encodeURIComponent(csv.text),
  presentation(language) {
    const labels = new Map(tableLabels.map(entry => [entry[0], translate(entry, language)]));
    const tableLabel = (value: string) => labels.get(value) ?? value;
    function agent(question: string, value: Agent) {
      const copy = byQuestion.get(question)?.turn.experts[value.agentId - 1];
      if (!copy) return value;
      return {
        ...value, role: translate(copy.role, language), task: translate(copy.task, language),
        answer: value.answer ? translate(copy.answer, language) : undefined,
      };
    }
    return {
      question(question) {
        const match = byQuestion.get(question);
        return match ? translate(match.turn.question, language) : question;
      },
      agent,
      result(question, result) {
        const match = byQuestion.get(question);
        if (!match) return result;
        const finalAnswer = translate(match.turn.finalAnswer, language);
        return { ...result, finalAnswer, displayAnswer: finalAnswer, answers: result.answers.map(value => agent(question, value)) };
      },
      diagram: (question, flow) => question === questions[0] ? diagram(language) : flow,
      imageUrl: question => question === questions[2] ? images[language] : undefined,
      tableLabel,
    };
  },
};
