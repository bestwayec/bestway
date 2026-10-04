import { AssessmentInput, AssessmentPartResult, AssessmentProviderError, AssessmentResult, PartFeedback } from './contracts';

const feedbackText = ['taskCoverage','grammar','vocabulary','fluencyCohesion','ideaDevelopment','register','spellingPunctuation','position','argumentBalance'] as const;
const feedbackLists = ['strengths','issues','missedPrompts','usefulPhrases'] as const;
const topLists = ['overallStrengths','priorityImprovements','recommendedPractice'] as const;
const resultKeys = ['parts', ...topLists, 'grammarCorrections','vocabularyUpgrades','improvedExamples','confidence','pronunciationEvidence'];
function invalid(): never { throw new AssessmentProviderError('RESULT_SCHEMA_INVALID'); }
function record(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(); return value as Record<string, unknown>; }
function exact(value: Record<string, unknown>, keys: readonly string[]) { if (Object.keys(value).length !== keys.length || keys.some(k => !Object.prototype.hasOwnProperty.call(value,k))) invalid(); }
function text(value: unknown): string { if (typeof value !== 'string' || value.length > 8000) invalid(); return value; }
function list(value: unknown): string[] { if (!Array.isArray(value) || value.length > 30) invalid(); return value.map(text); }
function array(value: unknown, max = 30): unknown[] { if (!Array.isArray(value) || value.length > max) invalid(); return value; }
function num(value: unknown, max: number, half = false): number { if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max || (half && value * 2 !== Math.round(value * 2))) invalid(); return value; }
export function criterionKeys(input: AssessmentInput): string[] {
  return input.program === 'MULTILEVEL' ? ['taskCoverage','grammar','vocabulary','cohesion','ideaDevelopment'] : input.skill === 'writing' ? ['ta','cc','lr','gra'] : ['fluency','lexical','grammar','pronunciation'];
}
function feedback(value: unknown): PartFeedback {
  const row = record(value); exact(row,[...feedbackText,...feedbackLists,'forCovered','againstCovered']);
  const result = Object.fromEntries(feedbackText.map(key=>[key,text(row[key])])) as unknown as PartFeedback;
  for (const key of feedbackLists) result[key] = list(row[key]);
  for (const key of ['forCovered','againstCovered'] as const) { if (row[key] !== null && typeof row[key] !== 'boolean') invalid(); result[key] = row[key] as boolean | null; }
  return result;
}
function objects(value: unknown, keys: string[]): Array<Record<string,string>> {
  return array(value).map(v=>{ const row=record(v); exact(row,keys); return Object.fromEntries(keys.map(k=>[k,text(row[k])])); });
}

/** Validate every boundary and derive IELTS task arithmetic from criteria, not model totals. */
export function validateAssessmentResult(value: unknown, input: AssessmentInput): AssessmentResult {
  const row = record(value); exact(row,resultKeys);
  if (row.pronunciationEvidence !== input.pronunciationEvidence) invalid();
  const rows = array(row.parts,20);
  if (rows.length !== input.parts.length) invalid();
  const seen = new Set<string>();
  const keys = criterionKeys(input);
  const parts: AssessmentPartResult[] = rows.map(v=>{
    const p=record(v); exact(p,['id','rawScore','criteria','evidence','feedback']); const id=text(p.id);
    const spec=input.parts.find(s=>s.id===id); if (!spec || seen.has(id)) invalid(); seen.add(id);
    const criteria=record(p.criteria); const evidence=record(p.evidence); exact(criteria,keys); exact(evidence,keys);
    const normalized: Record<string,number|null>={}; const explanations: Record<string,string>={};
    for (const key of keys) {
      const unavailable = key==='pronunciation' && input.pronunciationEvidence==='UNAVAILABLE';
      if (unavailable && criteria[key] !== null) invalid();
      normalized[key]=unavailable ? null : num(criteria[key],spec.max,true);
      explanations[key]=text(evidence[key]); if (!explanations[key].trim()) invalid();
    }
    let rawScore = p.rawScore === null ? null : num(p.rawScore,spec.max,input.program==='MULTILEVEL');
    if (input.program!=='MULTILEVEL') {
      const values=Object.values(normalized); rawScore=values.some(s=>s===null) ? null : values.reduce<number>((a,b)=>a+b!,0)/values.length;
    } else if (rawScore===null) invalid();
    const fb=feedback(p.feedback);
    if (input.program==='MULTILEVEL' && input.skill==='speaking' && id==='3' && rawScore===6 && (fb.forCovered!==true || fb.againstCovered!==true)) invalid();
    return {id,rawScore,criteria:normalized,evidence:explanations,feedback:fb};
  });
  const examples=objects(row.improvedExamples,['partId','text']);
  if (examples.some(e=>!seen.has(e.partId))) invalid();
  return {
    parts, overallStrengths:list(row.overallStrengths),priorityImprovements:list(row.priorityImprovements),recommendedPractice:list(row.recommendedPractice),
    grammarCorrections:objects(row.grammarCorrections,['original','corrected','explanation']) as AssessmentResult['grammarCorrections'],
    vocabularyUpgrades:objects(row.vocabularyUpgrades,['original','alternative','explanation']) as AssessmentResult['vocabularyUpgrades'],
    improvedExamples:examples as AssessmentResult['improvedExamples'],confidence:num(row.confidence,1),pronunciationEvidence:input.pronunciationEvidence,
  };
}

