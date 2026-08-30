/**
 * The finding discipline for the whole harness.
 *
 * An AI QA run is only worth reading if every finding is anchored to something
 * that cannot be argued with — a row that is absent or wrong, an ERROR the app
 * logged about itself, a 5xx. So `check()` is the only way to record a HARD
 * finding, and it takes evidence, not an opinion. Anything an agent merely
 * *thinks* looks wrong goes through `observe()`, lands in a separate bucket,
 * and never fails the run. Without that split the report is 90% noise by week
 * two and stops being read.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export function createReport(oracleName) {
  const checks = [];
  const observations = [];

  return {
    /** A hard, evidence-backed assertion. A false `ok` fails the run. */
    check(id, ok, summary, evidence) {
      checks.push({ id, ok: Boolean(ok), summary, evidence });
      const mark = ok ? 'PASS' : 'FAIL';
      console.log(`  [${mark}] ${id}: ${summary}`);
      if (!ok && evidence !== undefined) {
        console.log(`         evidence: ${JSON.stringify(evidence)}`);
      }
      return ok;
    },

    /** A soft signal. Recorded, reported last, never fails the run. */
    observe(id, summary, evidence) {
      observations.push({ id, summary, evidence });
      console.log(`  [note] ${id}: ${summary}`);
    },

    /**
     * Writes qa/run/findings/<oracle>.json and exits non-zero if any hard
     * check failed, so a shell runner can gate on it without parsing output.
     */
    finish(runDir) {
      const failed = checks.filter((c) => !c.ok);
      const report = {
        oracle: oracleName,
        passed: checks.length - failed.length,
        failed: failed.length,
        checks,
        observations,
      };
      const dir = join(runDir, 'findings');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${oracleName}.json`), `${JSON.stringify(report, null, 2)}\n`);

      console.log(
        `  -> ${oracleName}: ${report.passed} passed, ${report.failed} failed, ${observations.length} noted`
      );
      process.exit(failed.length > 0 ? 1 : 0);
    },
  };
}
