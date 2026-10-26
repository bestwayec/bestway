"""Video access, signed stream tokens, manual purchases and protected storage."""
import base64
import hashlib
import hmac
import json
import os
import re
import time
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from django.db import connection
from django.http import FileResponse
from django.utils import timezone

from apps.legacy_schema.models import StudentProfile, User, VideoLesson, VideoPurchase
from common.api.exceptions import ContractAPIException

from .content_media import delete_file, public_url, storage_path
from .system_settings import audit


def fail(code,message,status=400):raise ContractAPIException(code,message,status)
def b64(raw):return base64.urlsafe_b64encode(raw).decode().rstrip('=')
def signature(payload):
    secret=os.environ.get('STREAM_TOKEN_SECRET')
    if not secret:raise RuntimeError('STREAM_TOKEN_SECRET is required')
    return b64(hmac.new(secret.encode(),payload.encode(),hashlib.sha256).digest())


def sign(video_id,user_id,ttl=3600):
    exp=int(time.time())+ttl
    payload=b64(json.dumps(dict(v=video_id,u=user_id,e=exp),separators=(',',':'),ensure_ascii=False).encode())
    return dict(token=payload+'.'+signature(payload),expiresAt=datetime.fromtimestamp(exp,UTC))


def verify(token):
    parts=token.split('.')
    if len(parts)<2 or not parts[0] or not parts[1] or not hmac.compare_digest(parts[1].encode(),signature(parts[0]).encode()):fail('STREAM_TOKEN_INVALID','Stream havolasi yaroqsiz',403)
    try:data=json.loads(base64.urlsafe_b64decode(parts[0]+'='*(-len(parts[0])%4)))
    except (ValueError,UnicodeError):fail('STREAM_TOKEN_INVALID','Stream havolasi yaroqsiz',403)
    # Source intentionally ignores any token suffix after the first signature.
    exp=data.get('e')
    try:expired=not exp or float(exp)*1000<time.time()*1000
    except (TypeError,ValueError):expired=False
    if expired:fail('STREAM_TOKEN_EXPIRED','Stream havolasi muddati tugagan — sahifani yangilang',403)
    return data


def get(identifier):
    row=VideoLesson.objects.filter(id=identifier).first()
    if row is None:
        try:
            from apps.core.models import Lesson
            lesson = Lesson.objects.filter(id=identifier).first()
            if lesson:
                return VideoLesson(
                    id=str(lesson.id),
                    title=lesson.title,
                    description=lesson.description,
                    price=0,
                    is_free_for_approved=True,
                    file_key=lesson.video_file or "",
                    mime_type="video/mp4",
                    thumbnail_key=None,
                )
        except Exception:
            pass
        fail('VIDEO_NOT_FOUND','Video topilmadi',404)
    return row


def access(actor,video,status=None):
    if actor.role in ('teacher','admin','super_admin') or video.price==0:return 'granted'
    approved=StudentProfile.objects.filter(user_id=actor.id,is_approved=True).exists()
    if approved and video.is_free_for_approved:return 'granted'
    return 'granted' if status=='purchased' else 'pending_confirmation' if status=='pending_confirmation' else 'locked'


def shape(row):
    return dict(id=row.id,title=row.title,description=row.description,price=row.price,isFreeForApproved=row.is_free_for_approved,
        thumbnailUrl=f'{public_url()}/v1/videos/{row.id}/thumbnail' if row.thumbnail_key else None,createdAt=row.created_at)


def format_duration(seconds):
    if not seconds:
        return "00:00"
    m = int(seconds) // 60
    s = int(seconds) % 60
    return f"{m:02d}:{s:02d}"


