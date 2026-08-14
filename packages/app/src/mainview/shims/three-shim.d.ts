// electrobun's bun API imports `three` (untyped, no @types package) — silence
// the TS7016 "could not find a declaration file" error for that internal use.
declare module "three"
