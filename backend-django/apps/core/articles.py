"""Public articles and administrator mutations, preserving raw reference content."""
from uuid import uuid4
from django.db import transaction
from django.utils import timezone
from apps.legacy_schema.models import Article
from common.api.exceptions import ContractAPIException
from .system_settings import audit


def get(article_id, lock=False):
    rows = Article.objects.select_for_update() if lock else Article.objects
    article = rows.filter(id=article_id).first()
    if article is None: raise ContractAPIException('ARTICLE_NOT_FOUND', 'Maqola topilmadi', 404)
    return article


def serialize(article, detail=False):
    data = dict(id=article.id,title=article.title,body=article.body,category=article.category,tags=article.tags,
        authorName=article.author.name if article.author_id else None,createdAt=article.created_at)
    if detail: data['updatedAt'] = article.updated_at
    return data


def list_articles(query):
    rows = Article.objects.select_related('author')
    if query.get('category'): rows = rows.filter(category=query['category'])
    if query.get('tag'): rows = rows.filter(tags__contains=[query['tag']])
    total = rows.count(); offset = (query['page']-1)*query['limit']
    return [serialize(row) for row in rows.order_by('-created_at')[offset:offset+query['limit']]], total


@transaction.atomic
def create(actor, data):
    stamp=timezone.now()
    article=Article.objects.create(id=str(uuid4()),author_id=actor.id,title=data['title'],body=data['body'],
        category=data['category'],tags=data.get('tags') or [],created_at=stamp,updated_at=stamp)
    audit(actor,'article.create','article',article.id,new=dict(title=article.title,category=article.category))
    return serialize(article,True)


@transaction.atomic
def update(actor, article_id, data):
    article=get(article_id,True); old=article.title
    # IsOptional permits null in the DTO, but Prisma rejects this update.
    # Preserve the reference error and do not create an audit for a failed write.
    if any(value is None for value in data.values()):
        raise ContractAPIException('INTERNAL_ERROR','Serverda kutilmagan xatolik yuz berdi',500)
    fields=[]
    for key,value in data.items():
        setattr(article,key,value);fields.append(key)
    if fields:
        article.updated_at=timezone.now();article.save(update_fields=[*fields,'updated_at'])
    audit(actor,'article.update','article',article_id,old=dict(title=old),new=dict(title=data.get('title') if data.get('title') is not None else old))
    return serialize(article,True)


@transaction.atomic
def delete(actor, article_id):
    article=get(article_id,True);title=article.title
    article.delete()
    audit(actor,'article.delete','article',article_id,old=dict(title=title))
    return dict(deleted=True)
