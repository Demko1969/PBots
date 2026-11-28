# Ortak Akıl tarayıcı demosu

Demo, Ortak Akıl’ın sohbet arayüzünü ve 20 örnek ERP destek talebini kullanır.
Gönder düğmesiyle başlayın. Botlardan iki uzman görüşüne geçebilir, nihai
yanıtın yanındaki düğmeyle çözüm akışını açabilir ve hazır takip sorusunu
gönderebilirsiniz. Ayarlar model seçeneklerini gösterir. + menüsünden örnek
CSV’nin önizlemesine ve indirme bağlantısına ulaşabilirsiniz. Demo, örnek yanıtları tarayıcıda gösterir ve OpenAI isteği yapmaz.

Geliştirme ortamında `pnpm --dir ui install --frozen-lockfile` komutuyla
bağımlılıkları yükleyip kök klasörden `npm run demo:build` çalıştırın.
`output/web-demo/Ortak-Akil-Demo.html` dosyasını doğrudan bir tarayıcıda açabilirsiniz.

İnceleme PR’ı derleme ve testleri çalıştırır ve bağımsız HTML’yi bir Actions
çıktısı olarak hazırlar. Pages çıktısı yalnızca `index.html` ve derlenmiş
`assets/` klasörünü içerir. Yerelde bir HTTP sunucusunda bu iki öğeyi
`/ortak-akil/` altında sunarak proje yolunu deneyebilirsiniz.

Yayın onaylandığında `Demko1969/ortak-akil` deposunda **Settings → Pages →
Source → GitHub Actions** seçin. İş akışı varsayılan dala eklendikten sonra bu
dalı seçip **Actions → Ortak Akıl web demo → Run workflow** üzerinden yayınlayın.
Sonucu [proje adresinde](https://demko1969.github.io/ortak-akil/) doğrulayın.

Çevrimdışı indirme ayrıca yayımlanabilir. `Ortak-Akil-Demo.html` dosyasını yerel
derlemeden veya iş akışının **Artifacts** bölümündeki ZIP dosyasından alın ve
aynı deponun GitHub Release’inde **Assets** bölümüne ekleyin.
