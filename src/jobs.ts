import {mkdir,writeFile,rename} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join,resolve,dirname,basename,sep} from 'node:path';
import {Store} from './store.ts';
import {Settings,validateCard,type RenderSettings} from './core.ts';
import {resolveAudio} from './audio.ts';
import {planTimeline} from './timeline.ts';
import {renderCard} from './render.ts';
import {textOf,type Flashcard} from './core.ts';

const active=new Set<string>();
const slug=(value:string,max=40)=>value.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,max).replace(/-$/,'');
export function videoFilename(store:Store,card:Flashcard,videoId:string){
  const deck=slug(card.source.deckName?.split('::').at(-1)||'cards',32)||'cards';
  const title=slug(card.source.raw?.fields['Jlab-ListeningFront']||textOf(card.front),40)||'card';
  const number=card.source.cardOrdinal?String(card.source.cardOrdinal).padStart(4,'0'):card.id.replace(/[^a-z0-9]/gi,'').slice(-8).toLowerCase();
  const variant=card.source.cardTemplateName==='Jlab-ListeningCard'?'listening':card.source.cardTemplateName==='Jlab-ClozeCard'?'reading':slug(card.source.cardTemplateName||'reveal',24)||'reveal';
  const version=(store.db.prepare('SELECT COUNT(*) AS n FROM videos WHERE card_id=? AND rowid <= (SELECT rowid FROM videos WHERE id=?)').get(card.id,videoId) as {n:number}).n;
  return `${deck}_${number}_${title}_${variant}_v${String(version).padStart(2,'0')}.mp4`;
}
export async function processJob(store:Store,jobId:string,cacheDir:string){
  if(active.has(jobId))return;active.add(jobId);const heartbeat=setInterval(()=>{try{store.heartbeat(jobId);}catch{/* job may be closing */}},5000);
  try{
    const job=store.job(jobId),settings=Settings.parse(JSON.parse(String(job.config_json))),out=resolve(String(job.output_dir));
    await mkdir(out,{recursive:true});
    for(;;){const item=store.claim(jobId);if(!item) break;
      const card=store.card(item.card_id);
      try{
        if(!card) throw new Error('Card was removed');
        const validation=validateCard(card,settings.templateId);if(!validation.ok){store.fail(jobId,item.card_id,item.video_id,validation.reasons.join('; '),true);continue;}
        const audio=await resolveAudio(card,settings,cacheDir),plan=planTimeline(audio,settings);
        const path=join(out,videoFilename(store,card,item.video_id));
        const rendered=await renderCard(card,plan,settings,path);
        store.finish(jobId,item.card_id,item.video_id,rendered.output,rendered.durationMs);
      }catch(error){store.fail(jobId,item.card_id,item.video_id,String(error instanceof Error?error.message:error));}
      await writeManifest(store,jobId);
    }
    await writeManifest(store,jobId);
  }finally{clearInterval(heartbeat);active.delete(jobId);}
}
export async function writeManifest(store:Store,jobId:string){const job=store.job(jobId),rows=job.items as any[],settings=Settings.parse(JSON.parse(String(job.config_json)));const records=rows.map(item=>{const card=store.card(item.card_id);return {cardId:item.card_id,sourceFingerprint:card?.source.sourceFingerprint,provenance:card?.source&&{type:card.source.type,deckId:card.source.deckId,deckName:card.source.deckName,noteId:card.source.noteId,cardId:card.source.cardId,attribution:card.source.attribution,license:card.source.license},template:settings.templateId,status:item.state,output:item.output_path,durationMs:item.duration_ms,targetExtended:settings.timing.mode==='target'&&item.duration_ms!=null&&item.duration_ms>Math.round((settings.timing.targetSeconds||0)*1000)+100,error:item.error,warnings:card?.warnings||[],renderSettingsFingerprint:job.settings_hash};});const selectedDecks=new Set(rows.map(item=>store.card(item.card_id)?.source.deckId||''));if(job.deck_id)selectedDecks.add(String(job.deck_id));const skippedCards=store.cards().filter(c=>!c.eligible&&selectedDecks.has(c.deck_id)).map(c=>({cardId:c.id,reason:c.skip_reason}));const file=join(String(job.output_dir),`manifest-${jobId}.json`);await mkdir(String(job.output_dir),{recursive:true});await writeFile(file,JSON.stringify({jobId,deckId:job.deck_id,requested:job.requested_count,reserved:rows.length,records,skippedCards},null,2));return file;}
export function queueJob(store:Store,count:number,settings:RenderSettings,outputDir:string,cacheDir:string,opts:{selectedIds?:string[];regenerate?:boolean;deckId?:string;tags?:string[]}={}){const reservation=store.reserve(count,settings,outputDir,opts);void processJob(store,reservation.jobId,cacheDir);return reservation;}
export async function renameExistingExports(store:Store,workspace:string){let renamed=0,skipped=0;const root=resolve(workspace).toLowerCase()+sep.toLowerCase();for(const row of store.videos() as {id:string;card_id:string;status:string;output_path:string|null}[]){
  if(row.status!=='completed'||!row.output_path||!resolve(row.output_path).toLowerCase().startsWith(root)||!/^\{?[0-9a-f]{8}-[0-9a-f-]{27,}\}?\.mp4$/i.test(basename(row.output_path))){skipped++;continue;}
  const card=store.card(row.card_id),old=row.output_path;if(!card||!existsSync(old)){skipped++;continue;}
  const target=join(dirname(old),videoFilename(store,card,row.id));if(existsSync(target)){skipped++;continue;}
  const oldThumb=old.replace(/\.mp4$/i,'.jpg'),newThumb=target.replace(/\.mp4$/i,'.jpg');
  if(existsSync(oldThumb)&&existsSync(newThumb)){skipped++;continue;}
  await rename(old,target);
  try{if(existsSync(oldThumb))await rename(oldThumb,newThumb);store.db.prepare('UPDATE videos SET output_path=? WHERE id=?').run(target,row.id);renamed++;}
  catch(error){await rename(target,old);throw error;}
}for(const job of store.jobs() as {id:string}[])await writeManifest(store,job.id);return {renamed,skipped};}
