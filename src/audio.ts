import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {join,extname} from 'node:path';
import {textOf,type Flashcard,type RenderSettings} from './core.ts';
import {hash} from './hash.ts';
import type {ResolvedAudio,AudioAsset} from './timeline.ts';

function run(command:string,args:string[]){return new Promise<string>((resolve,reject)=>{const child=spawn(command,args,{windowsHide:true});let output='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>output+=x);child.on('error',reject);child.on('close',code=>code===0?resolve(output):reject(new Error(`${command} failed: ${output.slice(-600)}`)));});}
export async function probeAudio(file:string){const result=await run('ffprobe',['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',file]);const ms=Math.ceil(Number(result.trim())*1000);if(!Number.isFinite(ms)||ms<0) throw new Error(`Invalid audio duration: ${file}`);return ms;}
async function exists(file:string){try{await access(file);return true;}catch{return false;}}
async function mockSpeech(file:string,text:string){const duration=Math.max(0.7,Math.min(15,text.length/16));await run('ffmpeg',['-y','-f','lavfi','-i','sine=frequency=440:sample_rate=44100','-t',String(duration),'-filter:a','volume=0.04','-c:a','libmp3lame',file]);}
async function synthesize(file:string,text:string,settings:RenderSettings){
  const key=process.env.OPENAI_API_KEY;if(!key) throw new Error('OPENAI_API_KEY is required for TTS');
  const response=await fetch('https://api.openai.com/v1/audio/speech',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({model:'tts-1',voice:settings.voice,input:text,response_format:'mp3',speed:settings.rate})});
  if(!response.ok) throw new Error(`TTS request failed (${response.status}): ${(await response.text()).slice(0,300)}`);
  await writeFile(file,Buffer.from(await response.arrayBuffer()));
}
export async function resolveAudio(card:Flashcard,settings:RenderSettings,cacheDir:string):Promise<ResolvedAudio>{
  await mkdir(cacheDir,{recursive:true});
  const answerText=card.narration?.answer||card.narration?.pronunciationText||textOf(card.back);
  const questionText=card.narration?.question||(card.source.type==='anki'&&textOf(card.front).includes('[…]')?'':textOf(card.front));
  const values:[keyof ResolvedAudio,string][]=[['question',questionText],['answer',answerText],['explanation',card.narration?.explanation||'']];
  const result:ResolvedAudio={question:null,answer:null,explanation:null};
  if(settings.audio==='silent') return result;
  for(const [slot,text] of values){
    if(!text&&settings.audio!=='original') continue;
    let file:string|undefined;
    if(settings.audio==='original'){
      const mediaId=slot==='question'?card.narration?.questionAudioMediaId:slot==='answer'?card.narration?.answerAudioMediaId:card.narration?.explanationAudioMediaId;
      file=card.media.find(m=>m.id===mediaId&&m.kind==='audio')?.uri;
      if(!file) continue;
    }else{
      if(text.length>4096) throw new Error(`${slot} narration exceeds TTS limit`);
      const key=hash({text,language:settings.language,voice:settings.voice,rate:settings.rate,provider:settings.audio,engine:'tts-1'});
      file=join(cacheDir,`${key}.mp3`);
      if(!await exists(file)){if(settings.audio==='mock') await mockSpeech(file,text);else await synthesize(file,text,settings);}
    }
    (result as Record<string,AudioAsset>)[slot]={file,durationMs:await probeAudio(file)};
  }
  return result;
}
export async function dataUri(file:string,mime:string){return `data:${mime};base64,${(await readFile(file)).toString('base64')}`;}
export async function hydrateMedia(card:Flashcard,audio:ResolvedAudio){
  const hydrated=structuredClone(card);
  for(const m of hydrated.media) if(m.uri&&!m.uri.startsWith('data:')) m.uri=await dataUri(m.uri,m.mimeType||'application/octet-stream');
  const sound=structuredClone(audio);
  for(const value of Object.values(sound)) if(value?.file&&!value.file.startsWith('data:')){const mime:{[k:string]:string}={'.mp3':'audio/mpeg','.m4a':'audio/mp4','.wav':'audio/wav','.ogg':'audio/ogg'};value.file=await dataUri(value.file,mime[extname(value.file).toLowerCase()]||'audio/mpeg');}
  return {card:hydrated,audio:sound};
}
