import {mkdir,rename,rm} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {bundle} from '@remotion/bundler';
import {selectComposition,renderMedia} from '@remotion/renderer';
import {hydrateMedia} from './audio.ts';
import type {Flashcard,RenderSettings} from './core.ts';
import type {RenderPlan} from './timeline.ts';
let bundlePromise:Promise<string>|undefined;
async function getBundle(){return bundlePromise??=bundle(resolve('src/remotion-root.tsx'),()=>undefined,{outDir:resolve('cache/remotion-bundle')});}
function ffprobe(file:string){return new Promise<any>((resolve,reject)=>{const child=spawn('ffprobe',['-v','error','-show_streams','-show_format','-of','json',file],{windowsHide:true});let data='';child.stdout.on('data',x=>data+=x);child.on('error',reject);child.on('close',code=>code===0?resolve(JSON.parse(data)):reject(new Error('ffprobe failed')));});}
function ffmpeg(args:string[]){return new Promise<void>((resolve,reject)=>{const child=spawn('ffmpeg',args,{windowsHide:true});let err='';child.stderr.on('data',x=>err+=x);child.on('error',reject);child.on('close',code=>code===0?resolve():reject(new Error(`ffmpeg failed: ${err.slice(-500)}`)));});}
export async function renderCard(card:Flashcard,plan:RenderPlan,settings:RenderSettings,output:string){
  await mkdir(dirname(output),{recursive:true});const tmp=`${output}.tmp.mp4`;
  const hydrated=await hydrateMedia(card,plan.audio);const props={card:hydrated.card,plan:{...plan,audio:hydrated.audio},settings};
  const serveUrl=await getBundle();
  try{
    const composition=await selectComposition({serveUrl,id:'Flashcard',inputProps:props});
    await renderMedia({serveUrl,composition,inputProps:props,codec:'h264',audioCodec:'aac',outputLocation:tmp,overwrite:true,crf:22});
    let probe=await ffprobe(tmp);const video=probe.streams.find((s:any)=>s.codec_type==='video');
    if(!video||video.width!==1080||video.height!==1920||video.codec_name!=='h264') throw new Error('Rendered video failed dimension or codec verification');
    if(!probe.streams.some((s:any)=>s.codec_type==='audio')){const muxed=`${output}.audio.mp4`;await ffmpeg(['-y','-i',tmp,'-f','lavfi','-i','anullsrc=channel_layout=stereo:sample_rate=44100','-t',String(plan.end/settings.fps),'-c:v','copy','-c:a','aac','-shortest',muxed]);await rm(tmp,{force:true});await rename(muxed,tmp);probe=await ffprobe(tmp);}
    if(!probe.streams.some((s:any)=>s.codec_type==='audio'&&s.codec_name==='aac')) throw new Error('Rendered output has no AAC audio stream');
    const durationMs=Math.round(Number(probe.format.duration)*1000);if(Math.abs(durationMs-plan.end/settings.fps*1000)>250) throw new Error('Rendered duration differs from planned timeline');
    await rename(tmp,output);
    const thumbnail=output.replace(/\.mp4$/i,'.jpg');
    await ffmpeg(['-y','-ss',String(Math.min((plan.revealStart+5)/settings.fps,Math.max(0,(plan.end-1)/settings.fps))),'-i',output,'-frames:v','1','-q:v','3',thumbnail]).catch(()=>{});
    return {output,durationMs};
  }catch(e){await rm(tmp,{force:true}).catch(()=>{});throw e;}
}
