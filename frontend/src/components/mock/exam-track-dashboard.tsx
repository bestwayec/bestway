"use client";
import { useTranslations } from 'next-intl';
import { useStudentProgramScope } from '@/hooks/use-exam-programs';
import { useMockExams, useMyMockAttempts } from '@/hooks/use-mock';
import type { MockSkill } from '@/lib/types';
import { Card } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';

export function ExamTrackDashboard() {
  const t = useTranslations('examTrack');
  const tm = useTranslations('mock');
  const { program } = useStudentProgramScope();
  const exams = useMockExams();
  const history = useMyMockAttempts();
  if (!program) return null;
  const matches = (type?: string) => program === 'MULTILEVEL' ? type === 'multilevel' : type !== 'multilevel';
  return <Card className="my-4 space-y-3 p-4"><h2 className="font-semibold">{program} · {t('practice')}</h2>
    {program === 'MULTILEVEL' && <p className="text-sm text-fg-muted">{t('estimated')}</p>}
    <div className="grid gap-2 sm:grid-cols-2">{(['listening','reading','writing','speaking'] as MockSkill[]).map((skill) => <div key={skill}><h3 className="font-medium">{tm(`skills.${skill}`)}</h3>
      {exams.isPending ? <p role="status">{t('loading')}</p> : exams.isError ? <p role="alert">{t('loadError')}</p> : exams.data?.some((e) => e.skills.includes(skill)) ? exams.data.filter((e) => matches(e.type) && e.skills.includes(skill)).map((e) => <Link className="block text-sm text-brand" key={e.id} href={`/mock/${e.id}`}>{e.title}{e.practiceLevel ? ` · ${e.practiceLevel}` : ''}</Link>) : <p className="text-sm text-fg-muted">{t('noPractice')}</p>}
    </div>)}</div><Link className="text-brand" href="/mock">{t('browse')}</Link>
    <h3 className="font-medium">{t('history')}</h3>{history.isError && <p role="alert">{t('loadError')}</p>}
    {history.isPending && <p role="status">{t('loading')}</p>}
    {!history.isPending && !history.isError && !history.data?.length && <p>{t('noHistory')}</p>}
    {history.data?.filter((a) => matches(a.examType)).map((a) => <Link className="block text-sm" key={a.id} href={`/mock/attempt/${a.id}${a.status !== 'in_progress' ? '#assessment-feedback' : ''}`}>{a.examTitle} · {tm(`status.${a.status}`)} · {program === 'MULTILEVEL' ? a.overallScore != null ? `${a.overallScore}/75` : '—' : a.overallBand?.toFixed(1) ?? '—'} {program === 'MULTILEVEL' ? a.cefrLevel ?? '' : ''}</Link>)}
  </Card>;
}
