#!/usr/bin/env node
// Structural checks only; passing does not establish semantic correctness or approval.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function checkChanges(files, read, before, exists) {
  const errors = [];
  const has = p => files.includes(p);
  const code = files.some(p => /^(engine|server|ui|dashboard|scripts|\.github|\.githooks)\//.test(p) && !p.endsWith('.md'));
  if (code && !files.some(p => /^docs\/build\/work\/[^/]+\/verification\.md$/.test(p) && read(p)))
    errors.push('Code/tooling change needs an updated docs/build/work/<id>/verification.md.');
  if (files.some(p => /^(engine\/migrations\/|scripts\/deploy|engine\/src\/auth\/|server\/src\/(server|orgResolver))/.test(p)) && !has('docs/build/architecture-and-progress.md'))
    errors.push('Schema/deploy/auth change needs architecture-and-progress.md in the same diff.');
  for (const p of files) {
    const text = read(p);
    if (/^engine\/migrations\/.*\.sql$/.test(p) && before(p) !== null && before(p) !== text)
      errors.push(`${p}: existing migration is immutable; add a new migration.`);
    if (text !== null && (/(^|\/)\.env($|\.)/.test(p) && !p.endsWith('.env.example') || /(^|\/)(\.backups|\.local)\//.test(p) || /\.(pem|key|sql\.gz)$/.test(p)))
      errors.push(`${p}: private/generated operational material cannot be included.`);
    if (text === null) continue;
    // Do not echo matching content, which may itself be a credential.
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:sk_live_|sk_test_)[A-Za-z0-9]{20,}|postgres(?:ql)?:\/\/[^\s/:<>]+:[^\s@<>]{8,}@(?!(?:localhost|127\.0\.0\.1)(?=[:/]))/i.test(text))
      errors.push(`${p}: possible embedded credential; inspect locally, never paste its value.`);
    if (p.startsWith('docs/') && p.endsWith('.md')) {
      for (const field of ['Status', 'Owner', 'Last verified', 'Supersedes'])
        if (!new RegExp(`^> ${field}: .+`, 'm').test(text)) errors.push(`${p}: missing ${field} header.`);
    }
    if (p.endsWith('.md')) {
      const prose = text.replace(/```[\s\S]*?```/g, '');
      for (const m of prose.matchAll(/\]\(([^)]+)\)/g)) {
        const target = m[1].split('#')[0].replace(/^<|>$/g, '');
        if (!target || /^[a-z]+:/i.test(target)) continue;
        const dest = path.posix.normalize(path.posix.join(path.posix.dirname(p), decodeURIComponent(target)));
        if (!exists(dest)) errors.push(`${p}: broken local link ${target}`);
      }
    }
  }
  return [...new Set(errors)];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const git = (...args) => execFileSync('git', args, {encoding:'utf8', stdio:['ignore','pipe','pipe']});
  const args = process.argv.slice(2);
  if (args.length > 1) throw Error('Usage: node scripts/check-hygiene.mjs [--staged|BASE_REF]');
  const staged = args[0] === '--staged';
  const base = staged ? 'HEAD' : args[0] || 'HEAD';
  git('rev-parse', '--verify', `${base}^{commit}`);
  const split = s => s.split('\0').filter(Boolean);
  const files = [...new Set([...split(git('diff','--name-only','--no-renames','-z', ...(staged ? ['--cached'] : [base]))),
    ...(staged || args[0] ? [] : split(git('ls-files','--others','--exclude-standard','-z')))])];
  const at = (ref,p) => {try{return git('show',`${ref}:${p}`)}catch{return null}};
  const read = p => staged ? at('',p) : existsSync(p) ? readFileSync(p,'utf8') : null;
  const errors = checkChanges(files,read,p=>at(base,p),p=>staged ? at('',p)!==null : existsSync(p));
  if (errors.length) {errors.forEach(e=>console.error(`FAIL ${e}`)); process.exitCode=1;}
  else console.log(`PASS hygiene (${files.length} changed paths). Human review still checks meaning, scope and proof.`);
}
