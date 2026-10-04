import { Module } from '@nestjs/common';
import { AccessModule } from '../common/access.module';
import { MockModule } from '../mock/mock.module';
import { AssessmentController } from './assessment.controller';
import { AssessmentService } from './assessment.service';
import { AssessmentWorker } from './assessment.worker';
import { DeepgramSpeechToTextProvider } from './deepgram.provider';
import { DeepSeekAssessmentProvider } from './deepseek.provider';

@Module({
  imports: [AccessModule, MockModule],
  controllers: [AssessmentController],
  providers: [AssessmentWorker, DeepSeekAssessmentProvider, DeepgramSpeechToTextProvider],
})
export class AssessmentModule {}
