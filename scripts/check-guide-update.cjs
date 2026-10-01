const {execFileSync}=require('node:child_process');
const CONTRACT_FILES=['src/**/*.ts (except src/guide.ts)'];
function checkGuideUpdate(base,head){
  const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim();
  base=git('rev-parse','--verify','--end-of-options',`${base}^{commit}`);head=git('rev-parse','--verify','--end-of-options',`${head}^{commit}`);
  const changed=git('diff','--name-only',base,head,'--','src').split('\n').filter(file=>file.endsWith('.ts')&&file!=='src/guide.ts');
  if(changed.length&&git('show',`${base}:src/guide.ts`)===git('show',`${head}:src/guide.ts`))throw Error(`Public SDK contract changed without updating src/guide.ts: ${changed.join(', ')}`);
  return {base,head,contract_files_changed:changed,guide_update_required:changed.length>0};
}
module.exports={CONTRACT_FILES,checkGuideUpdate};
if(require.main===module){try{const args=process.argv.slice(2);if(args.length!==4||args[0]!=='--base'||args[2]!=='--head'||!args[1]||!args[3])throw Error('Usage: npm run check:guide -- --base <reviewed-base> --head <reviewed-head>');console.log(JSON.stringify(checkGuideUpdate(args[1],args[3])));}catch(e){console.error(e.message);process.exitCode=1;}}
