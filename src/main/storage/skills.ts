import { join } from 'node:path';
import { app } from 'electron';
import { JsonStore } from './json-store.js';

// Skills are reusable browser-automation playbooks (markdown bodies). Any MCP
// client — Claude Code CLI, Claude.ai web, Claude mobile — can list, fetch, and
// save them through the four `*_skill` tools. Storage is per-profile so work
// and personal skills don't bleed.

export interface Skill {
  id: string; // slug, e.g. "facebook-search-friend"
  name: string;
  description: string;
  domain?: string; // e.g. "facebook.com" — used for site-context lookup
  triggers?: string[]; // optional natural-language hints
  body: string; // markdown: steps, selectors, pitfalls
  createdAt: number;
  updatedAt: number;
  usedAt?: number;
  useCount: number;
}

export type SkillSummary = Omit<Skill, 'body'>;

interface SkillsFile {
  skills: Skill[];
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 64);
}

function summarize(s: Skill): SkillSummary {
  const { body: _body, ...rest } = s;
  return rest;
}

export class SkillsStore {
  private store: JsonStore<SkillsFile>;

  constructor(profile: string) {
    const path = join(app.getPath('userData'), 'profiles', profile, 'skills.json');
    this.store = new JsonStore<SkillsFile>(path, { skills: [] });
  }

  async list(filter?: { domain?: string; query?: string }): Promise<SkillSummary[]> {
    const data = await this.store.read();
    let items = data.skills;
    if (filter?.domain) {
      const d = filter.domain.toLowerCase();
      items = items.filter((s) => s.domain?.toLowerCase() === d);
    }
    if (filter?.query) {
      const q = filter.query.toLowerCase();
      items = items.filter(
        (s) =>
          s.id.includes(q) ||
          s.name.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.triggers?.some((t) => t.toLowerCase().includes(q)),
      );
    }
    return items
      .map(summarize)
      .sort((a, b) => (b.usedAt ?? b.updatedAt) - (a.usedAt ?? a.updatedAt));
  }

  async get(id: string): Promise<Skill | undefined> {
    const data = await this.store.read();
    return data.skills.find((s) => s.id === id);
  }

  async save(input: {
    id?: string;
    name: string;
    description: string;
    domain?: string;
    triggers?: string[];
    body: string;
  }): Promise<Skill> {
    const id =
      input.id && SLUG_RE.test(input.id) ? input.id : slugify(input.id ?? input.name);
    if (!id) throw new Error('Skill id could not be derived from name/id');

    const now = Date.now();
    let saved: Skill | null = null;
    await this.store.update((cur) => {
      const existing = cur.skills.find((s) => s.id === id);
      const next: Skill = existing
        ? {
            ...existing,
            name: input.name,
            description: input.description,
            domain: input.domain ?? existing.domain,
            triggers: input.triggers ?? existing.triggers,
            body: input.body,
            updatedAt: now,
          }
        : {
            id,
            name: input.name,
            description: input.description,
            domain: input.domain,
            triggers: input.triggers,
            body: input.body,
            createdAt: now,
            updatedAt: now,
            useCount: 0,
          };
      saved = next;
      return {
        skills: existing
          ? cur.skills.map((s) => (s.id === id ? next : s))
          : [...cur.skills, next],
      };
    });
    return saved!;
  }

  async delete(id: string): Promise<boolean> {
    let found = false;
    await this.store.update((cur) => {
      const next = cur.skills.filter((s) => s.id !== id);
      found = next.length !== cur.skills.length;
      return { skills: next };
    });
    return found;
  }

  async recordUse(id: string): Promise<void> {
    await this.store.update((cur) => ({
      skills: cur.skills.map((s) =>
        s.id === id ? { ...s, usedAt: Date.now(), useCount: s.useCount + 1 } : s,
      ),
    }));
  }
}
