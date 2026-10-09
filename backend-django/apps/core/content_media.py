"""Shared disk storage and public gallery/teacher cards (NestJS contracts)."""
import os
import re
from pathlib import Path
from uuid import uuid4
from django.http import FileResponse
from django.utils import timezone
from apps.legacy_schema.models import GalleryImage, Teacher
from common.api.exceptions import ContractAPIException
from .system_settings import audit
from .domain_contracts import invalid
from .game_points_views import js_number


def storage_path(key):
    base = Path(os.environ.get('STORAGE_DIR', './storage')).resolve()
    target = (base / key).resolve()
    if target != base and base not in target.parents:
        raise ContractAPIException('INVALID_FILE_KEY', "Fayl manzili noto'g'ri", 400)
    return target


def initialize_storage():
    for directory in ('videos', 'thumbnails', 'teachers', 'gallery'):
        storage_path(directory).mkdir(parents=True, exist_ok=True)


def delete_file(key):
    if not key: return
    try: storage_path(key).unlink()
    except (OSError, ContractAPIException): pass


def public_url():
    return os.environ.get('PUBLIC_URL', 'http://localhost:'+os.environ.get('PORT','3001')).removesuffix('/')


def save_upload(file, directory, limit=10*1024*1024):
    ext = Path(file.name).suffix.lower()
    image = directory != 'videos'
    extensions = {'.jpg','.jpeg','.png','.webp','.gif'} if image else {'.mp4','.webm','.mov','.m4v','.mkv'}
    message = ("Rasm fayli bo'lishi kerak (jpg, png…)" if directory=='teachers' else
               "Rasm fayli bo'lishi kerak (jpg, png, webp…)" if directory=='gallery' else
               "Muqova rasm fayli bo'lishi kerak (jpg, png, webp)" if image else 'Video fayl yuklang (mp4 va h.k.)')
    if not file.content_type.startswith('image/' if image else 'video/') or ext not in extensions:
        raise ContractAPIException('INVALID_FILE_TYPE', message, 400)
    if file.size > limit: raise ContractAPIException('PAYLOAD_TOO_LARGE', 'File too large', 413)
    key = f'{directory}/{uuid4()}{ext}'
    target = storage_path(key); target.parent.mkdir(parents=True, exist_ok=True)
    with target.open('wb') as output:
        for chunk in file.chunks(): output.write(chunk)
    return key


FIELDS = dict(sortOrder='sort_order', isActive='is_active', experienceYears='experience_years', socialUrl='social_url')


def validate(data, teacher=False, update=False):
    lengths = dict(name=(2,120), specialty=(2,120), achievement=(0,120), bio=(0,2000), socialUrl=(0,300)) if teacher else dict(label=(0,120),link=(0,500),alt=(0,300))
    allowed = {*lengths, 'sortOrder','isActive'} | ({'experienceYears'} if teacher else set())
    for key in data:
        if key not in allowed: invalid(f'property {key} should not exist')
    out = dict(data)
    for key,(minimum,maximum) in lengths.items():
        if key not in data or data[key] is None:
            if teacher and not update and key in ('name','specialty'): invalid(f'{key} must be shorter than or equal to {maximum} characters')
            continue
        value=data[key]
        if key in ('link','socialUrl') and (not isinstance(value,str) or not re.fullmatch(r'(https?://[^\s]+|/[^\s]*)',value)):
            invalid('Havola https:// bilan yoki / bilan boshlanishi kerak')
        if not isinstance(value,str) or len(value)>maximum: invalid(f'{key} must be shorter than or equal to {maximum} characters')
        if len(value)<minimum: invalid(f'{key} must be longer than or equal to {minimum} characters')
    for key in ('sortOrder','experienceYears'):
        if key not in out or out[key] is None: continue
        number=js_number(out[key])
        if key=='experienceYears' and not number<=80: invalid(f'{key} must not be greater than 80')
        if not number>=0: invalid(f'{key} must not be less than 0')
        if not number.is_integer(): invalid(f'{key} must be an integer number')
        out[key]=int(number)
    if 'isActive' in out: out['isActive']=out['isActive'] is True or out['isActive']=='true'
    return out


