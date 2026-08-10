/**
 * CI guardrail: fail the build if CLI cold-start gets slow.
 *
 * Startup regressions are invisible in review — one heavy top-level import
 * in a commonly loaded file and every command pays for it. This runs the
 * real binary (`node bin/run.js --version`) three times and keeps the BEST
 * time (first runs are skewed by cold file caches); over budget → exit 1.
 *
 * Budget: STARTUP_BUDGET_MS env, default 1000 (CI runners are slow/noisy).
 * The product target is <300ms; local runs measure ~50ms — if this check
 * fires, something real regressed.
 */
import { execFileSync } from 'node:child_process'

const BUDGET_MS = Number(process.env.STARTUP_BUDGET_MS ?? 1000) // CI runners are slow; local target is 300
const runs = []
for (let i = 0; i < 3; i++) {
    const t0 = performance.now()
    execFileSync('node', ['bin/run.js', '--version'])
    runs.push(performance.now() - t0)
}
const best = Math.min(...runs)
console.log(`startup (best of 3): ${best.toFixed(0)}ms (budget ${BUDGET_MS}ms)`)
if (best > BUDGET_MS) {
    console.error('Startup budget exceeded')
    process.exit(1)
}
