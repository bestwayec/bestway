"""Free CPU speech recognition, isolated so native inference can be timed out.

No audio leaves this process/container. Only an explicit operator warmup may
download the public model; normal jobs load the previously cached files offline.
"""
import atexit
import math
import multiprocessing
import os
import re
from numbers import Real
from pathlib import Path
from threading import Lock

from .assessment_results import ProviderError

PROVIDER='faster-whisper-local'
SAMPLE_RATE=16000
MAX_BYTES=25*1024*1024
_lock=Lock()
_process=None
_pipe=None
_signature=None


def integer(name,default,minimum,maximum):
    try:value=int(os.environ.get(name,str(default)))
    except (TypeError,ValueError):raise ProviderError('STT_LOCAL_CONFIG_INVALID') from None
    if not minimum<=value<=maximum:raise ProviderError('STT_LOCAL_CONFIG_INVALID')
    return value


def configuration():
    model=os.environ.get('STT_MODEL') or 'small.en'
    if model not in ('tiny.en','base.en','small.en'):raise ProviderError('STT_LOCAL_CONFIG_INVALID')
    return dict(model=model,cache=str(Path(os.environ.get('STT_LOCAL_MODEL_DIR') or '/app/model-cache')),
        threads=integer('STT_LOCAL_CPU_THREADS',1,1,2),beam=integer('STT_LOCAL_BEAM_SIZE',1,1,5),
        maxSeconds=integer('STT_LOCAL_MAX_AUDIO_SECONDS',600,1,600),
        timeout=integer('STT_LOCAL_TIMEOUT_SECONDS',300,5,480),lockTimeout=integer('STT_LOCAL_LOCK_TIMEOUT_SECONDS',5,1,30))


def _model(config,allow_download):
    try:
        from faster_whisper import WhisperModel
        return WhisperModel(config['model'],device='cpu',compute_type='int8',cpu_threads=config['threads'],
            num_workers=1,download_root=config['cache'],local_files_only=not allow_download)
    except ImportError:raise ProviderError('STT_LOCAL_DEPENDENCY_UNAVAILABLE') from None
    except Exception:raise ProviderError('STT_LOCAL_MODEL_UNAVAILABLE') from None


def _decode_audio(path,max_seconds):
    """Bound decoded samples during streaming, even for compressed long audio."""
    try:
        import av
        import numpy as np
        resampler=av.audio.resampler.AudioResampler(format='fltp',layout='mono',rate=SAMPLE_RATE)
        chunks=[];count=0
        def collect(frame):
            nonlocal count
            for output in resampler.resample(frame):
                # PyAV can return [None] when a passthrough resampler flushes.
                if output is None:continue
                data=output.to_ndarray().reshape(-1)
                count+=data.size
                if count>SAMPLE_RATE*max_seconds:raise ProviderError('STT_AUDIO_TOO_LONG')
                chunks.append(data)
        # PyAV 19 removed metadata_errors; the supported mode works across versions.
        with av.open(path,mode='r') as source:
            for frame in source.decode(audio=0):
                frame.pts=None
                collect(frame)
            collect(None)
        if not count:raise ProviderError('STT_EMPTY_TRANSCRIPT')
        audio=np.concatenate(chunks).astype(np.float32,copy=False)
        if not np.isfinite(audio).all():raise ProviderError('STT_AUDIO_INVALID')
        if float(np.sqrt(np.mean(np.square(audio))))<.0001:raise ProviderError('STT_NO_SPEECH')
        return audio,count/SAMPLE_RATE
    except ProviderError:raise
    except ImportError:raise ProviderError('STT_LOCAL_DEPENDENCY_UNAVAILABLE') from None
    except Exception:raise ProviderError('STT_AUDIO_INVALID') from None


def finite(value):
    # FasterWhisper alignment also returns NumPy scalar probabilities.
    return isinstance(value,Real) and not isinstance(value,bool) and math.isfinite(value)