def listing(actor=None):
    from apps.core.models import Lesson, UserLessonProgress
    purchases=dict(VideoPurchase.objects.filter(user_id=actor.id).values_list('video_id','status')) if actor else {}
    completed_ids = set()
    if actor and actor.is_authenticated:
        try:
            completed_ids = set(UserLessonProgress.objects.filter(user_id=actor.id, is_completed=True).values_list('lesson_id', flat=True))
        except Exception:
            pass

    result=[]
    # 1. LMS Video Lessons
    try:
        lessons = Lesson.objects.select_related("course").order_by("order_index", "created_at")
        video_lessons = {vl.id: vl for vl in VideoLesson.objects.all()}
        for idx, l in enumerate(lessons, start=1):
            vl = video_lessons.get(str(l.id))
            thumb_url = f"{public_url()}/v1/videos/{l.id}/thumbnail" if (vl and vl.thumbnail_key) else (l.course.thumbnail_url if l.course else None)
            is_completed = l.id in completed_ids
            deck = l.quiz_decks.filter(is_lesson_tied=True).first()
            item = {
                "id": str(l.id),
                "title": l.title,
                "description": l.description or (l.course.title if l.course else None),
                "price": 0,
                "isFreeForApproved": True,
                "thumbnailUrl": thumb_url,
                "createdAt": l.created_at.isoformat() if l.created_at else timezone.now().isoformat(),
                "access": "granted",
                "durationSeconds": l.duration or 0,
                "durationFormatted": format_duration(l.duration),
                "xpReward": l.xp_reward or 50,
                "courseTitle": l.course.title if l.course else "English Grammar Foundation",
                "isCompleted": is_completed,
                "isUnlocked": idx == 1 or is_completed,
                "hasQuiz": deck is not None,
                "bamboozleDeckId": str(deck.id) if deck else None,
                "streamUrl": f"{public_url()}/v1/lessons/{l.id}/stream",
            }
            result.append(item)
    except Exception:
        pass

    # 2. Legacy VideoLesson items
    existing_ids = {r["id"] for r in result}
    for row in VideoLesson.objects.order_by('-created_at'):
        if str(row.id) in existing_ids:
            continue
        value=shape(row)
        if actor:value['access']=access(actor,row,purchases.get(row.id))
        result.append(value)
    return result


def create(actor,data,keys,file):
    if not keys.get('file'):fail('FILE_REQUIRED','Video fayl yuklanmadi (maydon nomi: "file")')
    row=VideoLesson.objects.create(id=str(uuid4()),title=data['title'],description=data.get('description'),price=data['price'],
        is_free_for_approved=data.get('isFreeForApproved',True),file_key=keys['file'],mime_type=file.content_type,
        thumbnail_key=keys.get('thumbnail'),created_at=timezone.now())
    audit(actor,'video.create','videoLesson',row.id,new=dict(title=row.title,price=row.price))
    return shape(row)


def update(actor,identifier,data):
    old=get(identifier)
    values={('is_free_for_approved' if key=='isFreeForApproved' else key):value for key,value in data.items()}
    VideoLesson.objects.filter(id=identifier).update(**values)
    row=get(identifier);audit(actor,'video.update','videoLesson',identifier,old=dict(title=old.title,price=old.price),new=dict(title=row.title,price=row.price))
    return shape(row)


def remove(actor,identifier):
    row=get(identifier)
    # Database owns the Prisma cascade; unmanaged ORM relation deletion must not
    # invent cascades/queries against unrelated history tables.
    with connection.cursor() as cursor:cursor.execute('DELETE FROM "VideoLesson" WHERE id=%s',[identifier])
    delete_file(row.file_key);delete_file(row.thumbnail_key)
    audit(actor,'video.delete','videoLesson',identifier,old=dict(title=row.title))
    return dict(deleted=True)


def stream_url(actor,identifier):
    try:
        from apps.core.models import Lesson
        lesson = Lesson.objects.filter(id=identifier).first()
        if lesson:
            return dict(url=f'{public_url()}/v1/lessons/{lesson.id}/stream', expiresAt=datetime.now(UTC), lessonId=str(lesson.id))
    except Exception:
        pass
    row=get(identifier);purchase=VideoPurchase.objects.filter(user_id=actor.id,video_id=identifier).first()
    allowed=access(actor,row,purchase.status if purchase else None)
    if allowed!='granted':fail('VIDEO_ACCESS_DENIED',"Xaridingiz admin tasdig'ini kutmoqda" if allowed=='pending_confirmation' else 'Bu video pullik — sotib olish uchun administratsiyaga murojaat qiling',403)
    token=sign(identifier,actor.id,int(os.environ.get('STREAM_URL_TTL_SECONDS','3600')))
    return dict(url=f'{public_url()}/v1/videos/stream?token={token["token"]}',expiresAt=token['expiresAt'])


