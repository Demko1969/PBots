# Ortak Akıl tarayıcı demosu

Demo, Ortak Akıl’ın sohbet arayüzünü ve 20 örnek ERP destek talebini kullanır.
Gönder düğmesiyle başlayın. Botlardan iki uzman görüşüne geçebilir, nihai
yanıtın yanındaki düğmeyle çözüm akışını açabilir ve hazır takip sorusunu
gönderebilirsiniz. Ayarlar model seçeneklerini gösterir. + menüsünden örnek
CSV’nin önizlemesine ve indirme bağlantısına ulaşabilirsiniz. Demo, örnek yanıtları tarayıcıda gösterir ve OpenAI isteği yapmaz.

Geliştirme ortamında `pnpm --dir ui install --frozen-lockfile` komutuyla
bağımlılıkları yükleyip kök klasörden `npm run demo:build` çalıştırın.
`output/web-demo/Ortak-Akil-Demo.html` dosyasını doğrudan bir tarayıcıda açabilirsiniz.

GitHub Pages kurulumu için depoda **Settings → Pages → Source → GitHub Actions**
seçin. Ardından **Actions → Ortak Akıl web demo → Run workflow** üzerinden
yayınlayın. Çalışmanın **Artifacts** bölümünden çevrimdışı demoyu indirebilirsiniz.
