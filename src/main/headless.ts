// Headless mode resolver (Plan #4).
//
// Two equivalent toggles — CLI flag wins if both are set:
//   - --headless                    on process.argv
//   - GHOSTPILOT_HEADLESS=1         on process.env
//
// Kept as a pure function so unit tests can exercise every permutation
// without booting Electron.

export function isHeadless(argv: string[], env: NodeJS.ProcessEnv): boolean {
  if (argv.includes('--headless')) return true;
  return env.GHOSTPILOT_HEADLESS === '1';
}
