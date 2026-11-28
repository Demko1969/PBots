export const brandLogo = "/ortak-akil-lens.svg";
export const isDemoTransport = false;
export const robotSprite = "/planning-bots.svg";

export function appRequest(url: string, options?: RequestInit) {
  return fetch(url, options);
}
