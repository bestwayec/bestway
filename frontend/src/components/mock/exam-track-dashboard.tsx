"use client";
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api-client';
import { useExamPrograms } from '@/hooks/use-exam-programs';
import { useMockExams } from '@/hooks/use-mock';
import type { MockAttemptSummary, MockSkill } from '@/lib/types';
import { Card } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';

export function ExamTrackDashboard() {
  const t = useTranslations('examTrack');
  const tm = useTranslations('mock');
  const state = useExamPrograms();
  const program = state.data?.activeProgram;
  const exams = useMockExams();
  const history = useQuery({ queryKey: ['mock-attempts-mine', program], queryFn: () => api.get<MockAttemptSummary[]>('/mock/attempts/mine', { program }), enabled: !!program });
  if (!program) return null;
  const matches = (type?: string) => program === 'MULTILEVEL' ? type === 'multilevel' : type !== 'multilevel';
  return <Card className="my-4 space-y-3 p-4"><h2 className="font-semibold">{program} · {t('practice')}</h2>
    {program === 'MULTILEVEL' && <p className="text-sm text-fg-muted">{t('estimated')}</p>}
    <div className="grid gap-2 sm:grid-cols-2">{(['listening','reading','writing','speaking'] as MockSkill[]).map((skill) => <div key={skill}><h3 className="font-medium">{tm(`skills.${skill}`)}</h3>
      {exams.data?.filter((e) => matches(e.type) && e.skills.includes(skill) && e.access === 'granted').map((e) => <Link className="block text-sm text-brand" key={e.id} href={`/mock/${e.id}`}>{e.title}</Link>)}
    </div>)}</div><Link className="text-brand" href="/mock">{t('browse')}</Link>
    <h3 className="font-medium">{t('history')}</h3>{history.isError && <p role="alert">{t('loadError')}</p>}
    {history.data?.filter((a) => matches(a.examType)).map((a) => <Link className="block text-sm" key={a.id} href={`/mock/attempt/${a.id}`}>{a.examTitle} · {tm(`status.${a.status}`)} · {program === 'MULTILEVEL' ? a.overallScore ?? '—' : a.overallBand ?? '—'} {a.cefrLevel ?? ''}</Link>)}
  </Card>;
}
