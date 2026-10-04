import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AssessmentInput, AssessmentProvider, AssessmentProviderError, ProviderEvaluation } from './contracts';
import { systemPrompt } from './prompts';
import { assessmentResultSchema, validateAssessmentResult } from './result-validation';
import { boundedConfig, providerJson, providerRecord, providerUrl } from './provider-http';

@Injectable()
export class DeepSeekAssessmentProvider implements AssessmentProvider {
  constructor(private readonly config: ConfigService) {}

  async assess(input: AssessmentInput, role: 'PRIMARY' | 'ADJUDICATOR'): Promise<ProviderEvaluation> {
    const key = this.config.get<string>('DEEPSEEK_API_KEY')?.trim();
    const model = this.config.get<string>(role === 'ADJUDICATOR' ? 'DEEPSEEK_ADJUDICATOR_MODEL' : 'DEEPSEEK_MODEL')?.trim();
    if (!key || !model) throw new AssessmentProviderError('PROVIDER_NOT_CONFIGURED');
    const url = providerUrl(this.config.get<string>('DEEPSEEK_BASE_URL') || 'https://api.deepseek.com', 'responses');
    // Send rubric/task context and response evidence, not student IDs, storage paths or hashes.
    const payload = { program: input.program, skill: input.skill, rubricVersion: input.rubricVersion,
      specificationVersion: input.specificationVersion, speakingProfileVersion: input.speakingProfileVersion,
      pronunciationEvidence: input.pronunciationEvidence,
      parts: input.parts.map(part => ({ id: part.id, max: part.max, task: part.task, context: part.context,
        imageEvidence: part.imageKeys?.length ? 'UNAVAILABLE_USE_ONLY_SUPPLIED_TEXT_DESCRIPTION' : 'NOT_REQUIRED',
        prepSeconds: part.prepSeconds, responseSeconds: part.responseSeconds,
        responses: part.responses.map(response => ({ prompt: response.prompt, partNumber: response.partNumber,
          response: input.skill === 'speaking' ? response.transcript || '' : response.originalResponse,
          durationMs: response.durationMs })),
      })),
    };
    const body = JSON.stringify({ model, instructions: systemPrompt(input),
      input: [{ role: 'user', content: [{ type: 'input_text', text: JSON.stringify(payload) }] }],
      text: { format: { type: 'json_schema', name: 'bestway_assessment', schema: assessmentResultSchema(input) } },
      reasoning: { effort: 'none' }, temperature: 0.2, stream: false, tool_choice: 'none',
      max_output_tokens: boundedConfig(this.config.get('ASSESSMENT_MAX_OUTPUT_TOKENS'), 8000, 2000, 16000),
    });
    if (Buffer.byteLength(body) > 512 * 1024) throw new AssessmentProviderError('ASSESSMENT_INPUT_TOO_LARGE');
    const started = Date.now();
    const response = providerRecord(await providerJson(url, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body },
      boundedConfig(this.config.get('ASSESSMENT_PROVIDER_TIMEOUT_MS'), 90000, 1000, 180000)));
    if (response.status !== 'completed') throw new AssessmentProviderError('PROVIDER_TRUNCATED_RESULT');
    if (!Array.isArray(response.output)) throw new AssessmentProviderError('PROVIDER_RESPONSE_INVALID');
    const messages = response.output.map(providerRecord).filter(item => item.type === 'message');
    if (messages.length !== 1 || messages[0].status !== 'completed' || messages[0].role !== 'assistant' || !Array.isArray(messages[0].content)) throw new AssessmentProviderError('PROVIDER_RESPONSE_INVALID');
    const content = messages[0].content.map(providerRecord);
    if (content.length !== 1 || content[0].type !== 'output_text' || typeof content[0].text !== 'string' || !content[0].text.trim()) throw new AssessmentProviderError('PROVIDER_EMPTY_RESPONSE');
    let parsed: unknown;
    try { parsed = JSON.parse(content[0].text); } catch { throw new AssessmentProviderError('PROVIDER_MALFORMED_JSON'); }
    const result = validateAssessmentResult(parsed, input);
    // This adapter cannot inspect picture assets; prevent confident automatic grades on unseen images.
    if (input.parts.some(part => part.imageKeys?.length)) result.confidence = Math.min(result.confidence, 0.79);
    const usage = response.usage ? providerRecord(response.usage) : {};
    const token = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
    return { result, provider: 'deepseek', model, inputTokens: token(usage.input_tokens), outputTokens: token(usage.output_tokens), latencyMs: Date.now() - started };
  }
}
