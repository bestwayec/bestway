import { describe, expect, it } from 'vitest';
import { convertExpertScore, estimateObjective, multilevelBlueprintIssues, multilevelLevel, multilevelOverall, SPEAKING_CONVERSION, WRITING_CONVERSION, taskGuidance } from './multilevel-specification';
import { multilevelFixture } from './multilevel.fixture';
import { computeSkillTiming } from './mock-shape';

describe('versioned Multilevel specification', () => {
  it('validates an original complete 70-question objective fixture', () => {
    const fixture = multilevelFixture();
    expect(multilevelBlueprintIssues(fixture, true)).toEqual([]);
    expect(fixture.slice(0,2).map((s) => s.groups.reduce((n,g) => n+g.questions.length,0))).toEqual([35,35]);
    expect(fixture[2].groups.map((g) => g.questions[0].points)).toEqual([5,5,6]);
    expect(fixture[3].groups.map((g) => g.questions.length)).toEqual([3,3,1,1]);
  });
  it('rejects missing audio duration, malformed mixed reading types and missing pictures', () => {
    const fixture = multilevelFixture();
    fixture[0].groups[0].audioDurationSec = null;
    fixture[1].groups[3].questions[4].type = 'multiple_choice';
    fixture[3].groups[1].imageKey = null;
    expect(multilevelBlueprintIssues(fixture,true)).toEqual(expect.arrayContaining([
      expect.stringContaining('positive audio duration'), expect.stringContaining('invalid type'), expect.stringContaining('two-picture'),
    ]));
  });
  it('uses one semantic cap for every writing task and speaking part', () => {
    const fixture = multilevelFixture();
    fixture[2].groups.forEach((group) => group.questions.forEach((question) => { question.points = 9; }));
    fixture[3].groups.forEach((group) => group.questions.forEach((question) => { question.points = 9; }));
    expect(multilevelBlueprintIssues(fixture, true)).toEqual([]);
    expect(taskGuidance('writing', 0, 0)?.displayLabel).toBe('Task 1.1 — Informal Letter');
    expect(taskGuidance('writing', 1, 0)?.displayLabel).toBe('Task 1.2 — Formal Letter');
  });
  it.each(['writing','speaking'] as const)('converts every %s half-point, rejecting invalid scores', (skill) => {
    const table = skill === 'writing' ? WRITING_CONVERSION : SPEAKING_CONVERSION;
    table.forEach((score,i) => expect(convertExpertScore(skill,i/2)).toBe(score));
    for (const invalid of [-0.5,0.25,NaN,Infinity,table.length/2]) expect(() => convertExpertScore(skill,invalid)).toThrow(RangeError);
    expect(convertExpertScore(skill,(table.length-1)/2)).toBe(75);
  });
  it.each([[0,'BELOW_B1'],[37.99,'BELOW_B1'],[38,'B1'],[50.99,'B1'],[51,'B2'],[64.99,'B2'],[65,'C1'],[75,'C1']])('classifies %s as %s without A1/A2', (score,level) => expect(multilevelLevel(Number(score))).toBe(level));
  it.each([[9,37],[10,38],[17,50],[18,51],[27,64],[28,65],[35,75]])('labels %s correct answers as estimate %s, never official', (raw,estimate) => {
    expect(estimateObjective(raw,35)).toMatchObject({estimatedStandardScore:estimate, scoreMethod:'ESTIMATED',isOfficial:false});
  });
  it('requires all four scores and averages without premature rounding', () => {
    expect(multilevelOverall({listening:75})).toBeNull();
    expect(multilevelOverall({listening:38,reading:51,writing:65,speaking:75})).toBe(57.25);
  });
  it('uses task timing and word targets while preserving IELTS speaking timing', () => {
    expect(taskGuidance('writing',0,0)).toMatchObject({wordMin:50,wordMax:50});
    expect(taskGuidance('speaking',1,0)).toMatchObject({prepSeconds:15,responseSeconds:45});
    expect(computeSkillTiming('speaking',{},0,'multilevel').seconds).toBe(660);
    expect(computeSkillTiming('speaking',{},0,'ielts_academic').deadline).toBeNull();
    expect(computeSkillTiming('listening',{groups:[{audioDurationSec:60}]},0,'ielts_academic').seconds).toBe(180);
    expect(computeSkillTiming('listening',{},0,'multilevel').seconds).toBe(2700);
  });
});
