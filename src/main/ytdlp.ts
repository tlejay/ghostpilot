// yt-dlp wrapper — handles HLS playlists, DASH manifests, and "smart" page URLs
// (YouTube, Twitter, Vimeo, ~1500 sites) that the network sniffer can't catch
// because the video is encrypted / chunked through MSE.
//
// We don't bundle yt-dlp; we detect a system install. Most users on a Mac get
// it via `brew install yt-dlp`. If missing we surface that to the UI so the
// user can install it.

import { app, type BrowserWindow, shell } from 'electron';
import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

const COMMON_PATHS = [
  '/opt/homebrew/bin/yt-dlp',
  '/usr/local/bin/yt-dlp',
  '/opt/local/bin/yt-dlp',
  join(homedir(), '.local/bin/yt-dlp'),
];

export interface YtdlpStatus {
  installed: boolean;
  path?: string;
  version?: string;
  error?: string;
}

export interface YtdlpJob {
  id: string;
  url: string;
  filename?: string;
  outputDir: string;
  progressPercent?: number;
  speed?: string;
  eta?: string;
  state: 'starting' | 'downloading' | 'completed' | 'failed' | 'cancelled';
  startedAt: number;
  endedAt?: number;
  errorMessage?: string;
  resultPath?: string;
}

let cachedStatus: YtdlpStatus | null = null;

async function whichYtdlp(): Promise<string | null> {
  for (const p of COMMON_PATHS) {
    if (existsSync(p)) return p;
  }
  try {
    const { stdout } = await execFileP('/usr/bin/which', ['yt-dlp']);
    const path = stdout.trim();
    if (path && existsSync(path)) return path;
  } catch {
    /* not on PATH */
  }
  return null;
}

export async function detectYtdlp(force = false): Promise<YtdlpStatus> {
  if (cachedStatus && !force) return cachedStatus;
  const path = await whichYtdlp();
  if (!path) {
    cachedStatus = { installed: false, error: 'yt-dlp not found on PATH' };
    return cachedStatus;
  }
  try {
    const { stdout } = await execFileP(path, ['--version']);
    cachedStatus = { installed: true, path, version: stdout.trim() };
  } catch (err) {
    cachedStatus = { installed: false, path, error: (err as Error).message };
  }
  return cachedStatus;
}

interface DownloadOptions {
  outputDir?: string;
  audioOnly?: boolean;
  format?: string;
}

export class YtdlpManager {
  private jobs = new Map<string, { job: YtdlpJob; child?: ReturnType<typeof spawn> }>();
  private window: BrowserWindow;

  constructor(window: BrowserWindow) {
    this.window = window;
  }

  list(): YtdlpJob[] {
    return [...this.jobs.values()].map((e) => e.job).sort((a, b) => b.startedAt - a.startedAt);
  }

  async download(url: string, opts: DownloadOptions = {}): Promise<YtdlpJob> {
    const status = await detectYtdlp();
    if (!status.installed || !status.path) {
      throw new Error(
        'yt-dlp is not installed. Install it with `brew install yt-dlp` or visit https://github.com/yt-dlp/yt-dlp/wiki/Installation',
      );
    }

    const id = randomUUID();
    const outputDir = opts.outputDir ?? app.getPath('downloads');
    const job: YtdlpJob = {
      id,
      url,
      outputDir,
      state: 'starting',
      startedAt: Date.now(),
    };

    const args = [
      url,
      '-P',
      outputDir,
      '--no-playlist',
      '--newline',
      '--progress',
      '-o',
      '%(title)s-%(id)s.%(ext)s',
    ];
    if (opts.audioOnly) args.push('-x', '--audio-format', 'mp3');
    if (opts.format) args.push('-f', opts.format);

    const child = spawn(status.path, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    this.jobs.set(id, { job, child });
    job.state = 'downloading';
    this.broadcast(job);

    // Parse `[download]   12.5% of 50.34MiB at 5.20MiB/s ETA 00:31`
    const progressRe = /\[download\]\s+(\d+(?:\.\d+)?)% of\s+\S+\s+at\s+(\S+)\s+ETA\s+(\S+)/;
    // Parse the final "Destination: …" or "[download] … has already been downloaded"
    const destRe = /(?:Destination|Merger):\s+(.+)$/m;
    let lastDest = '';
    let stderrBuf = '';

    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      for (const line of text.split(/\r?\n|\r/)) {
        const m = progressRe.exec(line);
        if (m) {
          job.progressPercent = Number(m[1]);
          job.speed = m[2];
          job.eta = m[3];
          this.broadcast(job);
        }
        const d = destRe.exec(line);
        if (d) lastDest = d[1]!.trim();
      }
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString();
      if (stderrBuf.length > 8000) stderrBuf = stderrBuf.slice(-8000);
    });

    return new Promise((resolve) => {
      child.on('close', (code) => {
        job.endedAt = Date.now();
        if (code === 0) {
          job.state = 'completed';
          job.progressPercent = 100;
          if (lastDest) job.resultPath = lastDest;
        } else if (job.state !== 'cancelled') {
          job.state = 'failed';
          job.errorMessage = stderrBuf.trim().split(/\r?\n/).slice(-3).join(' ').slice(0, 280);
        }
        this.broadcast(job);
        resolve(job);
      });
    });
  }

  cancel(id: string): boolean {
    const entry = this.jobs.get(id);
    if (!entry?.child) return false;
    entry.job.state = 'cancelled';
    try {
      entry.child.kill('SIGTERM');
    } catch {
      /* noop */
    }
    this.broadcast(entry.job);
    return true;
  }

  reveal(id: string): boolean {
    const entry = this.jobs.get(id);
    if (!entry?.job.resultPath) return false;
    shell.showItemInFolder(entry.job.resultPath);
    return true;
  }

  clearFinished(): void {
    for (const [id, entry] of this.jobs) {
      if (entry.job.state === 'completed' || entry.job.state === 'failed' || entry.job.state === 'cancelled') {
        this.jobs.delete(id);
      }
    }
    this.broadcastAll();
  }

  private broadcast(job: YtdlpJob): void {
    if (!this.window.isDestroyed()) {
      this.window.webContents.send('ytdlp:job', job);
    }
  }

  private broadcastAll(): void {
    if (!this.window.isDestroyed()) {
      this.window.webContents.send('ytdlp:list', this.list());
    }
  }
}
