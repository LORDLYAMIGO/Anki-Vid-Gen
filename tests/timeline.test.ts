import {describe,it,expect} from 'vitest';
import {Settings} from '../src/core.ts';
import {planTimeline} from '../src/timeline.ts';
const sound=(durationMs:number)=>({file:'test.mp3',durationMs});
describe('timeline',()=>{
  it('starts countdown after question audio and finishes after answer audio',()=>{const s=Settings.parse({timing:{mode:'target',targetSeconds:15,thinkSeconds:4,minThinkSeconds:1}}),p=planTimeline({question:sound(2100),answer:sound(2900),explanation:null},s);expect(p.thinkStart).toBe(p.questionAudioEnd);expect(p.thinkStart).toBe(75);expect(p.revealStart).toBeGreaterThanOrEqual(p.thinkEnd);expect(p.answerSpeechStart).toBeGreaterThanOrEqual(p.revealStart);expect(p.end).toBeGreaterThanOrEqual(p.answerSpeechEnd);expect(p.end).toBe(450);});
  it('fails infeasible target instead of truncating narration',()=>{const s=Settings.parse({timing:{mode:'target',targetSeconds:5,minThinkSeconds:1}});expect(()=>planTimeline({question:sound(5000),answer:sound(4000),explanation:null},s)).toThrow(/cannot fit/);});
  it('extends only when selected',()=>{const s=Settings.parse({timing:{mode:'target',targetSeconds:5,minThinkSeconds:1,infeasibleTarget:'extend'}});const p=planTimeline({question:sound(5000),answer:sound(4000),explanation:null},s);expect(p.targetExtended).toBe(true);expect(p.end).toBeGreaterThan(150);});
});
