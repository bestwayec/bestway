"""Equivalent lifecycle fixtures for the local real-API differential runner."""
from uuid import uuid4
from psycopg import sql


def run(call, ids, db, schemas, results):
    def remember(name, values, key='attemptId'):
        for side, value in enumerate(values):
            ids[side][name] = value[key]

    def patch_attempt(name, column, value):
        for side, schema in enumerate(schemas):
            db.execute(sql.SQL('UPDATE {}."MockAttempt" SET {}=%s WHERE id=%s').format(
                sql.Identifier(schema), sql.Identifier(column)), (value, ids[side][name]))

    # The Stage A fixture is published, fully authored, with all four skills.
    starts = call('POST', '/v1/mock/exams/{full}/start', {'mode': 'practice'}, role='student', label='B:start-multilevel')
    remember('attempt', starts)
    for side, value in enumerate(starts):
        for section in value['exam']['sections']:
            ids[side][section['skill']+'_q'] = section['groups'][0]['questions'][0]['id']
            ids[side][section['skill']+'_g'] = section['groups'][0]['id']
    call('POST', '/v1/mock/exams/{full}/start', {'mode': 'timed'}, role='student', label='B:resume-does-not-reset-mode')
    call('POST', '/v1/mock/attempts/{attempt}/answer', dict(questionId='{reading_q}', response='A'), role='student', label='B:save')
    call('POST', '/v1/mock/attempts/{attempt}/answer', dict(questionId='{reading_q}', response='A'), role='student', label='B:retry')
    call('POST', '/v1/mock/attempts/{attempt}/answers', dict(answers=[dict(questionId='{reading_q}', response='B'), dict(questionId='{writing_q}', response='Original synthetic writing.')]), role='student', label='B:autosave')
    call('POST', '/v1/mock/attempts/{attempt}/answers', dict(answers=[dict(questionId='{reading_q}', response=''), dict(questionId='{reading_q}', response='A')]), role='student', label='B:duplicate-last-write')
    call('POST', '/v1/mock/exams/{full}/start', {}, role='student', label='B:resume-saved')
    call('GET', '/v1/mock/attempts/{attempt}', role='student', label='B:keyless-detail')
    call('GET', '/v1/mock/attempts/mine?program=IELTS', role='student', label='B:active-track-filter')
    call('PUT', '/v1/mock/attempts/{attempt}/annotations', dict(annotations=[dict(note='Original note')]), role='student')
    call('POST', '/v1/mock/attempts/{attempt}/flag-cheat', dict(event='tab_switch'), role='student')
    call('POST', '/v1/mock/attempts/{attempt}/advance', {}, role='student', label='B:non-full-test')
    call('POST', '/v1/mock/attempts/{attempt}/listening/{listening_g}/prepare', {}, role='student')
    call('POST', '/v1/mock/attempts/{attempt}/listening/{listening_g}/play', {}, role='student', label='B:preview-active')
    call('POST', '/v1/mock/attempts/{attempt}/speaking/{speaking_q}/start', {}, role='student')
    call('POST', '/v1/mock/attempts/{attempt}/speaking/{speaking_q}', role='student', files={'audio': ('fixture.wav', b'RIFF0000WAVEsynthetic-audio', 'audio/wav')})
    call('GET', '/v1/mock/attempts/{attempt}/answers/{speaking_q}/audio', role='student', label='B:own-recorded-audio')
    call('POST', '/v1/mock/attempts/{attempt}/speaking/{speaking_q}', role='student', files={'audio': ('fixture.wav', b'RIFF0000WAVEreplacement-audio', 'audio/wav')}, label='B:replace-practice-audio')
    call('POST', '/v1/mock/exams/{full}/start', {}, role='student', label='B:resume-audio-sentinel')
    call('POST', '/v1/mock/attempts/{attempt}/speaking/{speaking_q}', role='student', files={'audio': ('bad.wav', b'not audio at all', 'audio/wav')}, label='B:invalid-container')
    missing = str(uuid4())
    call('POST', '/v1/mock/attempts/{attempt}/answer', dict(questionId=missing, response='A'), role='student', label='B:foreign-question')
    call('POST', '/v1/mock/attempts/{attempt}/answers', dict(answers=[dict(questionId='{reading_q}', response='A'), dict(questionId=missing, response='B')]), role='student', label='B:atomic-bulk-denial')
    patch_attempt('attempt', 'status', 'completed')
    call('POST', '/v1/mock/attempts/{attempt}/answer', dict(questionId='{reading_q}', response='changed'), role='student', label='B:completed-write-denied')
    call('PUT', '/v1/mock/attempts/{attempt}/annotations', dict(annotations=['reference-compatible post-submit note']), role='student', label='B:approved-annotation-exception')
    remember('timed', call('POST', '/v1/mock/exams/{full}/start', {'flow': 'full_test'}, role='student', label='B:full-test'))
    call('POST', '/v1/mock/attempts/{timed}/answer', dict(questionId='{reading_q}', response='A'), role='student', label='B:section-locked')
    call('POST', '/v1/mock/attempts/{timed}/advance', {}, role='student', label='B:advance')
    call('POST', '/v1/mock/attempts/{timed}/answer', dict(questionId='{reading_q}', response='A'), role='student', label='B:current-section')
    patch_attempt('timed', 'deadlineAt', '2000-01-01T00:00:00Z')
    patch_attempt('timed', 'overallDeadlineAt', '2000-01-01T00:00:00Z')
    call('POST', '/v1/mock/attempts/{timed}/answer', dict(questionId='{reading_q}', response='late'), role='student', label='B:late-save')
    remember('ielts', call('POST', '/v1/mock/exams', dict(type='ielts_academic', title='Original IELTS audio security fixture', profile='practice', isDemo=True)), 'id')
    remember('ielts_section', call('POST', '/v1/mock/exams/{ielts}/sections', dict(skill='listening')), 'id')
    remember('ielts_group', call('POST', '/v1/mock/sections/{ielts_section}/groups', dict(title='Original listening group', audioDurationSec=30)), 'id')
    call('POST', '/v1/mock/groups/{ielts_group}/questions', dict(questions=[dict(number=1, type='short_answer', prompt='Original question', correctAnswers=['original'])]))
    call('POST', '/v1/mock/groups/{ielts_group}/media', files={'audio': ('ielts.mp3', b'ID3original-synthetic-fixture', 'audio/mpeg')})
    remember('ielts_attempt', call('POST', '/v1/mock/exams/{ielts}/start', dict(mode='timed'), role='student', label='B:ielts-timed-start'))
    patch_attempt('ielts_attempt', 'deadlineAt', '2000-01-01T00:00:00Z')
    patch_attempt('ielts_attempt', 'overallDeadlineAt', '2000-01-01T00:00:00Z')
    call('GET', '/v1/mock/groups/{ielts_group}/audio', role='student', label='B:approved-security:ielts-omitted-attempt-cannot-bypass-expiry')
    deviation = results[-1]
    if deviation.get('django', {}).get('status') != 400 or deviation.get('nest', {}).get('status') != 200:
        raise AssertionError('Expected approved media difference: ' + str({key: deviation.get(key) for key in ('django', 'nest')}))
    deviation['approvedSecurityDifference'] = 'User explicitly requested attempt-bound media access. Nest already guards timed Multilevel omission, but IELTS omission streams after expiry. The raw mismatch is retained, not normalized.'
    # Real JWT role checks for every implemented lifecycle endpoint.
    paths = [('POST', '/v1/mock/exams/{full}/start', {}),
        ('GET', '/v1/mock/attempts/mine', None), ('GET', '/v1/mock/attempts/{attempt}', None),
        ('POST', '/v1/mock/attempts/{attempt}/answer', dict(questionId='{reading_q}', response='A')),
        ('POST', '/v1/mock/attempts/{attempt}/answers', dict(answers=[dict(questionId='{reading_q}', response='A')])),
        ('PUT', '/v1/mock/attempts/{attempt}/annotations', {}),
        ('POST', '/v1/mock/attempts/{attempt}/advance', {}),
        ('POST', '/v1/mock/attempts/{attempt}/flag-cheat', dict(event='blur')),
        ('POST', '/v1/mock/attempts/{attempt}/listening/{listening_g}/prepare', {}),
        ('POST', '/v1/mock/attempts/{attempt}/listening/{listening_g}/play', {}),
        ('POST', '/v1/mock/attempts/{attempt}/speaking/{speaking_q}/start', {}),
        ('GET', '/v1/mock/attempts/{attempt}/answers/{speaking_q}/audio', None),
        ('POST', '/v1/mock/attempts/{attempt}/speaking/{speaking_q}', {})]
    for method, path, payload in paths:
        for role in (None, 'teacher', 'admin', 'super_admin'):
            call(method, path, payload, role=role, label='B:security:'+str(role))
