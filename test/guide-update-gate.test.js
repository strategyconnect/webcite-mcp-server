const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process');
const script=path.resolve(__dirname,'../scripts/check-guide-update.cjs');
test('guide merge gate rejects stale public contracts and accepts updated guide or noncontract changes',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'webcite-guide-gate-'));fs.mkdirSync(path.join(dir,'src'));const git=(...args)=>cp.execFileSync('git',args,{cwd:dir,encoding:'utf8'}).trim();git('init','--quiet');git('config','user.email','test@example.invalid');git('config','user.name','Test');
 const write=(file,value)=>fs.writeFileSync(path.join(dir,file),value);const commit=()=>{git('add','src','README.md');git('commit','--quiet','-m','fixture');return git('rev-parse','HEAD')};write('src/guide.ts','Original workflow');write('src/tools.ts','Original tool contract');write('src/version.ts',"export const SERVER_VERSION = '1.9.23';");write('README.md','Notes');const base=commit();
 const run=head=>cp.spawnSync(process.execPath,[script,'--base',base,'--head',head],{cwd:dir,encoding:'utf8'});
 write('src/version.ts',"export const SERVER_VERSION = '1.9.24';");let head=commit();const release=run(head);assert.equal(release.status,0);assert.equal(JSON.parse(release.stdout).guide_update_required,false);
 write('src/version.ts',"export const SERVER_VERSION = '1.9.24';\nexport const runtimeBehavior = true;");head=commit();assert.equal(run(head).status,1);
 write('src/version.ts',"export const SERVER_VERSION = '1.9.24';");
 write('src/new-runtime-helper.ts','New runtime contract');head=commit();assert.equal(run(head).status,1);assert.match(run(head).stderr,/without updating src\/guide.ts/);
 write('src/guide.ts','Updated workflow');head=commit();assert.equal(run(head).status,0);
 write('README.md','More notes');head=commit();const ordinary=cp.spawnSync(process.execPath,[script,'--base',git('rev-parse','HEAD~1'),'--head',head],{cwd:dir,encoding:'utf8'});assert.equal(ordinary.status,0);assert.equal(JSON.parse(ordinary.stdout).guide_update_required,false);
});

test('head-pinned merge wrapper runs guide gate and refuses stale head or failed guide',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'webcite-merge-gate-'));const log=path.join(dir,'calls');
 const fake=(name,body)=>{const file=path.join(dir,name);fs.writeFileSync(file,'#!/usr/bin/env bash\n'+body);fs.chmodSync(file,0o755)};
 fake('gh',`if [[ "$1 $2" == "pr view" ]]; then echo "$BASE $HEAD OPEN false"; else echo "gh $*" >> "$CALLS"; fi`);
 fake('git','echo "git $*" >> "$CALLS"');fake('npm','echo "npm $*" >> "$CALLS"; exit "${GUIDE_EXIT:-0}"');
 const base='a'.repeat(40),head='b'.repeat(40);const run=(overrides={},...args)=>{fs.writeFileSync(log,'');const result=cp.spawnSync('bash',[path.resolve(__dirname,'../scripts/merge-reviewed-pr.sh'),'123',head,...args],{env:{...process.env,PATH:dir+path.delimiter+process.env.PATH,BASE:base,HEAD:head,CALLS:log,...overrides},encoding:'utf8'});return {result,calls:fs.readFileSync(log,'utf8')}};
 const good=run();assert.equal(good.result.status,0);assert.match(good.calls,/npm run check:guide -- --base/);assert.match(good.calls,/context=webcite-guide-current/);assert.ok(good.calls.indexOf('npm run check:guide')<good.calls.indexOf('gh api'));assert.ok(good.calls.indexOf('gh api')<good.calls.indexOf('gh pr merge'));assert.match(good.calls,new RegExp(`gh pr merge 123 --merge --match-head-commit ${head}`));
 const dry=run({},'--dry-run');assert.equal(dry.result.status,0);assert.match(dry.calls,/npm run check:guide -- --base/);assert.doesNotMatch(dry.calls,/pr merge|gh api/);assert.equal(dry.result.stdout.trim(),`dry-run: would merge PR #123 --merge --match-head-commit ${head}`);
 for(const bad of [['--bogus'],['--dry-run','extra']]){const r=run({},...bad);assert.equal(r.result.status,1);assert.match(r.result.stderr,/^Unknown argument: /);assert.equal(r.calls,'')}
 const stale=run({HEAD:'c'.repeat(40)});assert.notEqual(stale.result.status,0);assert.doesNotMatch(stale.calls,/pr merge/);
 const badGuide=run({GUIDE_EXIT:'1'});assert.notEqual(badGuide.result.status,0);assert.doesNotMatch(badGuide.calls,/pr merge|gh api/);
});
