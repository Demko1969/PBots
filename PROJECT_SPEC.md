# OpenAI Çoklu Uzman Sistemi — Teknik Sözleşme

## Akış

1. Planner `question` ve `openaiModel` alır; 1-10 uzman rolü üretir.
2. Worker her uzman için `question`, `openaiModel`, rol ve görev alır; bağımsız yanıt döndürür.
3. Judge bütün Worker yanıtlarını OpenAI Responses API ile birleştirir ve kısa özet üretir.
4. UI sonucu gösterir; kullanıcı isterse Google Docs raporu oluşturur.

## Varsayılan model

Web sunucusu `OPENAI_MODEL` değerini kullanıcıya başlangıç önerisi olarak sunar. Varsayılan değer `gpt-5-mini`'dir. Kullanıcı bu değeri değiştirebilir; workflow'lar seçilen `model`/`openaiModel` değerini sistem boyunca korur ve bütün OpenAI çağrılarında kullanır.

## Güvenlik sınırı

OpenAI API anahtarı yalnızca n8n Header Auth credential'ında tutulur. Git deposuna credential değeri, Authorization başlığı veya başka bir sır eklenmez.

## Kaynak gerçek ve senkronizasyon

n8n kaynak gerçektir. `scripts/sync-n8n.sh`, tanımlı sekiz n8n workflow ID'sini aynı adla var olan `workflows/` dosyalarına atomik olarak aktarır. Tanımsız workflow'ları dışa aktarmaz.
