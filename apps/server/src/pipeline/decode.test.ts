import { describe, it, expect } from 'vitest';
import { decodeHtml, sniffCharset } from './decode.js';

describe('decode', () => {
  it('prefers the HTTP header charset', () => {
    expect(sniffCharset('text/html; charset=ISO-8859-1', Buffer.from('<meta charset="utf-8">'))).toBe('iso-8859-1');
  });

  it('falls back to <meta> then utf-8', () => {
    expect(sniffCharset('text/html', Buffer.from('<meta http-equiv="Content-Type" content="text/html; charset=windows-1252">'))).toBe('windows-1252');
    expect(sniffCharset('text/html', Buffer.from('<p>x</p>'))).toBe('utf-8');
  });

  it('decodes latin1 bytes correctly', () => {
    const body = Buffer.from([0x63, 0x61, 0x66, 0xe9]); // "café" in latin1
    expect(decodeHtml('text/html; charset=iso-8859-1', body)).toBe('café');
  });

  it('survives an unknown charset', () => {
    expect(decodeHtml('text/html; charset=nonsense-9', Buffer.from('ok'))).toBe('ok');
  });
});
