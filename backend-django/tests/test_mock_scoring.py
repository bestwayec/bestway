"""Direct differential calls to the unchanged compiled Nest pure functions."""
import json
from pathlib import Path
import subprocess
from types import SimpleNamespace
from datetime import datetime, timedelta, timezone
import pytest
from apps.core import mock_scoring as score
from apps.core.mock_submissions import assert_complete
from common.api.exceptions import ContractAPIException

ROOT = Path(__file__).resolve().parents[2]


def test_reference_arithmetic_and_answers():
    cases, expected = [], []
    def add(function, args, value, module='mock-scoring'):
        cases.append(dict(module=module,function=function,args=args)); expected.append(value)
    for exam in ('ielts_academic','ielts_general'):
        for skill in ('reading','listening'):
            for maximum in (1,7,35,40):
                for raw in range(maximum+1):
                    add('bandFromRaw',[skill,exam,raw,maximum],score.band_from_raw(skill,exam,raw,maximum))
            add('bandFromRaw',[skill,exam,0,40,None,False],0)
    for value in (0, .25, .75, 6.25,6.625,6.75,9):
        add('roundHalfBand',[value],score.round_half(value))
    for maximum in (1,7,35,40):
        for raw in range(maximum+1):
            add('estimateObjective',[raw,maximum],score.estimate_objective(raw,maximum),'multilevel-specification')
    for skill, table in [('writing',score.WRITING),('speaking',score.SPEAKING)]:
        for index in range(len(table)):
            add('convertExpertScore',[skill,index/2],score.convert_expert(skill,index/2),'multilevel-specification')
    for table in ([[[0,2],[10,4],[10,9]]], [[[0,0],[40,9]]]):
        add('parseBandTable',table,[list(row) for row in score.parse_band_table(table[0])])
    fixtures = [
        ('short_answer','The twenty',['20'],{}), ('short_answer','twenty',['20'],{}),
        ('short_answer','ice–cream',['ice cream'],{}), ('short_answer','colour',['color'],dict(acceptedVariants=['colour'])),
        ('short_answer','a house',['house'],dict(answerRule='ONE_WORD')),
        ('short_answer','house',['HOUSE'],dict(answerRule='ONE_WORD')),
        ('short_answer','two words',['two words'],dict(wordLimit=1)),
        ('true_false_notgiven','TRUE',['YES'],{}), ('yes_no_notgiven','NG',['NOT GIVEN'],{}),
        ('multiple_choice','A',['first'],dict(options=['first','second'])),
        ('multi_select','["A","B"]',['A','B'],dict(options=['first','second'])),
        ('multi_select','A A B',['A','B'],dict(options=['first','second'])),
        ('matching','first',['A'],dict(options=['first','second'])),
        ('matching_headings','ii',['B'],dict(options=['first','second'])),
        ('map_labelling','B',['second'],dict(options=['first','second'])),
        ('sentence_completion','the station',['station'],{}),
        ('note_completion','', ['station'],{}), ('summary_completion','station',['station'],{}),
    ]
    for kind,response,keys,options in fixtures:
        kwargs = {dict(acceptedVariants='accepted_variants',wordLimit='word_limit',answerRule='answer_rule').get(k,k):v for k,v in options.items()}
        add('isAnswerCorrect',[kind,response,keys,options],score.correct(kind,response,keys,**kwargs),'mock-answer')
    for value in ('\ufeffhouse\ufeff','a\u0085house','one\u001ctwo','İSTANBUL','１２','١٢','house²','well–known','a 1','a b','+12.5%',"mother’s"):
        add('normalize',[value],score.normalize(value),'mock-answer')
        for rule in ('ONE_WORD','ONE_WORD_AND_OR_NUMBER'):
            add('isAnswerCorrect',['short_answer',value,[value],dict(answerRule=rule)],score.correct('short_answer',value,[value],answer_rule=rule),'mock-answer')
    script = "const fs=require('fs');const cases=JSON.parse(fs.readFileSync(0,'utf8'));process.stdout.write(JSON.stringify(cases.map(c=>{const m=require('./dist/mock/'+c.module+'.js');const a=c.args;if(c.function==='bandFromRaw'&&a[4]===null)a[4]=undefined;return m[c.function](...a)})));"
    result = subprocess.run(['node','-e',script],cwd=ROOT/'backend',input=json.dumps(cases),text=True,encoding='utf-8',capture_output=True,check=True)
    actual = json.loads(result.stdout)
    assert len(actual)==len(expected)==578
    for case,want,got in zip(cases,expected,actual):
        assert got==want, case


def section(skill, questions, **group):
    return dict(skill=skill,groups=[dict(questions=questions,**group)])


def question(id,kind='short_answer',points=1,**fields):
    return dict(id=id,type=kind,points=points,correctAnswers=['yes'],**fields)


def test_pending_manual_is_not_fabricated():
    sections=[section('reading',[question('r')]),section('writing',[question('w','essay_task1',5)],maxScore=5)]
    result, projection=score.calculate('multilevel',sections,dict(r=dict(response='yes')),versioned=True)
    assert result['status']=='grading'
    assert result['overallScore'] is None
    assert 'writing' not in result['standardScores']
    assert projection=={'r':dict(isCorrect=True,score=1,isGraded=True)}
    assert result['rawScores']['writing']==dict(score=0,max=5)


def test_ielts_task_two_weight_and_full_test_divisor():
    sections=[section('writing',[question('w1','essay_task1',9),question('w2','essay_task2',9)])]
    answers={q:dict(response='original',isGraded=True,score=s) for q,s in [('w1',6),('w2',7.5)]}
    result,_=score.calculate('ielts_academic',sections,answers)
    assert result['sectionBands']==dict(writing=7)
    assert result['overallBand']==7
    assert score.calculate('ielts_academic',sections,answers,full_test=True)[0]['overallBand']==2


def test_matching_duplicate_choices_both_zero():
    sections=[section('reading',[question('a','matching',options=['yes','no']),question('b','matching',options=['yes','no'])],optionsReusable=False)]
    result,projection=score.calculate('multilevel',sections,{q:dict(response='A') for q in ('a','b')})
    assert result['rawScores']['reading']['score']==0
    assert all(p['isCorrect'] is False for p in projection.values())


def test_speaking_holistic_average_rounded_half():
    sections=[section('speaking',[question(str(i),'speaking_task',5) for i in range(3)],maxScore=5)]
    answers={str(i):dict(response='',isGraded=True,score=s) for i,s in enumerate([3,3.5,4])}
    result,_=score.calculate('multilevel',sections,answers,versioned=True)
    assert result['rawScores']['speaking']==dict(score=3.5,max=5)
    assert result['standardScores']['speaking']['estimatedStandardScore']==21


def test_timeout_completeness_and_unreachable_sections():
    now=datetime(2026,10,8,tzinfo=timezone.utc)
    attempt=SimpleNamespace(overall_deadline_at=now,deadline_at=None,section_deadlines={},flow_mode='single_skill',current_skill=None)
    sections=[section('reading',[question('q')])]
    assert_complete(attempt,sections,{},now)
    attempt.overall_deadline_at=now+timedelta(seconds=1)
    with pytest.raises(ContractAPIException) as exc:
        assert_complete(attempt,sections,{},now)
    assert exc.value.contract_code=='MOCK_ATTEMPT_INCOMPLETE'
    attempt.flow_mode='full_test'; attempt.current_skill='listening'
    assert_complete(attempt,sections,{},now)
