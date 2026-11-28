# Ortak Akıl tarayıcı demosu

Demo, 20 örnek ERP destek talebini kullanır. Planner görevlerini, iki bağımsız
uzman görüşünü ve Judge kararını gösterir. CSV tarayıcıda okunur ve demo OpenAI
isteği yapmaz.

Geliştirme ortamında `pnpm --dir ui install --frozen-lockfile` komutuyla
bağımlılıkları yükleyip kök klasörden `npm run demo:build` çalıştırın.
`output/web-demo/Ortak-Akil-Demo.html` dosyasını doğrudan bir tarayıcıda açabilirsiniz.

GitHub Pages kurulumu için depoda **Settings → Pages → Source → GitHub Actions**
seçin. Ardından **Actions → Ortak Akıl web demo → Run workflow** üzerinden
yayınlayın. Çalışmanın **Artifacts** bölümünden çevrimdışı demoyu indirebilirsiniz.