def _result(segments,info,duration,model):
    if not finite(getattr(info,'duration_after_vad',None)) or info.duration_after_vad<.2:
        raise ProviderError('STT_NO_SPEECH')
    words=[];texts=[];likelihoods=[];last_start=0
    for segment in segments:
        if len(words)>20000 or len(texts)>1000:raise ProviderError('STT_RESPONSE_INVALID')
        logprob=getattr(segment,'avg_logprob',None);silence=getattr(segment,'no_speech_prob',None)
        ratio=getattr(segment,'compression_ratio',None)
        if not finite(logprob) or not -1<=logprob<=0 or not finite(silence) or not 0<=silence<=.6 or not finite(ratio) or not 0<=ratio<=2.4:
            raise ProviderError('STT_LOW_CONFIDENCE')
        text=getattr(segment,'text',None)
        if not isinstance(text,str) or not text.strip():continue
        source_words=getattr(segment,'words',None)
        if not isinstance(source_words,list) or not source_words:raise ProviderError('STT_RESPONSE_INVALID')
        texts.append(text.strip());likelihoods.append(math.exp(logprob))
        for word in source_words:
            start,end,probability=getattr(word,'start',None),getattr(word,'end',None),getattr(word,'probability',None)
            if not finite(start) or not finite(end) or start<last_start or start<0 or end<start or end>duration+.05 or not finite(probability) or not 0<=probability<=1:
                raise ProviderError('STT_RESPONSE_INVALID')
            token=getattr(word,'word',None)
            if not isinstance(token,str) or not token.strip() or len(token)>1000:raise ProviderError('STT_RESPONSE_INVALID')
            words.append(dict(start=float(start),end=float(end),text=token.strip(),confidence=float(probability)));last_start=start
    text=' '.join(texts)
    if not text or not words or not re.search('[a-zA-Z]',text):raise ProviderError('STT_EMPTY_TRANSCRIPT')
    if len(text)>100000 or len(words)>20000:raise ProviderError('STT_RESPONSE_INVALID')
    confidence=min(sum(word['confidence'] for word in words)/len(words),sum(likelihoods)/len(likelihoods))
    return dict(text=text,segments=words,confidence=confidence,provider=PROVIDER,model=model,
        durationMs=math.floor(duration*1000+.5),pronunciationEvidence='UNAVAILABLE')


def _recognize(model,path,config):
    audio,duration=_decode_audio(path,config['maxSeconds'])
    segments,info=model.transcribe(audio,language='en',task='transcribe',beam_size=config['beam'],best_of=1,
        temperature=0,condition_on_previous_text=False,word_timestamps=True,vad_filter=True,
        vad_parameters=dict(min_speech_duration_ms=250,min_silence_duration_ms=500,speech_pad_ms=200),
        no_speech_threshold=.6,log_prob_threshold=-1,compression_ratio_threshold=2.4,
        hallucination_silence_threshold=1,suppress_blank=True)
    return _result(segments,info,duration,config['model'])


def _serve(pipe,config):
    model=None
    try:
        while True:
            request=pipe.recv()
            if request['action']=='stop':return
            try:
                if model is None:model=_model(config,request.get('allowDownload',False))
                value=dict(provider=PROVIDER,model=config['model'],ready=True) if request['action']=='warmup' else _recognize(model,request['path'],config)
                pipe.send(dict(value=value))
            except ProviderError as error:pipe.send(dict(error=error.code,transient=error.transient))
            except Exception:pipe.send(dict(error='STT_LOCAL_INFERENCE_FAILED',transient=False))
    except (EOFError,BrokenPipeError,OSError):pass
    finally:pipe.close()


def _shutdown():
    global _process,_pipe,_signature
    process,pipe=_process,_pipe
    _process=_pipe=_signature=None
    if pipe:
        try:pipe.close()
        except OSError:pass
    if process and process.pid is not None:
        if process.is_alive():process.terminate()
        process.join(timeout=1)
        if process.is_alive():process.kill();process.join(timeout=1)


def _request(config,request):
    global _process,_pipe,_signature
    if not _lock.acquire(timeout=config['lockTimeout']):raise ProviderError('STT_LOCAL_BUSY',True,False)
    try:
        signature=tuple(sorted(config.items()))
        if _process is None or not _process.is_alive() or signature!=_signature:
            _shutdown()
            context=multiprocessing.get_context('spawn');parent,child=context.Pipe()
            _process=context.Process(target=_serve,args=(child,config),daemon=True);_pipe=parent;_signature=signature
            _process.start();child.close()
        _pipe.send(request)
        if not _pipe.poll(config['timeout']):
            _shutdown();raise ProviderError('STT_LOCAL_TIMEOUT',True,False)
        response=_pipe.recv()
        if 'error' in response:raise ProviderError(response['error'],response.get('transient',False),False)
        return response['value']
    except ProviderError:raise
    except (OSError,EOFError,BrokenPipeError):
        _shutdown();raise ProviderError('STT_LOCAL_PROCESS_FAILED',True,False) from None
    except Exception:
        _shutdown();raise ProviderError('STT_LOCAL_PROCESS_FAILED',True,False) from None
    finally:_lock.release()


def transcribe(path,mime,language='en',duration_ms=None):
    # duration_ms is legacy timer/metadata input. Only decoded samples establish
    # the actual duration returned to the assessment ledger.
    if not isinstance(mime,str) or not re.fullmatch(r'audio/(webm|ogg|wav|mpeg|mp4|x-wav|x-m4a|aac)(;.*)?',mime,re.IGNORECASE) or language!='en':
        raise ProviderError('STT_INPUT_INVALID')
    try:
        path=Path(path)
        if not path.is_file() or not 0<path.stat().st_size<=MAX_BYTES:raise ProviderError('STT_INPUT_INVALID')
    except OSError:raise ProviderError('STT_AUDIO_UNAVAILABLE') from None
    return _request(configuration(),dict(action='transcribe',path=str(path),allowDownload=False))


def warmup(allow_download=False):
    return _request(configuration(),dict(action='warmup',allowDownload=bool(allow_download)))


atexit.register(_shutdown)