def stream(token,range_header=None):
    row=get(verify(token).get('v'));path=storage_path(row.file_key)
    if not path.is_file():fail('FILE_NOT_FOUND','Video fayl topilmadi',404)
    size=path.stat().st_size;mime=row.mime_type or 'video/mp4'
    if range_header:
        match=re.fullmatch(r'bytes=([0-9]*)-([0-9]*)',range_header.strip())
        if not match or not any(match.groups()) or (not match[1] and int(match[2])<=0):fail('INVALID_RANGE',"Range so'rovi yaroqsiz",416)
        if not match[1]:start=max(0,size-int(match[2]));end=size-1
        else:start=int(match[1]);end=min(int(match[2]) if match[2] else size-1,size-1)
        if start>end or start>=size:fail('RANGE_NOT_SATISFIABLE','Range diapazoni mavjud emas',416)
        from django.http import StreamingHttpResponse
        def chunks():
            with path.open('rb') as source:
                source.seek(start);left=end-start+1
                while left:
                    value=source.read(min(left,65536))
                    if not value:break
                    left-=len(value);yield value
        response=StreamingHttpResponse(chunks(),status=206,content_type=mime)
        response['Content-Range']=f'bytes {start}-{end}/{size}';response['Content-Length']=end-start+1
    else:response=FileResponse(path.open('rb'),content_type=mime);response['Content-Length']=size
    response['Accept-Ranges']='bytes';return response


def thumbnail(identifier):
    row=get(identifier);key=row.thumbnail_key
    if not key:fail('FILE_NOT_FOUND','Muqova topilmadi',404)
    path=storage_path(key)
    if not path.is_file():
        alt_key = key.replace("thumbnails/", "media/thumbnails/") if "thumbnails/" in key else f"thumbnails/{key}"
        try:
            alt_path = storage_path(alt_key)
            if alt_path.is_file():path = alt_path
        except Exception:pass
    if not path.is_file():fail('FILE_NOT_FOUND','Muqova topilmadi',404)
    mime={'.png':'image/png','.webp':'image/webp','.gif':'image/gif'}.get(path.suffix.lower(),'image/jpeg')
    response=FileResponse(path.open('rb'),content_type=mime);response['Cache-Control']='public, max-age=86400';return response


def purchase(actor,identifier):
    video=get(identifier);row=VideoPurchase.objects.filter(user_id=actor.id,video_id=identifier).first()
    allowed=access(actor,video,row.status if row else None)
    if allowed=='granted':fail('VIDEO_ALREADY_ACCESSIBLE','Bu video siz uchun allaqachon ochiq')
    if allowed!='pending_confirmation':
        with connection.cursor() as cursor:
            cursor.execute('''INSERT INTO "VideoPurchase" (id,"userId","videoId",status,method,"createdAt","updatedAt") VALUES (%s,%s,%s,'pending_confirmation','manual',%s,%s)
                ON CONFLICT ("userId","videoId") DO UPDATE SET status=CASE WHEN "VideoPurchase".status='purchased' THEN "VideoPurchase".status ELSE EXCLUDED.status END,"updatedAt"=EXCLUDED."updatedAt"''',[str(uuid4()),actor.id,identifier,timezone.now(),timezone.now()])
    return dict(status='pending_confirmation')


def confirm(actor,identifier,user_id):
    get(identifier)
    if not User.objects.filter(id=user_id).exists():fail('USER_NOT_FOUND','Foydalanuvchi topilmadi',404)
    with connection.cursor() as cursor:
        cursor.execute('''INSERT INTO "VideoPurchase" (id,"userId","videoId",status,method,"confirmedById","createdAt","updatedAt") VALUES (%s,%s,%s,'purchased','manual',%s,%s,%s)
            ON CONFLICT ("userId","videoId") DO UPDATE SET status=EXCLUDED.status,"confirmedById"=EXCLUDED."confirmedById","updatedAt"=EXCLUDED."updatedAt" RETURNING id''',[str(uuid4()),user_id,identifier,actor.id,timezone.now(),timezone.now()]);purchase_id=cursor.fetchone()[0]
    audit(actor,'video.confirm_purchase','videoPurchase',purchase_id,new=dict(videoId=identifier,userId=user_id,status='purchased'))
    return dict(status='purchased')
