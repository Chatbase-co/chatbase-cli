import { defineConfig } from 'vitest/config'

// `npm run test:e2e` runs `vitest run tests/e2e`. Vitest's positional path
// filter only narrows files already matched by `include` — it can't widen
// past `exclude` — so a single static config can't both keep the e2e suite
// out of the default run AND let that same invocation pick it up. Detecting
// the e2e invocation from argv lets one config file do both: the default
// run never even considers tests/e2e/**, while `vitest run tests/e2e`
// targets only the e2e suite (still gated by describe.skipIf inside it when
// the CHATBASE_E2E_* env vars are absent).
const runningE2e = process.argv.includes('tests/e2e')

export default defineConfig({
    test: {
        include: runningE2e
            ? ['tests/e2e/**/*.e2e.ts']
            : ['tests/**/*.test.ts'],
        exclude: runningE2e ? [] : ['tests/e2e/**'],
        environment: 'node',
        restoreMocks: true,
        unstubEnvs: true,
        setupFiles: ['tests/setup.ts']
    }
})
