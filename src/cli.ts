import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {importFile} from './import.ts';
import {Settings,validateCard,type RenderSettings} from './core.ts';
import {Store} from './store.ts';
import {processJob,writeManifest,renameExistingExports} from './jobs.ts';
import {resolveAudio} from './audio.ts';
import {planTimeline} from './timeline.ts';

const args=process.argv.slice(2),cmd=args.shift()||'help',home=resolve(process.env.ANKI_VIDEO_HOME||'work');
const value=(flag:string,defaultValue?:string)=>{const i=args.indexOf(`--${flag}`);return i<0?defaultValue:args[i+1];};
const has=(flag:string)=>args.includes(`--${flag}`);
function config():RenderSettings{return Settings.parse({templateId:value('template',value('layout','reveal')),audio:value('audio','silent'),voice:value('voice','alloy'),language:value('language','en'),timing:{mode:value('duration-mode','flexible'),targetSeconds:value('target-seconds')?Number(value('target-seconds')):undefined,thinkSeconds:Number(value('think-seconds','4')),minThinkSeconds:Number(value('min-think-seconds','1')),revealSeconds:Number(value('reveal-seconds','1')),holdSeconds:Number(value('hold-seconds','2')),infeasibleTarget:value('infeasible-target','fail')},design:{themeId:value('theme','washi-editorial'),layoutId:value('layout',value('template','reveal'))}});}
async function main(){await mkdir(home,{recursive:true});const store=new Store(join(home,'studio.sqlite'));store.reconcile();
  if(cmd==='import'){
    const file=args[0];if(!file) throw new Error('Provide a .apkg or .json file');const result=await importFile(resolve(file),join(home,'assets'));store.import(result.cards);const out=value('out');if(out){await mkdir(dirname(resolve(out)),{recursive:true});await writeFile(resolve(out),JSON.stringify({cards:result.cards,warnings:result.warnings},null,2));}console.log(JSON.stringify({imported:result.cards.length,warnings:result.warnings},null,2));
  }else if(cmd==='inspect'){if(args[0]){const result=await importFile(resolve(args[0]),join(home,'assets'));console.log(JSON.stringify(result,null,2));}else console.log(JSON.stringify(store.cards().map(c=>({id:c.id,deckId:c.deck_id,eligible:!!c.eligible,reason:c.skip_reason})),null,2));
  }else if(cmd==='validate'){if(args[0]){const result=await importFile(resolve(args[0]),join(home,'assets'));console.log(JSON.stringify(result.cards.map(card=>({id:card.id,...validateCard(card,config().templateId),warnings:card.warnings})),null,2));}else console.log(JSON.stringify(store.cards().map(c=>({id:c.id,eligible:!!c.eligible,reason:c.skip_reason})),null,2));
  }else if(cmd==='preview'){
    const card=store.card(value('card',args[0]||'')||'');if(!card) throw new Error('Card not found; import it first');const settings=config(),audio=await resolveAudio(card,settings,join(home,'cache','audio'));console.log(JSON.stringify({card,settings,plan:planTimeline(audio,settings)},null,2));
  }else if(cmd==='generate'||cmd==='render'){
    const settings=config();let importedIds:string[]|undefined;if(args[0]&&/\.(json|apkg)$/i.test(args[0])){const result=await importFile(resolve(args[0]),join(home,'assets'));store.import(result.cards);importedIds=result.cards.map(c=>c.id);}
    const selected=value('selected');const selectedIds=selected?(await readFile(resolve(selected),'utf8')).split(/\r?\n/).map(x=>x.trim()).filter(Boolean):importedIds;
    const count=Number(value('count',value('limit','1'))),out=resolve(value('out','outputs')!);
    if(has('dry-run')){console.log(JSON.stringify({count,settings,sourceCards:importedIds?.length,stats:store.stats(settings,value('deck'))},null,2));return;}
    const reservation=store.reserve(count,settings,out,{selectedIds,regenerate:has('regenerate'),deckId:value('deck'),tags:value('tags')?.split(',')});console.log(JSON.stringify(reservation));await processJob(store,reservation.jobId,join(home,'cache','audio'));console.log(JSON.stringify(store.job(reservation.jobId),null,2));
  }else if(cmd==='jobs'){const action=args[0]||'list',id=args[1];if(action==='list')console.log(JSON.stringify(store.jobs(),null,2));else if(action==='show')console.log(JSON.stringify(store.job(id),null,2));else if(['pause','resume','cancel','retry'].includes(action)){store.control(id,action as any);if(action==='resume'||action==='retry')await processJob(store,id,join(home,'cache','audio'));console.log(JSON.stringify(store.job(id),null,2));}else throw new Error('Unknown jobs action');
  }else if(cmd==='stats') console.log(JSON.stringify(store.stats(config()),null,2));
  else if(cmd==='reconcile') console.log(JSON.stringify({repaired:store.reconcile()}));
  else if(cmd==='manifest') console.log(await writeManifest(store,args[0]));
  else if(cmd==='rename-exports') console.log(JSON.stringify(await renameExistingExports(store,resolve('.'))));
  else console.log('Commands: import FILE [--out FILE], inspect [FILE], validate [FILE], preview --card ID, generate [FILE] --count N [--out DIR], jobs list|show|pause|resume|cancel|retry ID, stats, reconcile, manifest JOB_ID, rename-exports');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
