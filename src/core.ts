import {z} from 'zod';

export const Block = z.discriminatedUnion('kind', [
  z.object({kind:z.literal('text'),text:z.string()}),
  z.object({kind:z.literal('image'),mediaId:z.string(),alt:z.string().optional()}),
  z.object({kind:z.literal('math'),latex:z.string()})
]);
export const Card = z.object({
  id:z.string().min(1), source:z.object({type:z.enum(['anki','json']),deckId:z.string().optional(),deckName:z.string().optional(),noteId:z.string().optional(),cardId:z.string().optional(),cardOrdinal:z.number().int().positive().optional(),cardTemplateName:z.string().optional(),attribution:z.string().optional(),sourceFingerprint:z.string(),license:z.string().optional(),raw:z.object({fields:z.record(z.string(),z.string()),questionTemplate:z.string(),answerTemplate:z.string()}).optional()}),
  tags:z.array(z.string()).default([]),language:z.string().optional(),front:z.array(Block),back:z.array(Block),explanation:z.array(Block).optional(),
  options:z.array(z.object({id:z.string(),label:z.string(),correct:z.boolean()})).optional(),
  narration:z.object({question:z.string().optional(),answer:z.string().optional(),explanation:z.string().optional(),pronunciationText:z.string().optional(),questionAudioMediaId:z.string().optional(),answerAudioMediaId:z.string().optional(),explanationAudioMediaId:z.string().optional()}).optional(),
  media:z.array(z.object({id:z.string(),kind:z.enum(['image','audio']),uri:z.string(),mimeType:z.string().optional()})).default([]),warnings:z.array(z.string()).default([]),skip:z.boolean().optional()
});
export type Flashcard=z.infer<typeof Card>;
export const Design=z.object({themeId:z.enum(['washi-editorial','technical-dark','playful']).default('washi-editorial'),layoutId:z.enum(['reveal','multiple-choice']).default('reveal'),motionId:z.enum(['calm','snappy','none']).default('calm'),countdownStyle:z.enum(['ring','bar','numeric']).default('bar'),tokens:z.object({background:z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),ink:z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),accent:z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),headingFont:z.enum(['system','serif','mono']).optional(),bodyFont:z.enum(['system','serif','mono']).optional()}).default({}),branding:z.object({channelName:z.string().max(50).optional(),watermark:z.string().max(50).optional(),logoDataUri:z.string().regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/).max(500000).optional()}).default({})});
export type DesignConfig=z.infer<typeof Design>;
export const Settings=z.object({templateId:z.enum(['reveal','multiple-choice']).default('reveal'),audio:z.enum(['silent','mock','original','tts']).default('silent'),voice:z.string().default('alloy'),language:z.string().default('en'),rate:z.number().min(0.5).max(2).default(1),fps:z.literal(30).default(30),width:z.literal(1080).default(1080),height:z.literal(1920).default(1920),timing:z.object({mode:z.enum(['flexible','target']).default('flexible'),targetSeconds:z.number().positive().optional(),thinkSeconds:z.number().min(0).default(4),minThinkSeconds:z.number().min(0).default(1),revealSeconds:z.number().min(0.2).default(1),holdSeconds:z.number().min(0).default(2),infeasibleTarget:z.enum(['fail','extend']).default('fail')}).prefault({}),design:Design.prefault({})}).refine(s=>s.templateId===s.design.layoutId,{message:'Template and layout must match'});
export type RenderSettings=z.infer<typeof Settings>;
export function textOf(blocks:z.infer<typeof Block>[]|undefined){return (blocks||[]).filter((b):b is Extract<z.infer<typeof Block>,{kind:'text'}>=>b.kind==='text').map(b=>b.text).join(' ').trim();}
export function validateCard(card:Flashcard,template:'reveal'|'multiple-choice'='reveal'){
  const reasons:string[]=[];
  if(card.skip) reasons.push('Marked to skip');
  if(!card.front.length||!card.back.length) reasons.push('Question or answer is empty');
  if(textOf(card.front).length>320||textOf(card.back).length>220||textOf(card.explanation).length>180) reasons.push('Text exceeds safe video layout limits; shorten or split this card');
  for(const warning of card.warnings) if(/^(Missing media|Unsupported conditional|Unsupported template)/.test(warning)) reasons.push(warning);
  if(template==='multiple-choice'&&(!card.options||card.options.length<2||card.options.filter(o=>o.correct).length!==1||new Set(card.options.map(o=>o.id)).size!==card.options.length)) reasons.push('Multiple-choice requires at least two unique options and exactly one correct answer');
  const ids=new Set(card.media.map(m=>m.id));
  for(const key of ['questionAudioMediaId','answerAudioMediaId','explanationAudioMediaId'] as const){const id=card.narration?.[key];if(id&&!card.media.some(m=>m.id===id&&m.kind==='audio')) reasons.push(`Selected audio ${id} is missing`);}
  for(const b of [...card.front,...card.back,...(card.explanation||[])]) if(b.kind==='image'&&!ids.has(b.mediaId)) reasons.push(`Missing image ${b.mediaId}`);
  if([...card.front,...card.back].some(b=>b.kind==='math')) reasons.push('Math rendering needs review');
  return {ok:reasons.length===0,reasons};
}
export function parseCards(input:unknown):Flashcard[]{const raw=Array.isArray(input)?input:(input as {cards?:unknown})?.cards;return z.array(Card).parse(raw);}
