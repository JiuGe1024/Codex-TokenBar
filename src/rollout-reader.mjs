import fs from 'node:fs/promises';
import path from 'node:path';
import { TextDecoder } from 'node:util';
import { projectUsageRecord } from './json-project.mjs';
import { UsageState, isUuid } from './usage-state.mjs';

const MAX_LINE_BYTES = 16 * 1024 * 1024;
const decoder = new TextDecoder('utf-8', { fatal: true });

export async function findRollout(root, threadId) {
  if (!isUuid(threadId)) throw new Error('Invalid thread ID');
  const matches = [];
  async function visit(folder) {
    for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) await visit(full);
      else if (entry.isFile() && entry.name.startsWith('rollout-') && entry.name.endsWith(`-${threadId.toLowerCase()}.jsonl`)) matches.push(full);
    }
  }
  await visit(root);
  if (matches.length !== 1) return null;
  const actualRoot = await fs.realpath(root);
  const actual = await fs.realpath(matches[0]);
  const relative = path.relative(actualRoot, actual);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Session path escaped allowed root');
  return actual;
}

export class RolloutReader {
  constructor(file, threadId) {
    this.file = file;
    this.threadId = threadId;
    this.buffer = Buffer.alloc(64 * 1024);
    this.reset();
  }
  reset() {
    this.state = new UsageState(this.threadId);
    this.offset = 0;
    this.pendingChunks = [];
    this.pendingBytes = 0;
    this.droppingOversized = false;
    this.identity = null;
    this.mtime = null;
  }
  consume(bytes) {
    let start = 0;
    for (let end = bytes.indexOf(10); end !== -1; end = bytes.indexOf(10, start)) {
      const part = bytes.subarray(start, end);
      if (!this.droppingOversized && this.pendingBytes + part.length <= MAX_LINE_BYTES) {
        const line = this.pendingBytes ? Buffer.concat([...this.pendingChunks, part], this.pendingBytes + part.length) : part;
        if (line.length) {
          try { this.state.apply(projectUsageRecord(decoder.decode(line))); }
          catch { this.state.invalidateActive('invalid-record-skipped'); }
        }
      } else this.state.invalidateActive('oversized-record-skipped');
      this.pendingChunks = [];
      this.pendingBytes = 0;
      this.droppingOversized = false;
      start = end + 1;
    }
    const tail = bytes.subarray(start);
    if (this.pendingBytes + tail.length > MAX_LINE_BYTES) {
      this.pendingChunks = [];
      this.pendingBytes = 0;
      this.droppingOversized = true;
    } else if (!this.droppingOversized && tail.length) {
      // The read buffer is reused, so retain an owned copy of each fragment.
      this.pendingChunks.push(Buffer.from(tail));
      this.pendingBytes += tail.length;
    }
  }
  async poll() {
    // Open with 'r' only, never rw/a/w. Read a bounded snapshot of appended bytes;
    // an unfinished UTF-8 or JSON line is retained until a newline arrives.
    const handle = await fs.open(this.file, 'r');
    try {
      const stat = await handle.stat();
      const identity = `${stat.dev}:${stat.ino}`;
      if ((this.identity && identity !== this.identity) || stat.size < this.offset
        || (stat.size === this.offset && this.mtime !== null && stat.mtimeMs !== this.mtime)) this.reset();
      this.identity = identity;
      const end = stat.size;
      const buffer = this.buffer;
      while (this.offset < end) {
        const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, end - this.offset), this.offset);
        if (!bytesRead) break;
        this.offset += bytesRead;
        this.consume(buffer.subarray(0, bytesRead));
      }
      this.mtime = stat.mtimeMs;
      return this.state;
    } finally { await handle.close(); }
  }
}
