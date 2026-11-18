/** Pick a charset: HTTP header, then <meta>, else utf-8. Old pages are often latin1. */
export function sniffCharset(contentType: string, body: Buffer): string {
  const fromHeader = /charset\s*=\s*["']?([\w.:-]+)/i.exec(contentType)?.[1];
  if (fromHeader) return fromHeader.toLowerCase();
  const head = body.subarray(0, 2048).toString('latin1');
  const fromMeta = /<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/i.exec(head)?.[1];
  return fromMeta ? fromMeta.toLowerCase() : 'utf-8';
}

export function decodeHtml(contentType: string, body: Buffer): string {
  const charset = sniffCharset(contentType, body);
  try {
    return new TextDecoder(charset).decode(body);
  } catch {
    return new TextDecoder('utf-8').decode(body);
  }
}
