import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {bundle} from '@remotion/bundler';
import {renderStill,selectComposition} from '@remotion/renderer';
import {Card,Settings} from '../src/core.ts';
import {planTimeline} from '../src/timeline.ts';

const out=resolve('cache/visual'),serveUrl=await bundle(resolve('src/remotion-root.tsx'));await mkdir(out,{recursive:true});
const samples=[['latin','What makes a rainbow?','Light bends and reflects in water.'],['japanese','ありがとうの意味は？','Thank you'],['devanagari','नमस्ते का अर्थ क्या है?','Hello']];
const reports=[];
for(const themeId of ['washi-editorial','technical-dark','playful'] as const)for(const layoutId of ['reveal','multiple-choice'] as const)for(const [script,question,answer] of samples){
  const card=Card.parse({id:`visual:${script}`,source:{type:'json',sourceFingerprint:script},front:[{kind:'text',text:question}],back:[{kind:'text',text:answer}],options:[{id:'a',label:'First',correct:false},{id:'b',label:answer,correct:true},{id:'c',label:'Third',correct:false}]});
  const settings=Settings.parse({templateId:layoutId,design:{themeId,layoutId}}),plan=planTimeline({question:null,answer:null,explanation:null},settings),props={card,settings,plan};const composition=await selectComposition({serveUrl,id:'Flashcard',inputProps:props});
  const file=join(out,`${themeId}-${layoutId}-${script}.png`);await renderStill({serveUrl,composition,inputProps:props,frame:plan.revealStart+15,output:file});reports.push({themeId,layoutId,script,file});
}
await writeFile(join(out,'index.json'),JSON.stringify(reports,null,2));console.log(`Rendered ${reports.length} visual snapshots in ${out}`);
