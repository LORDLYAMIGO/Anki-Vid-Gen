import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {basename,extname,join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {unzipSync} from 'fflate';
import {Card,parseCards,type Flashcard} from './core.ts';
import {hash} from './hash.ts';

const maxArchive=150*1024*1024,maxEntry=80*1024*1024,maxTotal=350*1024*1024;
const htmlText=(value:string)=>value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'').replace(/<br\s*\/?\s*>|<\/(div|p|li)>/gi,'\n').replace(/<[^>]*>/g,'').replace(/&nbsp;/gi,' ').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&amp;/gi,'&').replace(/\s*\n\s*/g,'\n').trim();
const safeMedia=(name:string)=>name&&!/[\\/\x00-\x1f]/.test(name)&&name!=='.'&&name!=='..';
type Model={type?:number;flds:{name:string}[];tmpls?:{name:string;qfmt:string;afmt:string}[]};
type NoteRow={id:number;mid:number;flds:string;tags:string};
type CardRow={id:number;nid:number;did:number;ord:number};

export async function importFile(file:string,assetDir:string):Promise<{cards:Flashcard[];warnings:string[]}>{
  const ext=extname(file).toLowerCase();
  if(ext==='.colpkg') throw new Error('.colpkg is not supported; export a deck as .apkg');
  if(ext==='.json') return {cards:parseCards(JSON.parse(await readFile(file,'utf8'))),warnings:[]};
  if(ext!=='.apkg') throw new Error('Import a .json or .apkg file');
  const archive=await readFile(file);if(archive.length>maxArchive) throw new Error('Archive exceeds 150 MB limit');
  let total=0;
  const entries=unzipSync(new Uint8Array(archive),{filter:e=>{
    if(!safeMedia(e.name)&&!['collection.anki2','collection.anki21','collection.anki21b','media'].includes(e.name)) throw new Error(`Unsafe archive entry: ${e.name}`);
    total+=e.originalSize;if(e.originalSize>maxEntry||total>maxTotal) throw new Error('Archive decompression limit exceeded');return true;
  }});
  if(entries['collection.anki21b']) throw new Error('Modern compressed .apkg collection is not supported yet; export with “Support older Anki versions” enabled');
  const collection=entries['collection.anki21']||entries['collection.anki2'];
  if(!collection) throw new Error('No supported Anki collection found in package');
  let mediaMap:Record<string,string>={};
  try{mediaMap=JSON.parse(Buffer.from(entries.media||[]).toString('utf8'));}catch{throw new Error('Invalid Anki media mapping');}
  await mkdir(assetDir,{recursive:true});
  const packageHash=hash(archive.toString('base64')).slice(0,16);
  const mediaByName=new Map<string,{id:string;kind:'image'|'audio';uri:string;mimeType:string}>();
  for(const [index,name] of Object.entries(mediaMap)){
    if(!safeMedia(name)||!entries[index]) continue;
    const extension=extname(name).toLowerCase();
    const mime:{[k:string]:string}={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.mp3':'audio/mpeg','.m4a':'audio/mp4','.wav':'audio/wav','.ogg':'audio/ogg'};
    if(!mime[extension]) continue;
    const kind=mime[extension].startsWith('image/')?'image':'audio';
    const id=hash(`${packageHash}:${name}`).slice(0,16),uri=join(assetDir,`${id}${extension}`);
    await writeFile(uri,entries[index]);mediaByName.set(name,{id,kind,uri,mimeType:mime[extension]});
  }
  const dbFile=join(tmpdir(),`anki-video-${packageHash}-${process.pid}.sqlite`);
  await writeFile(dbFile,collection);
  let models:Record<string,Model>,decks:Record<string,{name:string}>={},notes:NoteRow[],ankiCards:CardRow[];
  const db=new DatabaseSync(dbFile,{readOnly:true});
  try{
    const col=db.prepare('SELECT * FROM col LIMIT 1').get() as {models:string;decks?:string};models=JSON.parse(col.models);if(col.decks) decks=JSON.parse(col.decks);
    notes=db.prepare('SELECT id,mid,flds,tags FROM notes').all() as NoteRow[];
    ankiCards=db.prepare('SELECT id,nid,did,ord FROM cards ORDER BY id').all() as CardRow[];
  }finally{db.close();await import('node:fs/promises').then(m=>m.unlink(dbFile).catch(()=>{}));}
  const noteById=new Map(notes.map(n=>[n.id,n]));
  const warnings:string[]=[],cards:Flashcard[]=[];
  const ordinals=new Map<string,number>();
  for(const row of ankiCards){
    const note=noteById.get(row.nid),model=note&&models[String(note.mid)];if(!note||!model){warnings.push(`Card ${row.id}: missing note or model`);continue;}
    const fields=Object.fromEntries(model.flds.map((f,i)=>[f.name,note.flds.split('\x1f')[i]||'']));
    const tmpl=model.tmpls?.[model.type===1?0:row.ord];
    if(!tmpl){warnings.push(`Card ${row.id}: missing template ${row.ord}`);continue;}
    const cardWarnings:string[]=[];
    const deckName=decks[String(row.did)]?.name;
    const ordinalKey=`${row.did}:${note.mid}:${row.ord}`;
    const cardOrdinal=(ordinals.get(ordinalKey)||0)+1;ordinals.set(ordinalKey,cardOrdinal);
    const cloze=(raw:string,front:boolean)=>raw.replace(/{{c(\d+)::([^}:]+)(?:::([^}]+))?}}/g,(_all,num,answer,hint)=>Number(num)===row.ord+1?(front?`[${hint||'…'}]`:answer):answer);
    const fill=(template:string,front:boolean)=>{
      let unsupported=false;
      let result=template.replace(/{{cloze:([^}]+)}}/gi,(_all,key)=>cloze(fields[key]||'',front));
      result=result.replace(/{{FrontSide}}/gi,'').replace(/{{([^}]+)}}/g,(_all,key)=>{if(key[0]==='#'||key[0]==='/'||key[0]==='^'){unsupported=true;return '';}if(!(key in fields)){unsupported=true;return '';}return model.type===1?cloze(fields[key],front):fields[key];});
      if(unsupported) cardWarnings.push('Unsupported conditional or unknown template field; review card');
      return result;
    };
    const makeBlocks=(raw:string)=>{
      const blocks:Flashcard['front']=[],used=new Set<string>();
      const assetPattern=/<img\b[^>]*src=["']([^"']+)["'][^>]*>|\[sound:([^\]]+)\]/gi;
      let text=raw.replace(assetPattern,(_all,img,sound)=>{
        const name=img||sound,asset=mediaByName.get(name);if(!asset){cardWarnings.push(`Missing media: ${name}`);return '';}used.add(asset.id);
        if(asset.kind==='image') blocks.push({kind:'image',mediaId:asset.id,alt:name});
        return '';
      });
      text=htmlText(text);if(text) blocks.unshift({kind:'text',text});
      return {blocks,used};
    };
    const jlab=model.flds.some(f=>f.name==='Jlab-Kanji')&&model.flds.some(f=>f.name==='RemarksBack');
    let front,back,explanation:Flashcard['explanation'],skip=false,narration:Flashcard['narration'];
    if(jlab&&row.ord===0){
      const japanese=htmlText(fields['Jlab-Kanji']||fields['Other-Front']||'').replace(/([\p{Script=Han}])\[[^\]]+\]/gu,'$1');
      const remarks=(fields.RemarksBack||'').split(/<br\s*\/?\s*>/i);
      const answer=htmlText(remarks.shift()||'');
      const extra=htmlText(remarks.join('<br>'));
      front=makeBlocks(`${japanese}<br>${fields.Image||''}`);
      back=makeBlocks(answer);
      const audio=makeBlocks(fields.Audio||'');
      const audioId=[...audio.used][0];
      narration={question:japanese,answer,questionAudioMediaId:audioId};
      if(extra&&extra.length<=180) explanation=[{kind:'text',text:extra}];
      else if(extra) cardWarnings.push('Supplementary notes retained in source; too long for video');
    }else if(jlab){
      front=makeBlocks(fields['Jlab-ClozeFront']||'');back=makeBlocks(fields['Jlab-ClozeBack']||'');
      skip=true;cardWarnings.push('Jlab reading card has no distinct answer in this export; review before rendering');
    }else if(model.flds.some(f=>f.name==='Image'&&model.tmpls?.[0]?.name==='InfoCard')){
      front=makeBlocks(fields.Image||fields.Text||'');back=makeBlocks(fields.Text||'');
      skip=true;cardWarnings.push('Information card has no separate answer; review before rendering');
    }else{
      front=makeBlocks(fill(tmpl.qfmt,true));back=makeBlocks(fill(tmpl.afmt,false));
    }
    const used=new Set([...front.used,...back.used]);if(jlab&&row.ord===0)for(const m of [fields.Audio||'']){const match=m.match(/\[sound:([^\]]+)\]/);const asset=match&&mediaByName.get(match[1]);if(asset)used.add(asset.id);}
    const media=[...mediaByName.values()].filter(m=>used.has(m.id));
    const card=Card.parse({id:`anki:${row.did}:${row.id}`,source:{type:'anki',deckId:String(row.did),deckName,noteId:String(row.nid),cardId:String(row.id),cardOrdinal,cardTemplateName:tmpl.name,attribution:jlab?htmlText(fields.Source||''):undefined,sourceFingerprint:hash({fields,model:note.mid,ord:row.ord,template:tmpl,normalization:3}),raw:{fields,questionTemplate:tmpl.qfmt,answerTemplate:tmpl.afmt}},tags:note.tags.trim().split(/\s+/).filter(Boolean),language:jlab?'ja':undefined,front:front.blocks,back:back.blocks,explanation,skip,narration,media,warnings:cardWarnings});
    cards.push(card);
  }
  return {cards,warnings};
}
