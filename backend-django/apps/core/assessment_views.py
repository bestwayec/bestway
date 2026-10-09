import math
import re
from django.http import HttpResponse,StreamingHttpResponse
from rest_framework.decorators import api_view,permission_classes
from common.auth.permissions import Authenticated,roles
from . import assessment,mock_grading
from .content_media import storage_path
from .domain_contracts import payload,invalid,js_length
from .game_points_views import js_number
from .mock_attempt_views import success

def validate_review(data):
    actions=['ACCEPT','OVERRIDE','EDIT_FEEDBACK','REGRADE','NEEDS_REVIEW']
    if data.get('action') not in actions:invalid('action must be one of the following values: '+', '.join(actions))
    version=js_number(data.get('expectedVersion'))
    if not version>=1:invalid('expectedVersion must not be less than 1')
    if not math.isfinite(version) or version!=int(version):invalid('expectedVersion must be an integer number')
    data['expectedVersion']=int(version)
    reason=data.get('reason')
    if not isinstance(reason,str) or js_length(reason)>2000:invalid('reason must be shorter than or equal to 2000 characters')
    if reason=='':invalid('reason should not be empty')
    if data.get('parts') is not None:
        if not isinstance(data['parts'],list) or len(data['parts'])>8:invalid('parts must contain no more than 8 elements')
        for part in data['parts']:
            if not isinstance(part,dict):invalid('each value in nested property parts must be either object or array')
            for k in part:
                if k not in ('id','rawScore','criteria'):invalid('property '+k+' should not exist')
            identifier=part.get('id')
            if not isinstance(identifier,str) or js_length(identifier)>100:invalid('id must be shorter than or equal to 100 characters')
            if identifier=='':invalid('id should not be empty')
            if part.get('criteria') is not None and not isinstance(part['criteria'],dict):invalid('criteria must be an object')
    if data.get('feedback') is not None and not isinstance(data['feedback'],dict):invalid('feedback must be an object')
    return data

@api_view(['GET'])
@permission_classes([Authenticated])
def attempt(request,attempt_id):return success(assessment.for_attempt(request.user,attempt_id))

@api_view(['POST'])
@permission_classes([roles('teacher','admin','super_admin')])
def review(request,job_id):return success(assessment.review(request.user,job_id,validate_review(payload(request,{'action','expectedVersion','reason','parts','feedback'}))),201)

@api_view(['GET'])
@permission_classes([Authenticated])
def audio(request,job_id,question_id):
    key=assessment.audio(request.user,job_id,question_id);path=storage_path(key);size=path.stat().st_size;start=0;end=size-1;status=200
    mime={'.m4a':'audio/mp4','.mp4':'audio/mp4','.ogg':'audio/ogg','.wav':'audio/wav','.aac':'audio/aac'}.get(path.suffix.lower(),'audio/mpeg')
    if request.headers.get('Range'):
        match=re.search(r'bytes=([0-9]*)-([0-9]*)',request.headers['Range']);start=int(match[1]) if match and match[1] else 0;end=int(match[2]) if match and match[2] else size-1
        if start>=size or end>=size or start>end:
            response=HttpResponse(status=416);response['Content-Range']=f'bytes */{size}';return response
        status=206
    def chunks():
        with path.open('rb') as source:
            source.seek(start);left=end-start+1
            while left>0:
                chunk=source.read(min(left,65536))
                if not chunk:break
                left-=len(chunk);yield chunk
    response=StreamingHttpResponse(chunks(),status=status,content_type=mime);response['Content-Length']=end-start+1;response['Accept-Ranges']='bytes'
    if status==206:response['Content-Range']=f'bytes {start}-{end}/{size}'
    return response

@api_view(['POST'])
@permission_classes([roles('teacher','admin','super_admin')])
def grade(request,attempt_id):
    data=payload(request,{'questionId','score','feedback','rubricScores'})
    if not data.get('questionId'):invalid('questionId should not be empty')
    if not isinstance(data['questionId'],str):invalid('questionId must be a string')
    if data.get('score') is not None:
        value=js_number(data['score'])
        if not value>=0:invalid('score must not be less than 0')
        if not math.isfinite(value):invalid('score must be a number conforming to the specified constraints')
        data['score']=value
    if data.get('feedback') is not None and (not isinstance(data['feedback'],str) or js_length(data['feedback'])>2000):invalid('feedback must be shorter than or equal to 2000 characters')
    if data.get('rubricScores') is not None and not isinstance(data['rubricScores'],dict):invalid('rubricScores must be an object')
    return success(mock_grading.grade(request.user,attempt_id,data),201)