def shape(row, teacher, admin=False):
    key=row.photo_key if teacher else row.image_key
    stamp=int(row.updated_at.timestamp()*1000)
    url=f'{public_url()}/v1/{"teachers" if teacher else "gallery"}/{row.id}/{"photo" if teacher else "image"}?v={stamp}' if key else None
    if teacher:
        data=dict(id=row.id,name=row.name,specialty=row.specialty,achievement=row.achievement,bio=row.bio,
            experienceYears=row.experience_years,photoUrl=url,socialUrl=row.social_url)
        if admin: data.update(sortOrder=row.sort_order,isActive=row.is_active,createdAt=row.created_at)
    else:
        data=dict(id=row.id,image=url,sortOrder=row.sort_order,isActive=row.is_active,createdAt=row.created_at)
        for name in ('label','link','alt'):
            if getattr(row,name) is not None: data[name]=getattr(row,name)
        if admin: data.update(imageKey=row.image_key,updatedAt=row.updated_at)
    return data


def get_row(identifier, teacher):
    row=(Teacher if teacher else GalleryImage).objects.filter(id=identifier).first()
    if row is None: raise ContractAPIException('TEACHER_NOT_FOUND' if teacher else 'GALLERY_NOT_FOUND', "O'qituvchi topilmadi" if teacher else 'Galereya rasmi topilmadi',404)
    return row


def listing(teacher=False, admin=False):
    rows=(Teacher if teacher else GalleryImage).objects.all().order_by('sort_order','created_at')
    if not admin: rows=rows.filter(is_active=True)
    return [shape(row,teacher,admin) for row in rows]


def mutate(actor, data, teacher=False, identifier=None, file_key=None):
    model=Teacher if teacher else GalleryImage
    old=get_row(identifier,teacher) if identifier else None
    values={}
    strings=('name','specialty','achievement','bio','socialUrl') if teacher else ('label','link','alt')
    for key in strings:
        if key in data:
            # Explicit null on update reaches .trim() in the reference and fails.
            value=data[key].strip() if old else (data[key] or '').strip()
            values[FIELDS.get(key,key)]=value if key in ('name','specialty') else value or None
    for key in ('sortOrder','isActive','experienceYears'):
        if key in data: values[FIELDS[key]]=data[key]
    media_field='photo_key' if teacher else 'image_key'
    if file_key: values[media_field]=file_key
    if old:
        model.objects.filter(id=identifier).update(**values,updated_at=timezone.now())
        row=get_row(identifier,teacher)
        if file_key and getattr(old,media_field)!=file_key: delete_file(getattr(old,media_field))
    else:
        if not teacher and not file_key: raise ContractAPIException('FILE_REQUIRED','Rasm yuklash majburiy',400)
        values.setdefault('sort_order',0);values.setdefault('is_active',True)
        if values['sort_order'] is None: values['sort_order']=0
        values.setdefault(media_field,None)
        row=model.objects.create(id=str(uuid4()),created_at=timezone.now(),updated_at=timezone.now(),**values)
    entity='teacher' if teacher else 'gallery'; label='name' if teacher else 'label'
    before={label:getattr(old,label),'isActive':old.is_active} if old else None
    after={label:getattr(row,label),'isActive':row.is_active} if old else ({'name':row.name,'specialty':row.specialty} if teacher else {'label':row.label,'imageKey':row.image_key})
    audit(actor,f'{entity}.{"update" if old else "create"}',entity,row.id,old=before,new=after)
    return shape(row,teacher,True)


def remove(actor, identifier, teacher=False):
    row=get_row(identifier,teacher);row.delete()
    delete_file(row.photo_key if teacher else row.image_key)
    entity='teacher' if teacher else 'gallery';label='name' if teacher else 'label'
    audit(actor,f'{entity}.delete',entity,identifier,old={label:getattr(row,label)})
    return dict(deleted=True)


def image(identifier, teacher=False):
    row=get_row(identifier,teacher);key=row.photo_key if teacher else row.image_key
    if not key or not storage_path(key).is_file(): raise ContractAPIException('FILE_NOT_FOUND','Rasm topilmadi',404)
    mime={'.png':'image/png','.webp':'image/webp','.gif':'image/gif'}.get(Path(key).suffix.lower(),'image/jpeg')
    response=FileResponse(storage_path(key).open('rb'),content_type=mime)
    response['Cache-Control']='public, max-age=3600'
    return response
