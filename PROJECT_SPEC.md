# OpenAI Çoklu Uzman Sistemi — Teknik Sözleşme

## Akış

1. Planner `question` ve `openaiModel` alır; 1-10 uzman rolü üretir.
2. Worker her uzman için `question`, `openaiModel`, rol ve görev alır; bağımsız yanıt döndürür.
3. Judge bütün Worker yanıtlarını OpenAI Responses API ile birleştirir ve kısa özet üretir.
4. UI sonucu gösterir; kullanıcı isterse Google Docs raporu oluşturur.

## Varsayılan model

Web sunucusu `OPENAI_MODEL` değerini kullanıcıya başlangıç önerisi olarak sunar. Varsayılan değer `gpt-5-mini`'dir. Kullanıcı bu değeri değiştirebilir; workflow'lar seçilen `model`/`openaiModel` değerini sistem boyunca korur ve bütün OpenAI çağrılarında kullanır.

## Güvenlik sınırı

OpenAI API anahtarı yalnızca n8n Header Auth credential'ında tutulur. UI webhook’ları ayrı bir `X-Multi-Agent-Key` credential’ı gerektirir. Web sunucusu geçerli biçimde yapılandırılmış bir sunucu anahtarı olmadan webhook isteği göndermez. Dışa aktarılan webhook ve sohbet akışları etkin değildir. Sohbet akışı n8n editörüyle sınırlıdır.

Yerel SQLite, değerlendirme geçmişi ile aynı istek anahtarının eş zamanlı yürütülmesini önleyen süreli kilitleri saklar. `showDiagram` ve `diagramIssue` geçmişte korunur. CSV önizlemesindeki tanınabilir kimlik bilgileri yazma sırasında gizlenir.

## Kaynak gerçek ve senkronizasyon

n8n kaynak gerçektir. `scripts/sync-n8n.sh`, tanımlı sekiz n8n workflow ID'sini çalışma dizinine yazmadan önce doğrular, sabitlenmiş örnek verileri temizler ve `workflows/` dosyalarını günceller. Değişiklikleri commit etmeden önce inceleyin.
