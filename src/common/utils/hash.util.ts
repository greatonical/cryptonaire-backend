import crypto from 'node:crypto';

export function canonicalizeQuestion(text: string, options: string[]): string {
  const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
  const t = norm(text);
  const o = options.map(norm).join('|');
  return `${t}::${o}`;
}

export function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}