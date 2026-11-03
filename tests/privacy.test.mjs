import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {inspectFile,scanRepository} from '../scripts/privacy-check.mjs';

test('privacy rejects data paths, generated credentials and personal path literals',()=>{
  assert.ok(inspectFile('private/history.sqlite3','x').includes('PRIVATE_OR_UNEXPECTED_FILE'));
  assert.ok(inspectFile('scripts/demo.mjs','const key="'+randomBytes(32).toString('hex')+'";').includes('PAIRING_OR_SECRET_LITERAL'));
  assert.ok(inspectFile('README.md',['C:','Users','sample','resume.txt'].join('\\')).includes('PERSONAL_ABSOLUTE_PATH'));
  assert.ok(inspectFile('README.md','sample@'+'mail.invalidhost.org').includes('EMAIL_ADDRESS'));
  assert.ok(inspectFile('examples/example.json',JSON.stringify({Cookie:randomBytes(24).toString('hex')})).includes('HARDCODED_CREDENTIAL'));
  assert.deepEqual(inspectFile('examples/example.json','{"email":"sample@example.com"}'),[]);
});
test('staged and historical audits inspect Git blobs rather than only current files',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'job-hunt-git-'));
  const git=args=>execFileSync('git',['-C',dir,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
  try {
    git(['init','-b','main']);git(['config','user.name','job-hunt tests']);git(['config','user.email','tests@job-hunt.invalid']);
    const file=path.join(dir,'README.md');fs.writeFileSync(file,'key="'+randomBytes(32).toString('hex')+'";');git(['add','README.md']);
    fs.writeFileSync(file,'# safe example');assert.equal(scanRepository(dir).ok,true);assert.equal(scanRepository(dir,{staged:true}).ok,false);
    git(['commit','-m','Synthetic fixture']);git(['add','README.md']);git(['commit','-m','Replace synthetic fixture']);
    assert.equal(scanRepository(dir,{staged:true}).ok,true);assert.equal(scanRepository(dir,{history:true}).ok,false);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
