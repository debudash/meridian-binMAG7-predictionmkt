/**
 * Reviewers !78 N-1: write a file so a concurrent reader sees either the old or the new content, never a torn
 * one. Temp file in the same directory (same filesystem) → fsync → rename over the target → fsync the directory.
 * Same logic as ops/lib/atomic-write.cjs (the box scripts can't import the automation build).
 */
import * as fs from "fs";
import * as path from "path";

export function writeFileAtomicSync(file: string, data: string, mode = 0o600): void {
  const dir = path.dirname(file);
  const tmp = path.join(dir, `.${path.basename(file)}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const fd = fs.openSync(tmp, "wx", mode);
  try {
    fs.writeSync(fd, data);
    fs.fsyncSync(fd);
  } catch (e) {
    fs.closeSync(fd);
    fs.rmSync(tmp, { force: true });
    throw e;
  }
  fs.closeSync(fd);
  try {
    fs.chmodSync(tmp, mode);
    fs.renameSync(tmp, file);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
  try {
    const dfd = fs.openSync(dir, "r");
    try {
      fs.fsyncSync(dfd);
    } finally {
      fs.closeSync(dfd);
    }
  } catch {
    /* directory fsync is best-effort (not supported on every filesystem) */
  }
}
