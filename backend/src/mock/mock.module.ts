import { Module } from '@nestjs/common';
import { StorageService } from '../videos/storage.service';
import { MockController } from './mock.controller';
import { MockExamImportController } from './mock-exam-import.controller';
import { MockAccessService } from './mock-access.service';
import { MockAttemptService } from './mock-attempt.service';
import { MockAuthoringService } from './mock-authoring.service';
import { MockCertificateService } from './mock-certificate.service';
import { MockExamImportService } from './mock-exam-import.service';
import { MockGradingService } from './mock-grading.service';
import { AssessmentService } from '../assessment/assessment.service';

/**
 * Real IELTS/Multilevel mock imtihon moduli — mustaqil (src/mock/).
 * PrismaService, AccessService, AuditService, NotificationsService global
 * modullardan keladi. StorageService (disk) shu yerda ta'minlanadi.
 */
@Module({
  controllers: [MockController, MockExamImportController],
  providers: [
    MockAuthoringService,
    MockAttemptService,
    MockGradingService,
    MockCertificateService,
    MockAccessService,
    MockExamImportService,
    StorageService,
    AssessmentService,
  ],
  exports: [MockGradingService, StorageService, AssessmentService],
})
export class MockModule {}
