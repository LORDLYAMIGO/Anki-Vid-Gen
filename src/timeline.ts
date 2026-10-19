import type {RenderSettings} from './core.ts';
export type AudioAsset={file:string;durationMs:number}|null;
export type ResolvedAudio={question:AudioAsset;answer:AudioAsset;explanation:AudioAsset};
export type RenderPlan={fps:30;questionStart:number;questionAudioEnd:number;thinkStart:number;thinkEnd:number;revealStart:number;answerSpeechStart:number;answerSpeechEnd:number;explanationStart:number;explanationEnd:number;end:number;targetExtended:boolean;audio:ResolvedAudio};
export function planTimeline(audio:ResolvedAudio, settings:RenderSettings):RenderPlan{
  const fps=settings.fps, f=(ms:number)=>Math.ceil(ms*fps/1000), s=(n:number)=>Math.round(n*fps);
  const questionStart=s(0.4), questionAudioEnd=questionStart+f(audio.question?.durationMs||0);
  let think=s(settings.timing.thinkSeconds),hold=s(settings.timing.holdSeconds);
  const minThink=s(settings.timing.minThinkSeconds),reveal=s(settings.timing.revealSeconds);
  const answer=f(audio.answer?.durationMs||0), explanation=f(audio.explanation?.durationMs||0);
  const fixed=questionAudioEnd+reveal+answer+explanation;
  let targetExtended=false;
  if(settings.timing.mode==='target'){
    if(!settings.timing.targetSeconds) throw new Error('Target seconds is required');
    const target=s(settings.timing.targetSeconds);
    hold=Math.max(0,Math.min(hold,target-fixed-think));
    think=Math.max(minThink,Math.min(think,target-fixed-hold));
    if(fixed+think>target){if(settings.timing.infeasibleTarget==='fail') throw new Error(`Target ${settings.timing.targetSeconds}s cannot fit narration and minimum countdown; need at least ${((fixed+minThink)/fps).toFixed(2)}s`);targetExtended=true;}
    else hold=Math.max(0,target-fixed-think);
  }
  const thinkStart=questionAudioEnd,thinkEnd=thinkStart+think,revealStart=thinkEnd,answerSpeechStart=revealStart+reveal,answerSpeechEnd=answerSpeechStart+answer,explanationStart=answerSpeechEnd,explanationEnd=explanationStart+explanation,end=explanationEnd+hold;
  return {fps,questionStart,questionAudioEnd,thinkStart,thinkEnd,revealStart,answerSpeechStart,answerSpeechEnd,explanationStart,explanationEnd,end:Math.max(end,explanationEnd+1),targetExtended,audio};
}
