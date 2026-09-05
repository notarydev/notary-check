import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkChanges } from './check-hygiene.mjs';
const check=(files,content={},old={})=>checkChanges(files,p=>content[p]??null,p=>old[p]??null,p=>Object.hasOwn(content,p));
test('code requires a verification record',()=>assert.ok(check(['engine/src/a.ts']).some(x=>x.includes('verification'))));
test('existing migration edits and deletions fail; new migration allowed',()=>{
 const p='engine/migrations/0020.sql';
 assert.ok(check([p],{[p]:'changed'},{[p]:'original'}).some(x=>x.includes('immutable')));
 assert.ok(check([p],{},{[p]:'original'}).some(x=>x.includes('immutable')));
 assert.ok(!check([p],{[p]:'new'}).some(x=>x.includes('immutable')));
});
test('auth requires same-diff architecture evidence',()=>assert.ok(check(['engine/src/auth/key.ts']).some(x=>x.includes('architecture'))));
test('private paths are rejected; examples allowed',()=>{
 assert.ok(check(['engine/.env'],{'engine/.env':'PRIVATE=example'}).some(x=>x.includes('private')));
 assert.deepEqual(check(['example.env.example']),[]);
});
test('docs need headers and valid local links',()=>{
 assert.ok(check(['docs/a.md'],{'docs/a.md':'[missing](missing.md)'}).some(x=>x.includes('broken')));
 const header='> Status: reference\n> Owner: Hardyk\n> Last verified: 2026-09-05\n> Supersedes: —\n';
 assert.deepEqual(check(['docs/a.md'],{'docs/a.md':header+'[next](b.md)','docs/b.md':'exists'}),[]);
});
test('possible keys are detected without echoing them',()=>{
 const key='sk_live_'+'a'.repeat(24);
 const errors=check(['config.txt'],{'config.txt':key});
 assert.equal(errors.length,1); assert.ok(!errors[0].includes(key));
});

test('documented credential placeholders are not secrets',()=>{
 assert.deepEqual(check(['readme.txt'],{'readme.txt':'postgres://<user>:<password>@<host>:5432/db'}),[]);
});

test('deleting private material is allowed',()=>assert.ok(!check(['engine/.env']).some(x=>x.includes('private/generated'))));

import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
test('staged checking cannot be satisfied by an unstaged fix',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'notary-hygiene-'));
 const git=(...args)=>execFileSync('git',args,{cwd:dir,stdio:'pipe'});
 try {
  git('init'); git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','core.hooksPath=/dev/null','commit','--allow-empty','-m','fixture');
  mkdirSync(path.join(dir,'docs')); writeFileSync(path.join(dir,'docs/a.md'),'Missing headers'); git('add','docs/a.md');
  writeFileSync(path.join(dir,'docs/a.md'),'> Status: reference\n> Owner: Hardyk\n> Last verified: 2026-09-05\n> Supersedes: —\n');
  const checker=fileURLToPath(new URL('./check-hygiene.mjs',import.meta.url));
  const staged=spawnSync(process.execPath,[checker,'--staged'],{cwd:dir,encoding:'utf8'});
  assert.equal(staged.status,1); assert.match(staged.stderr,/missing Status/);
  git('add','docs/a.md');
  assert.equal(spawnSync(process.execPath,[checker,'--staged'],{cwd:dir,encoding:'utf8'}).status,0);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
