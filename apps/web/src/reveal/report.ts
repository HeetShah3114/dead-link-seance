import type { JobResult } from '@seance/shared';

export interface ReportLine {
  label: string;
  value: string;
}

/** Plain report rows for the reveal screen. (R9.4) */
export function reportLines(r: JobResult): ReportLine[] {
  const rep = r.report;
  const lines: ReportLine[] = [
    { label: 'Pages', value: `${rep.pagesRecovered} of ${rep.pagesFound} came back` },
    { label: 'Images and files', value: `${rep.assetsRecovered} of ${rep.assetsFound} came back` },
  ];
  if (rep.formsDisabled > 0) lines.push({ label: 'Forms', value: `${rep.formsDisabled} switched off (their server is gone)` });
  lines.push({
    label: 'AI-restored',
    value: rep.aiSkipped ? 'None' : `${rep.aiRestoredItems} item${rep.aiRestoredItems === 1 ? '' : 's'}, each marked "AI guess"`,
  });
  if (rep.reused) lines.push({ label: 'Note', value: 'Reused an earlier resurrection of this snapshot' });
  return lines;
}

/** Share links must be absolute, even when the site is served by this app. */
export function absoluteUrl(url: string, origin: string): string {
  try {
    return new URL(url, origin).href;
  } catch {
    return url;
  }
}
