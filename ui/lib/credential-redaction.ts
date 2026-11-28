const credentialPattern = /\b(?:sk-(?:proj-|svcacct-|admin-)?[a-z0-9_-]{16,}|AIza[a-z0-9_-]{35}|Bearer\s+[^\s"']{16,})/gi;

export function redactCredentials(text: string) {
  return text.replace(credentialPattern, "[gizlendi]");
}
