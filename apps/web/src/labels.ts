import type { StepInfo, StepName, StepState } from '@seance/shared';

/** Themed names for pipeline steps. Each is paired with a plain description. See tone.md. */
export const STEP_LABEL: Record<StepName, { spooky: string; plain: string }> = {
  lookup: { spooky: 'Calling the archive', plain: 'Looking for the best saved copy' },
  fetch: { spooky: 'Gathering the remains', plain: 'Downloading the saved page' },
  repair: { spooky: 'Mending the bones', plain: 'Fixing links and images' },
  aifill: { spooky: 'Whispering the missing words', plain: 'AI fills gaps, always marked' },
  build: { spooky: 'Binding the pages', plain: 'Building the site' },
  deploy: { spooky: 'Rising', plain: 'Publishing the site' },
};

export const STATE_TEXT: Record<StepState, string> = {
  pending: 'Waiting',
  active: 'In progress',
  done: 'Done',
  failed: 'Failed',
};

export function describeStep(s: StepInfo): { title: string; plain: string; state: string; detail?: string } {
  const label = STEP_LABEL[s.name];
  return {
    title: label.spooky,
    plain: label.plain,
    state: STATE_TEXT[s.state],
    ...(s.detail ? { detail: s.detail } : {}),
  };
}
