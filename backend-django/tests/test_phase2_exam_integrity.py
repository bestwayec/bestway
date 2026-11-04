from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest
from django.utils import timezone
from apps.core import mock_attempts as engine
from common.api.exceptions import ContractAPIException


def question(identifier, skill='reading'):
    return SimpleNamespace(id=identifier, group=SimpleNamespace(section=SimpleNamespace(skill=skill)))


def attempt(**values):
    data = dict(status='in_progress', id='attempt', exam_id='exam', flow_mode='partial_practice', current_skill='reading', submitted_sections=[], mode='practice', overall_deadline_at=None, deadline_at=None, section_deadlines={}, specification_version=None, save=Mock())
    data.update(values)
    return SimpleNamespace(**data)


def save(a, items, rows, bulk=True):
    with patch.object(engine.transaction, 'atomic'), patch.object(engine, 'own', return_value=a), patch.object(engine, 'questions', return_value=rows), patch.object(engine, 'assert_program'), patch.object(engine, 'upsert_answer') as upsert:
        result = engine.save_answers(SimpleNamespace(id='owner'), a.id, items, bulk=bulk)
        return result, upsert.call_args_list


def test_bulk_valid_mixed_empty_and_duplicate_requests():
    a=attempt(); items=[dict(questionId='q1',response='one'),dict(questionId='foreign',response='bad')]
    result,calls=save(a,items,[question('q1')]); assert result == {'saved':1}; assert len(calls)==1 and calls[0].args[1]=='q1'
    result,calls=save(a,items,[]); assert result == {'saved':0} and type(result['saved']) is int and not calls
    for _ in range(2):
        result,calls=save(a,items[:1],[question('q1')]); assert result=={'saved':1} and len(calls)==1


@pytest.mark.parametrize('skill,submitted', [('writing', []),('listening',['listening']),('reading',['reading'])])
def test_full_test_rejects_future_and_submitted_sections(skill,submitted):
    a=attempt(flow_mode='full_test',submitted_sections=submitted)
    with pytest.raises(ContractAPIException) as exc:
        save(a,[dict(questionId='q',response='x')],[question('q',skill)])
    assert exc.value.contract_code=='SECTION_LOCKED'


def test_full_test_active_section_is_saved():
    result,calls=save(attempt(flow_mode='full_test'),[dict(questionId='q',response='x')],[question('q')]);assert result=={'saved':1} and len(calls)==1


def test_full_test_blocks_both_backwards_and_forwards_but_practice_allows_switch():
    user=SimpleNamespace(id='owner')
    for flow,target,blocked in [('full_test','listening',True),('full_test','writing',True),('partial_practice','writing',False)]:
        a=attempt(flow_mode=flow, media_state={'__practice_scope':{'version':1,'skills':['reading','writing'],'questionIds':['q']}} if flow=='partial_practice' else None)
        with patch.object(engine.transaction,'atomic'),patch.object(engine,'own',return_value=a),patch.object(engine.MockSection.objects,'filter') as sections,patch.object(engine.attempt_signature,'sign',return_value='signature'):
            sections.return_value.first.return_value=SimpleNamespace(skill=target)
            if blocked:
                with pytest.raises(ContractAPIException) as exc:engine.switch_section(user,a.id,target)
                assert exc.value.contract_code=='SECTION_LOCKED'
            else:assert engine.switch_section(user,a.id,target)['currentSkill']==target


def test_deadline_blocks_persistence():
    a=attempt(mode='timed',overall_deadline_at=timezone.now()-timedelta(seconds=1))
    with pytest.raises(ContractAPIException) as exc:save(a,[dict(questionId='q',response='x')],[question('q')])
    assert exc.value.contract_code=='MOCK_TIME_UP'


def test_empty_or_invalid_practice_scope_returns_no_questions_without_query():
    a=attempt(media_state={'__practice_scope':{'version':1,'skills':['writing'],'questionIds':[]}})
    with patch.object(engine.MockQuestion.objects,'filter') as query:
        assert engine.questions(a,['q'])==[];query.assert_not_called()


def test_empty_frozen_scope_does_not_expose_any_section():
    from apps.core.mock_practice import scope_sections
    a=attempt(media_state={'__practice_scope':{'version':1,'skills':['writing'],'questionIds':[]}})
    sections=[{'skill':'writing','groups':[{'questions':[{'id':'q'}]}]}]
    assert scope_sections(a, sections)==[]


def test_section_deadline_blocks_persistence():
    expired = (timezone.now() - timedelta(seconds=1)).isoformat()
    a = attempt(flow_mode='full_test', mode='timed', section_deadlines={'reading': expired})
    with pytest.raises(ContractAPIException) as exc:
        save(a, [dict(questionId='q', response='x')], [question('q')])
    assert exc.value.contract_code == 'MOCK_SECTION_TIME_UP'


def test_practice_switch_rejects_skill_outside_frozen_scope():
    a = attempt(media_state={'__practice_scope': {'version': 1, 'skills': ['reading'], 'questionIds': ['q']}})
    with patch.object(engine.transaction, 'atomic'), patch.object(engine, 'own', return_value=a), patch.object(engine.MockSection.objects, 'filter') as sections:
        sections.return_value.first.return_value = SimpleNamespace(skill='writing')
        with pytest.raises(ContractAPIException) as exc:
            engine.switch_section(SimpleNamespace(id='owner'), a.id, 'writing')
    assert exc.value.contract_code == 'SECTION_LOCKED'