const stringSchema={type:'string',maxLength:8000};
const stringsSchema={type:'array',maxItems:30,items:stringSchema};
function objectSchema(properties: Record<string,unknown>) { return {type:'object',additionalProperties:false,properties,required:Object.keys(properties)}; }
function objectList(keys: string[]) { return {type:'array',maxItems:30,items:objectSchema(Object.fromEntries(keys.map(k=>[k,stringSchema])))}; }
export function assessmentResultSchema(input: AssessmentInput): Record<string,unknown> {
  const properties = Object.fromEntries(criterionKeys(input).map(k=>[k,k==='pronunciation'&&input.pronunciationEvidence==='UNAVAILABLE' ? {type:'null'} : {type:'number',minimum:0,maximum:input.program==='MULTILEVEL'?6:9,multipleOf:0.5}]));
  return objectSchema({
    parts:{type:'array',minItems:input.parts.length,maxItems:input.parts.length,items:objectSchema({
      id:{type:'string',enum:input.parts.map(p=>p.id)},rawScore:{type:['number','null'],minimum:0,maximum:input.program==='MULTILEVEL'?6:9},
      criteria:objectSchema(properties),evidence:objectSchema(Object.fromEntries(criterionKeys(input).map(k=>[k,stringSchema]))),
      feedback:objectSchema({...Object.fromEntries(feedbackText.map(k=>[k,stringSchema])),...Object.fromEntries(feedbackLists.map(k=>[k,stringsSchema])),forCovered:{type:['boolean','null']},againstCovered:{type:['boolean','null']}}),
    })},
    ...Object.fromEntries(topLists.map(k=>[k,stringsSchema])),grammarCorrections:objectList(['original','corrected','explanation']),
    vocabularyUpgrades:objectList(['original','alternative','explanation']),improvedExamples:objectList(['partId','text']),confidence:{type:'number',minimum:0,maximum:1},
    pronunciationEvidence:{type:'string',enum:[input.pronunciationEvidence]},
  });
}

/** Independent rater evidence stays separate in the ledger; this is the deterministic projection. */
export function combineAssessmentResults(a: AssessmentResult,b: AssessmentResult,input: AssessmentInput): AssessmentResult {
  const combined: AssessmentResult={...b,confidence:Math.min(a.confidence,b.confidence),parts:b.parts.map(p=>{
    const previous=a.parts.find(x=>x.id===p.id); if (!previous) invalid();
    const mean=(x:number|null,y:number|null)=>x===null||y===null?null:Math.round((x+y))/2;
    return {...p,rawScore:mean(previous.rawScore,p.rawScore),criteria:Object.fromEntries(Object.entries(p.criteria).map(([k,v])=>[k,mean(previous.criteria[k],v)]))};
  })};
  return validateAssessmentResult(combined,input);
}
