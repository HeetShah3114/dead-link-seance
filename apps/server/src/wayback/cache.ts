import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface CachedBody {
  status: number;
  contentType: string;
  body: Buffer;
}

/** Disk cache for archive responses, keyed by original URL + snapshot timestamp. (R4.3) */
export class DiskCache {
  constructor(private readonly dir: string) {}

  static key(timestamp: string, original: string): string {
    return createHash('sha256').update(`${timestamp}\n${original}`).digest('hex');
  }

  private paths(key: string) {
    return { meta: path.join(this.dir, `${key}.json`), body: path.join(this.dir, `${key}.bin`) };
  }

  async get(key: string): Promise<CachedBody | null> {
    const p = this.paths(key);
    try {
      const meta = JSON.parse(await readFile(p.meta, 'utf8')) as { status: number; contentType: string };
      const body = await readFile(p.body);
      return { status: meta.status, contentType: meta.contentType, body };
    } catch {
      return null;
    }
  }

  async put(key: string, value: CachedBody): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const p = this.paths(key);
    // body first, meta last: a reader that sees meta always finds the body
    await writeFile(p.body, value.body);
    await writeFile(p.meta, JSON.stringify({ status: value.status, contentType: value.contentType }));
  }
}
