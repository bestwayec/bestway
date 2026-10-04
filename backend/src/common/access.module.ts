import { Global, Module } from '@nestjs/common';
import { AccessService } from './access.service';
import { ExamProgramService } from './exam-program.service';
import { ExamProgramController } from './exam-program.controller';

@Global()
@Module({
  controllers: [ExamProgramController],
  providers: [AccessService, ExamProgramService],
  exports: [AccessService, ExamProgramService],
})
export class AccessModule {}
