import React from 'react';
import {AbsoluteFill,Audio,Sequence,interpolate,useCurrentFrame} from 'remotion';
import type {Flashcard,RenderSettings} from './core.ts';
import type {RenderPlan} from './timeline.ts';

export type VideoProps={card:Flashcard;plan:RenderPlan;settings:RenderSettings};
const themes={
  'washi-editorial':{background:'#F5F0E6',ink:'#252724',accent:'#B64732',muted:'#796F66',panel:'#EAE1D3',good:'#356850'},
  'technical-dark':{background:'#101820',ink:'#F1F5F3',accent:'#63D8C3',muted:'#A3B4B4',panel:'#1C2A33',good:'#83DEB0'},
  playful:{background:'#FFF7E4',ink:'#223B52',accent:'#F26950',muted:'#557080',panel:'#F8DFC0',good:'#26886A'}
};
function words(blocks:Flashcard['front']){return blocks.map(b=>b.kind==='text'?b.text:b.kind==='math'?b.latex:'').join('\n').trim();}
function MediaBlocks({card,blocks}:{card:Flashcard;blocks:Flashcard['front']}){return <>{blocks.filter(b=>b.kind==='image').map((b,i)=>{const media=card.media.find(m=>m.id===b.mediaId);return media?<img key={i} src={media.uri} alt={b.alt||''} style={{maxWidth:'100%',maxHeight:350,objectFit:'contain',borderRadius:20,marginTop:25}}/>:null;})}</>}
export const FlashcardVideo:React.FC<VideoProps>=({card,plan,settings})=>{
  const frame=useCurrentFrame(),d=settings.design,t={...themes[d.themeId],...d.tokens};
  const font=(kind:'headingFont'|'bodyFont')=>d.tokens[kind]==='serif'?`Georgia, "Noto Serif CJK JP", "Noto Serif Devanagari", serif`:d.tokens[kind]==='mono'?`Consolas, "Noto Sans Mono", monospace`:`"Noto Sans", "Noto Sans CJK JP", "Noto Sans Devanagari", "Segoe UI", sans-serif`;
  const reveal=frame>=plan.revealStart,thinking=frame>=plan.thinkStart&&frame<plan.thinkEnd;
  const progress=thinking?(frame-plan.thinkStart)/Math.max(1,plan.thinkEnd-plan.thinkStart):0;
  const entrance=d.motionId==='none'?1:interpolate(frame,[0,d.motionId==='snappy'?9:18],[0,1],{extrapolateRight:'clamp'});
  const answerEntrance=d.motionId==='none'?1:interpolate(frame,[plan.revealStart,plan.revealStart+(d.motionId==='snappy'?8:18)],[0,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'});
  const front=words(card.front),back=words(card.back),explanation=words(card.explanation||[]);
  const frontSize=front.length>180?54:front.length>100?68:front.length>55?82:102;
  const backSize=back.length>180?50:back.length>100?64:back.length>55?76:96;
  const isChoice=d.layoutId==='multiple-choice'&&!!card.options?.length;
  return <AbsoluteFill style={{background:t.background,color:t.ink,fontFamily:font('bodyFont'),overflow:'hidden'}}>
    <div style={{position:'absolute',top:90,left:86,right:86,display:'flex',alignItems:'center',justifyContent:'space-between',fontSize:25,letterSpacing:5,textTransform:'uppercase',fontWeight:700,color:t.muted}}><span>ANKI / VIDEO STUDIO</span><span style={{display:'flex',alignItems:'center',gap:18}}>{d.branding.logoDataUri&&<img src={d.branding.logoDataUri} style={{width:54,height:54,objectFit:'contain'}}/>}{d.branding.channelName||'RECALL • 01'}</span></div>
    <div style={{position:'absolute',top:158,left:86,right:86,height:2,background:t.ink,opacity:.25}}/>
    <div style={{position:'absolute',top:220,left:92,right:92,opacity:entrance,transform:`translateY(${(1-entrance)*30}px)`}}>
      <div style={{fontSize:27,letterSpacing:4,color:t.accent,fontWeight:800,marginBottom:48}}>01 / QUESTION</div>
      <div style={{fontSize:frontSize,lineHeight:1.15,fontWeight:700,whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:700,overflow:'hidden',fontFamily:font('headingFont')}}>{front}</div>
      <MediaBlocks card={card} blocks={card.front}/>
    </div>
    {isChoice&&<div style={{position:'absolute',top:850,left:92,right:92,display:'grid',gap:15}}>{card.options!.map((o,i)=><div key={o.id} style={{padding:'19px 25px',border:`2px solid ${reveal&&o.correct?t.good:t.muted}`,borderRadius:18,background:reveal&&o.correct?t.panel:'transparent',fontSize:39,fontWeight:600}}>{String.fromCharCode(65+i)}. {o.label} {reveal&&o.correct?'✓':''}</div>)}</div>}
    <div style={{position:'absolute',top:isChoice?1370:1060,left:92,right:92}}>
      {thinking&&<div style={{height:100,display:'flex',alignItems:'center',gap:28}}><div style={{fontSize:30,letterSpacing:3,color:t.muted}}>THINK</div>{d.countdownStyle==='numeric'?<div style={{fontSize:64,fontWeight:800,color:t.accent}}>{Math.ceil((plan.thinkEnd-frame)/plan.fps)}</div>:d.countdownStyle==='ring'?<svg width="82" height="82" viewBox="0 0 82 82"><circle cx="41" cy="41" r="34" fill="none" stroke={t.panel} strokeWidth="8"/><circle cx="41" cy="41" r="34" fill="none" stroke={t.accent} strokeWidth="8" strokeDasharray={2*Math.PI*34} strokeDashoffset={2*Math.PI*34*(1-progress)} transform="rotate(-90 41 41)" strokeLinecap="round"/></svg>:<div style={{flex:1,height:12,borderRadius:20,background:t.panel,overflow:'hidden'}}><div style={{width:`${100*progress}%`,height:'100%',background:t.accent}}/></div>}</div>}
      {reveal&&<div style={{opacity:answerEntrance,transform:`translateY(${(1-answerEntrance)*26}px)`}}><div style={{width:82,height:8,background:t.accent,marginBottom:34}}/><div style={{fontSize:27,letterSpacing:4,color:t.accent,fontWeight:800,marginBottom:27}}>02 / ANSWER</div><div style={{fontSize:backSize,lineHeight:1.16,fontWeight:700,whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:410,overflow:'hidden',fontFamily:font('headingFont')}}>{back}</div><MediaBlocks card={card} blocks={card.back}/>{explanation&&<div style={{fontSize:38,lineHeight:1.35,marginTop:38,color:t.muted,maxHeight:180,overflow:'hidden'}}>{explanation}</div>}</div>}
    </div>
    <div style={{position:'absolute',left:86,right:86,bottom:155,height:2,background:t.ink,opacity:.25}}/>
    <div style={{position:'absolute',left:86,right:86,bottom:100,display:'flex',justifyContent:'space-between',fontSize:25,letterSpacing:3,color:t.muted}}><span>{d.branding.watermark||'LEARN / REMEMBER'}</span><span>{String(Math.min(plan.end,frame+1)).padStart(3,'0')} / {plan.end}</span></div>
    {plan.audio.question&&<Sequence from={plan.questionStart} durationInFrames={Math.max(1,plan.questionAudioEnd-plan.questionStart)}><Audio src={plan.audio.question.file}/></Sequence>}
    {plan.audio.answer&&<Sequence from={plan.answerSpeechStart} durationInFrames={Math.max(1,plan.answerSpeechEnd-plan.answerSpeechStart)}><Audio src={plan.audio.answer.file}/></Sequence>}
    {plan.audio.explanation&&<Sequence from={plan.explanationStart} durationInFrames={Math.max(1,plan.explanationEnd-plan.explanationStart)}><Audio src={plan.audio.explanation.file}/></Sequence>}
  </AbsoluteFill>;
};
