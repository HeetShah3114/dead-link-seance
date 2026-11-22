import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { zipSync, type Zippable } from 'fflate';

/** Zip a built site folder into memory. Sites are capped at MAX_SITE_BYTES, so this stays small. (R10.4) */
export async function zipFolder(dir: string, rootName: string): Promise<Uint8Array> {
  const files: Zippable = {};
  async function walk(rel: string): Promise<void> {
    for (const e of await readdir(path.join(dir, rel), { withFileTypes: true })) {
      const child = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(child);
      else if (e.isFile()) files[`${rootName}/${child}`] = new Uint8Array(await readFile(path.join(dir, child)));
    }
  }
  await walk('');
  // Fixed mtime keeps the zip identical for the same site.
  return zipSync(files, { level: 6, mtime: new Date('2000-01-01T00:00:00Z') });
}
