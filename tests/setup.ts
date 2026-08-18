/**
 * Tests assert on exact CLI output, so color detection must not depend on
 * whoever runs the suite — a shell with FORCE_COLOR=3 (or NO_COLOR, or
 * TERM=dumb) exported would flip colorEnabled() and break output asserts.
 * Pin the ambient env to the colorless default the tests were written for;
 * individual tests stub these vars themselves when color IS the subject.
 */
delete process.env.FORCE_COLOR
delete process.env.NO_COLOR
delete process.env.CHATBASE_NO_COLOR
if (process.env.TERM === 'dumb') process.env.TERM = 'xterm-256color'
