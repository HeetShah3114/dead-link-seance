import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { injectBanner, type BannerOptions } from './banner.js';

export interface BuildInput extends BannerOptions {
  /** Repaired HTML for the start page. */
  html: string;
  /** Output folder for the static site. */
  outDir: string;
}

/** Build v0 (task 1.4): one page, banner injected, written as index.html. */
export async function buildSiteV0(input: BuildInput): Promise<{ indexPath: string }> {
  const { html, outDir, ...banner } = input;
  await mkdir(outDir, { recursive: true });
  const indexPath = path.join(outDir, 'index.html');
  await writeFile(indexPath, injectBanner(html, banner), 'utf8');
  return { indexPath };
}
