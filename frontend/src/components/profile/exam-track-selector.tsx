"use client";
import { useTranslations } from 'next-intl';
import { useExamPrograms, useSetExamPrograms, type ExamProgram } from '@/hooks/use-exam-programs';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export function ExamTrackSelector({ studentId }: { studentId?: string }) {
  const t = useTranslations('examTrack');
  const state = useExamPrograms(studentId);
  const save = useSetExamPrograms(studentId);
  if (state.isPending) return <p role="status">{t('loading')}</p>;
  if (!state.data) return <p role="alert">{t('loadError')}</p>;
  const current = state.data;
  const manage = !!studentId;
  return <Card className="my-4 space-y-3 p-4">
    <h2 className="font-semibold">{t(manage ? 'manage' : 'title')}</h2>
    <div className="grid gap-3 sm:grid-cols-2">{(['IELTS','MULTILEVEL'] as ExamProgram[]).map((program) => {
      const available = current.availablePrograms.includes(program);
      return <div key={program} className="space-y-2 rounded-[8px] border border-border p-3">
        <h3 className="font-semibold">{program}</h3><p className="text-sm text-fg-muted">{t(program === 'IELTS' ? 'ieltsDescription' : 'multilevelDescription')}</p>
        <p className="text-sm">{t(available ? current.activeProgram === program ? 'active' : 'enrolled' : 'locked')}</p>
        <Button size="sm" disabled={!available || save.isPending || current.activeProgram === program} onClick={() => save.mutate({ ...current, activeProgram: program })}>{t('select')}</Button>
        {manage && <Button size="sm" variant="outline" disabled={save.isPending} onClick={() => {
          const programs = available ? current.availablePrograms.filter((p) => p !== program) : [...current.availablePrograms, program];
          save.mutate({ availablePrograms: programs, activeProgram: current.activeProgram && programs.includes(current.activeProgram) ? current.activeProgram : programs[0] ?? null });
        }}>{t(available ? 'remove' : 'assign')}</Button>}
      </div>;
    })}</div>
    {save.isError && <p role="alert" className="text-danger">{save.error.message}</p>}
  </Card>;
}
