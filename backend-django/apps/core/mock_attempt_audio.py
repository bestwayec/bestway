"""Reference Range response for authorized student recorded audio."""
import re
from django.http import HttpResponse, StreamingHttpResponse


def stream_audio(request, path):
    size = path.stat().st_size
    content_type = {'.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.mp4': 'audio/mp4',
        '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.aac': 'audio/aac', '.webm': 'audio/webm'}.get(path.suffix.lower(), 'audio/mpeg')
    start, end, status = 0, size-1, 200
    if request.headers.get('Range'):
        match = re.search(r'bytes=([0-9]*)-([0-9]*)', request.headers['Range'])
        start = int(match[1]) if match and match[1] else 0
        end = int(match[2]) if match and match[2] else size-1
        if start >= size or end >= size or start > end:
            response = HttpResponse(status=416)
            response['Content-Range'] = f'bytes */{size}'
            return response
        status = 206
    def chunks():
        with path.open('rb') as stream:
            stream.seek(start)
            remaining = end-start+1
            while remaining > 0:
                chunk = stream.read(min(64*1024, remaining))
                if not chunk:
                    break
                remaining -= len(chunk)
                yield chunk
    response = StreamingHttpResponse(chunks(), status=status, content_type=content_type)
    response['Content-Length'] = str(end-start+1)
    response['Accept-Ranges'] = 'bytes'
    if status == 206:
        response['Content-Range'] = f'bytes {start}-{end}/{size}'
    return response
