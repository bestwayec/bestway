FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 DJANGO_SETTINGS_MODULE=config.settings.production
WORKDIR /app
COPY requirements/ ./requirements/
RUN pip install --no-cache-dir -r requirements/prod.txt \
    && groupadd --gid 1001 bestway \
    && useradd --uid 1001 --gid bestway --no-create-home bestway
COPY --chown=bestway:bestway apps/ ./apps/
COPY --chown=bestway:bestway common/ ./common/
COPY --chown=bestway:bestway config/ ./config/
COPY --chown=bestway:bestway manage.py ./
RUN mkdir -p /app/storage && chown bestway:bestway /app/storage \
    && chmod 755 /app/config/docker-entrypoint.sh
USER bestway
EXPOSE 8000
ENTRYPOINT ["/bin/sh", "/app/config/docker-entrypoint.sh"]
CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "2", "--threads", "2", "--timeout", "120", "--access-logfile", "-", "--error-logfile", "-"]
