# Ortak Akıl Web Arayüzü

Docker kurulumu için [ana kılavuza](../README.md), mevcut bir yerel n8n ile
çalıştırmak için [elle kurulum adımlarına](../deployment/README.md#standalone-with-an-existing-local-n8n)
bakın. Git'te izlenen ortam şablonu proje kökündeki `.env.example` dosyasıdır.
Elle kurulumda onu `ui/.env.local` olarak kopyalayın ve yalnızca sunucunun
kullandığı n8n webhook anahtarını ekleyin.

Yerel doğrulama

```sh
pnpm install --frozen-lockfile
npm test
npm run lint
pnpm exec tsc --noEmit --incremental false
```
