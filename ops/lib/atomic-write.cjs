/**
 * Reviewers !78 N-1: atomic state writes for the box scripts (devnet-bootstrap.cjs save(), settle-test.cjs).
 * The pause watcher re-reads $STATE every pass while bootstrap phase 2 / settle-test write it; a plain
 * fs.writeFileSync can be observed half-written. Temp file in the same dir → fsync → rename → fsync dir.
 * Same logic as apps/automation/src/util/atomicWrite.ts; unit-tested in apps/automation/test/review-77-79.test.ts.
 */
const fs = require("fs");
const path = require("path");

function writeFileAtomicSync(file, data, mode = 0o600) {
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
    try { fs.fsyncSync(dfd); } finally { fs.closeSync(dfd); }
  } catch { /* best-effort directory fsync */ }
}

module.exports = { writeFileAtomicSync };
