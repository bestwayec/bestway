FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 DJANGO_SETTINGS_MODULE=config.settings.production
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 curl \
    && rm -rf /var/lib/apt/lists/*
COPY requirements/ ./requirements/
RUN pip install --no-cache-dir -r requirements/prod.txt \
    && groupadd --gid 1001 bestway \
    && useradd --uid 1001 --gid bestway --create-home bestway \
    && mkdir -p /home/bestway/.gunicorn \
    && chown -R bestway:bestway /home/bestway
COPY --chown=bestway:bestway apps/ ./apps/
COPY --chown=bestway:bestway common/ ./common/
COPY --chown=bestway:bestway config/ ./config/
COPY --chown=bestway:bestway manage.py ./
RUN mkdir -p /app/storage /app/model-cache/huggingface/xet \
    && chown bestway:bestway /app/storage /app/model-cache /app/model-cache/huggingface /app/model-cache/huggingface/xet \
    && chmod 755 /app/config/docker-entrypoint.sh
ENV HF_HOME=/app/model-cache/huggingface \
    HF_XET_CACHE=/app/model-cache/huggingface/xet \
    HF_HUB_DISABLE_XET=1 \
    HF_HUB_DISABLE_TELEMETRY=1
USER bestway
EXPOSE 8000
ENTRYPOINT ["/bin/sh", "/app/config/docker-entrypoint.sh"]
CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "2", "--threads", "2", "--timeout", "120", "--access-logfile", "-", "--error-logfile", "-"]
