// Read-only use of the compiled reference; no AppModule, database or real HTTP.
const path=require('node:path'),{createRequire}=require('node:module');
const root=path.resolve(__dirname,'../../backend'),ref=createRequire(path.join(root,'package.json'));
ref('reflect-metadata');const load=p=>ref(path.join(root,'dist/assessment',p));
const scoring=load('assessment-scoring.js'),validation=load('result-validation.js'),prompts=load('prompts.js'),http=load('provider-http.js');
const {ConfigService}=ref('@nestjs/config');
let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',v=>input+=v);
process.stdin.on('end',async()=>{
 const outputs=[];
 for(const row of JSON.parse(input)){
  try {
   let result;
   if(row.action==='validate')result=validation.validateAssessmentResult(row.result,row.input);
   else if(row.action==='score')result=scoring.scoreAssessment(row.input,row.result);
   else if(row.action==='schema')result=validation.assessmentResultSchema(row.input);
   else if(row.action==='prompt')result=prompts.systemPrompt(row.input);
   else if(row.action==='teacher')result=scoring.teacherResult(row.input,row.result,row.parts);
   else if(row.action==='combine')result=validation.combineAssessmentResults(row.result,row.other,row.input);
   else if(row.action==='adjudicate')result=scoring.shouldAdjudicate(row.input,row.result,row.threshold);
   else if(row.action==='url')result=http.providerUrl(row.base,row.endpoint).toString();
   else if(row.action==='deepseek'||row.action==='deepgram'){
    const calls=[];global.fetch=async(url,options)=>{
     calls.push({url:String(url),headers:options.headers,body:typeof options.body==='string'?JSON.parse(options.body):Buffer.from(options.body).toString('base64')});
     return new Response(JSON.stringify(row.response),{status:row.status??200});
    };
    const config=new ConfigService(row.config);
    const provider=row.action==='deepseek'?new (load('deepseek.provider.js').DeepSeekAssessmentProvider)(config):new (load('deepgram.provider.js').DeepgramSpeechToTextProvider)(config);
    try {
     const value=row.action==='deepseek'?await provider.assess(row.input,row.role??'PRIMARY'):await provider.transcribe(row.input);
     if('latencyMs' in value){if(!Number.isInteger(value.latencyMs)||value.latencyMs<0)throw new Error('Invalid latency');delete value.latencyMs;}
     result={value,calls};
    }catch(error){outputs.push({error:error.code??'INTERNAL_ERROR',transient:error.transient??false,uncertain:error.uncertain??false,calls});continue;}
   }else throw new Error('Unknown probe action');
   outputs.push({value:result});
  }catch(error){outputs.push({error:error.code??'INTERNAL_ERROR'});}
 }
 process.stdout.write(JSON.stringify(outputs));
});
