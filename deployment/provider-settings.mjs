import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { isProvider, providers } from '../ui/lib/provider-catalog.mjs';

export async function openProviderSettings(path, secret) {
  const key = createHash('sha256').update('PBots provider settings\0').update(secret).digest();
  let settings = { keys: {} };
  try {
    const stored = JSON.parse(await readFile(path, 'utf8'));
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(stored.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(stored.tag, 'base64'));
    settings = JSON.parse(decipher.update(stored.data, 'base64', 'utf8') + decipher.final('utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('Provider settings could not be read. Restore the original settings and internal access volumes.');
  }
  let pending = Promise.resolve();
  function update(mutate) {
    const write = pending.then(async () => {
      const next = structuredClone(settings);
      mutate(next);
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const data = cipher.update(JSON.stringify(next), 'utf8', 'base64') + cipher.final('base64');
      await writeFile(path + '.pending', JSON.stringify({
        iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data,
      }), { mode: 0o600 });
      await rename(path + '.pending', path);
      settings = next;
    });
    pending = write.catch(() => {});
    return write;
  }
  return {
    key: provider => settings.keys[provider],
    status: () => ({
      defaultProvider: settings.defaultProvider ?? null,
      providers: Object.entries(providers).map(([id, info]) => ({ id, ...info, configured: !!settings.keys[id] })),
    }),
    save: (provider, apiKey) => update(next => {
      next.keys[provider] = apiKey;
      next.defaultProvider ??= provider;
    }),
    setDefault: provider => update(next => { next.defaultProvider = provider; }),
  };
}

export function validProviderKey(provider, key) {
  return isProvider(provider) && typeof key === 'string' && /^[!-~]{16,512}$/.test(key);
}
