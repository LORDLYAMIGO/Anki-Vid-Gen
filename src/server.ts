import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join,extname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Store} from './store.ts';
import {Settings,Card} from './core.ts';
import {importFile} from './import.ts';
import {resolveAudio,hydrateMedia} from './audio.ts';
import {planTimeline} from './timeline.ts';
import {processJob,queueJob,writeManifest} from './jobs.ts';

const home=resolve(process.env.ANKI_VIDEO_HOME||'work');await mkdir(home,{recursive:true});const store=new Store(join(home,'studio.sqlite'));store.reconcile();
const send=(res:any,status:number,data:unknown)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':'http://127.0.0.1:5173'});res.end(JSON.stringify(data));};
async function body(req:any,limit=160*1024*1024){const chunks:Buffer[]=[];let size=0;for await(const c of req){size+=c.length;if(size>limit) throw new Error('Upload too large');chunks.push(c);}return Buffer.concat(chunks);}
createServer(async(req,res)=>{try{
  const url=new URL(req.url||'/', 'http://127.0.0.1:4174'),parts=url.pathname.split('/').filter(Boolean);
  if(parts[0]==='media'&&parts[1]){const video=(store.videos() as any[]).find(v=>v.id===parts[1]&&v.status==='completed');if(!video) return send(res,404,{error:'Video not found'});const thumbnail=parts[2]==='thumb',file=thumbnail?String(video.output_path).replace(/\.mp4$/i,'.jpg'):video.output_path;const data=await readFile(file);res.writeHead(200,{'Content-Type':thumbnail?'image/jpeg':'video/mp4','Content-Length':data.length});res.end(data);return;}
  if(parts[0]!=='api')return send(res,404,{error:'Not found'});
  if(req.method==='GET'&&parts[1]==='overview') return send(res,200,{cards:store.cards().map(c=>({...c,card_json:undefined})),jobs:store.jobs(),videos:store.videos(),stats:store.stats(Settings.parse({}))});
  if(req.method==='GET'&&parts[1]==='cards') return send(res,200,parts[2]?store.card(decodeURIComponent(parts[2])):store.cards().map(c=>{const card=JSON.parse(c.card_json);const {raw,...source}=card.source;return {...card,source};}));
  if(req.method==='GET'&&parts[1]==='jobs'&&parts[2]&&parts[3]==='manifest'){const file=await writeManifest(store,parts[2]);const data=await readFile(file);res.writeHead(200,{'Content-Type':'application/json','Content-Disposition':`attachment; filename="manifest-${parts[2]}.json"`});res.end(data);return;}
  if(req.method==='GET'&&parts[1]==='jobs') return send(res,200,parts[2]?store.job(parts[2]):store.jobs());
  if(req.method==='GET'&&parts[1]==='videos') return send(res,200,store.videos(parts[2]));
  if(req.method==='POST'&&parts[1]==='import'){
    const filename=decodeURIComponent(String(req.headers['x-filename']||'deck.apkg'));const ext=extname(filename).toLowerCase();if(!['.apkg','.json'].includes(ext)) throw new Error('Choose a .apkg or .json file');
    const folder=join(home,'uploads');await mkdir(folder,{recursive:true});const file=join(folder,`${randomUUID()}${ext}`);await writeFile(file,await body(req));const result=await importFile(file,join(home,'assets'));store.import(result.cards);return send(res,200,{count:result.cards.length,warnings:result.warnings,deckIds:[...new Set(result.cards.map(c=>c.source.deckId).filter(Boolean))]});
  }
  if(req.method==='POST'&&parts[1]==='cards'&&parts[2]){const id=decodeURIComponent(parts[2]);const patch=JSON.parse((await body(req,1024*1024)).toString());const updated=Card.parse(store.updateCard(id,{front:patch.front,back:patch.back,explanation:patch.explanation,narration:patch.narration,skip:patch.skip,options:patch.options}));return send(res,200,updated);}
  if(req.method==='POST'&&parts[1]==='preview'){
    const data=JSON.parse((await body(req,1024*1024)).toString()),card=store.card(data.cardId);if(!card) throw new Error('Card not found');const settings=Settings.parse(data.settings),audio=await resolveAudio(card,settings,join(home,'cache','audio')),plan=planTimeline(audio,settings),hydrated=await hydrateMedia(card,audio);return send(res,200,{card:hydrated.card,settings,plan:{...plan,audio:hydrated.audio},exact:true});
  }
  if(req.method==='POST'&&parts[1]==='stats'){const data=JSON.parse((await body(req,1024*1024)).toString());return send(res,200,store.stats(Settings.parse(data.settings),data.deckId));}
  if(req.method==='POST'&&parts[1]==='generate'){const data=JSON.parse((await body(req,1024*1024)).toString()),settings=Settings.parse(data.settings),count=Number(data.count),outputDir=resolve(data.outputDir||'outputs');const result=queueJob(store,count,settings,outputDir,join(home,'cache','audio'),{selectedIds:data.selectedIds,regenerate:!!data.regenerate,deckId:data.deckId,tags:data.tags});return send(res,200,result);}
  if(req.method==='POST'&&parts[1]==='jobs'&&parts[2]&&parts[3]){const action=parts[3] as 'pause'|'resume'|'cancel'|'retry';if(!['pause','resume','cancel','retry'].includes(action)) throw new Error('Unknown action');const result=store.control(parts[2],action);if(action==='resume'||action==='retry')void processJob(store,parts[2],join(home,'cache','audio'));return send(res,200,result);}
  return send(res,404,{error:'Not found'});
}catch(error){send(res,400,{error:String(error instanceof Error?error.message:error)});}}).listen(4174,'127.0.0.1',()=>console.log('Studio API: http://127.0.0.1:4174'));
