// Multi-profile support: cookies, localStorage, and persisted data isolate per profile name.
// Switching profile requires relaunching the app (Electron sessions are tied to lifecycle).

const PROFILE_REGEX = /^[a-zA-Z0-9_-]{1,32}$/;

export function getActiveProfile(): string {
  const raw = process.env.AI_BROWSER_PROFILE?.trim();
  if (!raw) return 'default';
  if (!PROFILE_REGEX.test(raw)) {
    console.warn(`[profile] invalid AI_BROWSER_PROFILE="${raw}", falling back to "default"`);
    return 'default';
  }
  return raw;
}

export function partitionFor(profile: string): string {
  return `persist:profile-${profile}`;
}
