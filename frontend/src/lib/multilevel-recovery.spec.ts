import { describe, expect, it } from 'vitest';
import { recordingKey, markActiveRecording, hasActiveRecording } from './durable-recordings';
import { examClientChecks } from '@/components/exam-builder/checks';
import type { MockSection } from './types';
describe('Multilevel web adapters',()=>{
  it('isolates pending recording activity between attempts',()=>{
    const key=recordingKey('attempt','question'); markActiveRecording(key,true);
    expect(hasActiveRecording('attempt')).toBe(true); expect(hasActiveRecording('other')).toBe(false);
    markActiveRecording(key,false); expect(hasActiveRecording('attempt')).toBe(false);
  });
  it('permits question numbering to restart in every section (Multilevel and IELTS) but still finds duplicates inside a section',()=>{
    const sections=['listening','reading'].map((skill)=>({id:skill,skill,groups:[{id:skill,sortOrder:0,title:skill,hasAudio:true,passageText:'Original passage',questions:[{id:skill,number:1,type:'short_answer',prompt:'Name the fictional library.',correctAnswers:['library'],wordLimit:1}]}]})) as unknown as MockSection[];
    expect(examClientChecks(sections,'practice','multilevel').filter((c)=>c.label.includes('Duplicate'))).toHaveLength(0);
    // Owner decision: IELTS sections are numbered from 1 like the paper.
    expect(examClientChecks(sections,'practice','ielts_academic').filter((c)=>c.label.includes('Duplicate'))).toHaveLength(0);
    const reading=sections[1] as unknown as {groups:{questions:{id:string}[]}[]};
    reading.groups[0].questions.push({...reading.groups[0].questions[0],id:'reading-2'});
    expect(examClientChecks(sections,'practice','ielts_academic').filter((c)=>c.label.includes('Duplicate'))).toHaveLength(1);
  });
});
