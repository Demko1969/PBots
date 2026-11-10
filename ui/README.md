# Ortak Akıl Web Arayüzü

Bu klasör çoklu uzman n8n workflow'larının web arayüzünü içerir.

```sh
cp .env.example .env.local
pnpm install
pnpm dev
```

Varsayılan olarak `http://127.0.0.1:5678/webhook` adresindeki n8n webhook'larına sunucu üzerinden bağlanır. Dört `Multi-Agent UI - ... API` workflow'unun n8n içinde import edilmiş, alt-workflow seçimlerinin yapılmış ve aktif olması gerekir.

Ana proje kurulumu ve Google Docs adımları için üst dizindeki `README.md` dosyasını kullanın.
