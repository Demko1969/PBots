import { useState } from "react";
import { createRoot } from "react-dom/client";
import { parseCsv } from "../lib/table";
import csv from "../tests/fixtures/support.csv?raw";
import logo from "../public/ortak-akil-lens.svg?inline";
import "../app/globals.css";
import "./style.css";

const dataset = parseCsv(csv, "support.csv");
const column = (name: string) => dataset.columns.indexOf(name);
const breaches = dataset.rows.filter(row => Number(row[column("cozum_saat")]) > Number(row[column("sla_hedef_saat")]));
const rate = new Intl.NumberFormat("tr-TR", { style: "percent" }).format(breaches.length / dataset.rows.length);
const modules = [...new Set(dataset.rows.map(row => row[column("modul")]))];
const counts = modules.map(name => ({ name, count: breaches.filter(row => row[column("modul")] === name).length }));
const tabs = ["Nihai yanıt", "SLA uzmanı", "Destek süreci uzmanı"] as const;
const question = "ERP destek taleplerinde SLA en çok hangi modüllerde aşılıyor ve önce neyi iyileştirmeliyiz?";
const csvDownload = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);

function Demo() {
  const [result, setResult] = useState(false);
  const [active, setActive] = useState(0);
  const [preview, setPreview] = useState(false);
  return <main className="app-shell demo">
    <header className="topbar">
      <div className="brand"><img className="brand-logo" src={logo} alt="" /><span className="brand-name">Ortak Akıl</span></div>
      <a href="https://github.com/Demko1969/ortak-akil">GitHub</a>
    </header>
    <div className="demo-content">
      <h1>ERP destek taleplerini analiz et</h1>
      <p className="demo-intro">Örnek veriyle Planner, bağımsız uzmanlar ve Judge adımlarını keşfet. Demo hazır yanıtlar kullanır ve API anahtarı istemez.</p>
      <section className="demo-card" aria-labelledby="demo-question">
        <h2 id="demo-question">{question}</h2>
        <div className="demo-actions">
          <button type="button" className="primary-button" onClick={() => { setResult(true); setActive(0); }}>Örnek analizi göster</button>
          <button type="button" aria-expanded={preview} aria-controls="demo-preview" onClick={() => setPreview(!preview)}>CSV önizlemesi</button>
          <a href={csvDownload} download="support.csv">CSV’yi indir</a>
        </div>
        <div id="demo-preview" hidden={!preview}>
          <div className="demo-table" tabIndex={0} role="region" aria-label="CSV örnek satırları">
            <table>
              <caption>{dataset.name} · {dataset.rows.length} talep · İlk 5 satır</caption>
              <thead><tr>{dataset.columns.map(name => <th scope="col" key={name}>{name}</th>)}</tr></thead>
              <tbody>{dataset.rows.slice(0, 5).map(row => <tr key={row[0]}>{row.map((value, j) => <td key={dataset.columns[j]}>{value || "—"}</td>)}</tr>)}</tbody>
            </table>
          </div>
        </div>
      </section>
      {result && <section className="demo-card" aria-label="Örnek analiz sonucu">
        <details>
          <summary>Planner · Uzman görevleri</summary>
          <ul>
            <li>SLA uzmanı çözüm sürelerini eşiklerle karşılaştırır ve ihlalleri modüle göre sayar.</li>
            <li>Destek süreci uzmanı kritik ve yeniden açılan taleplere bakarak iyileştirme önerir.</li>
          </ul>
        </details>
        <div role="group" aria-label="Analiz görünümleri" className="demo-actions demo-views">
          {tabs.map((label, i) => <button type="button" key={label} aria-pressed={active === i} onClick={() => setActive(i)}>{label}</button>)}
        </div>
        <div aria-live="polite">
          {active === 0 && <>
            <h2>Judge · Önce Üretim ve Finans</h2>
            <p><strong>{dataset.rows.length} talebin {breaches.length} tanesi ({rate})</strong> SLA sınırını aştı. İhlallerin tamamı Üretim ve Finans modüllerinde görülüyor. Kritik talepler için erken uyarı başlat ve yeniden açılan kayıtların nedenlerini incele.</p>
          </>}
          {active === 1 && <>
            <h2>SLA ihlalleri</h2>
            <ul>{counts.map(({name, count}) => <li key={name}>{name} · {count} ihlal</li>)}</ul>
            <p>24 saatte çözülen T020 hedefi karşılıyor. Yalnızca hedefin üzerindeki çözüm süreleri ihlal sayıldı.</p>
          </>}
          {active === 2 && <>
            <h2>Yeniden açılan talepler</h2>
            <p>SLA’yı aşan {breaches.length} talebin {breaches.filter(row => row[column("yeniden_acildi")] === "1").length} tanesi yeniden açıldı. Haftalık incelemede ilk müdahale, kapanış kalitesi ve yeniden açılma nedenlerini ayrı ayrı izle.</p>
          </>}
        </div>
      </section>}
    </div>
  </main>;
}
createRoot(document.getElementById("root")!).render(<Demo />);
