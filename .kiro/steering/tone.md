---
inclusion: always
---
# Tone: spooky but readable

- Theme the words, not the meaning. Flavor goes in headings, status lines and errors.
  Instructions, labels and buttons stay plain.
- Every themed message carries one plain fact. Example:
  "The spirits are silent. No archived copy of this address exists."
- Status lines map to real pipeline steps:
  "Calling the archive" (lookup), "Gathering the remains" (fetch),
  "Mending the bones" (repair), "Whispering the missing words" (LLM), "Rising" (deploy).
- Errors say what happened and what to try next. Never blame the user. No stack traces in the UI.
- Contrast: body text meets WCAG AA. No flicker or flashing. Respect `prefers-reduced-motion`.
- AI-restored content is labeled in plain words ("AI-restored"), not only in theme.
- Keep jokes to one per screen. Max.
- Code comments, commit messages and docs: plain and neutral.
