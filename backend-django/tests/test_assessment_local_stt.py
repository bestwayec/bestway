"""Local STT limits, real evidence projection and cancellable process boundary."""
import math
import os
import sys
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.test import SimpleTestCase

from apps.core import assessment_local_stt as stt
from apps.core.assessment_results import ProviderError


def segment():
    return SimpleNamespace(text='Hello there.',avg_logprob=-.1,no_speech_prob=.01,compression_ratio=1,
        words=[SimpleNamespace(word='Hello',start=.1,end=.5,probability=.9),
            SimpleNamespace(word=' there.',start=.6,end=1,probability=.8)])


class LocalEvidenceTests(SimpleTestCase):
    def test_actual_word_timing_and_probabilities_never_become_pronunciation(self):
        result=stt._result(iter([segment()]),SimpleNamespace(duration_after_vad=1),2,'small.en')
        self.assertEqual(result['text'],'Hello there.')
        self.assertEqual(result['segments'][0],dict(start=.1,end=.5,text='Hello',confidence=.9))
        self.assertAlmostEqual(result['confidence'],.85)
        self.assertEqual(result['durationMs'],2000)
        self.assertEqual(result['pronunciationEvidence'],'UNAVAILABLE')
        self.assertEqual(result['provider'],'faster-whisper-local')

    def test_empty_vad_rejects_a_plausible_hallucinated_text(self):
        with self.assertRaisesRegex(ProviderError,'STT_NO_SPEECH'):
            stt._result([segment()],SimpleNamespace(duration_after_vad=0),2,'small.en')

    def test_no_words_no_transcript_instead_of_fabricated_timestamps(self):
        row=segment();row.words=[]
        with self.assertRaisesRegex(ProviderError,'STT_RESPONSE_INVALID'):
            stt._result([row],SimpleNamespace(duration_after_vad=1),2,'small.en')

    def test_low_likelihood_silence_repetition_and_nonfinite_values_are_review(self):
        for key,value in [('avg_logprob',-1.1),('no_speech_prob',.9),('compression_ratio',3),('avg_logprob',math.nan)]:
            row=segment();setattr(row,key,value)
            with self.subTest(key=key),self.assertRaisesRegex(ProviderError,'STT_LOW_CONFIDENCE'):
                stt._result([row],SimpleNamespace(duration_after_vad=1),2,'small.en')

    def test_word_timestamps_must_fit_actual_audio_and_remain_monotonic(self):
        for change in ('past_end','backwards','probability','bool'):
            row=segment()
            if change=='past_end':row.words[-1].end=3
            elif change=='backwards':row.words[-1].start=0
            elif change=='bool':row.words[-1].probability=True
            else:row.words[-1].probability=1.1
            with self.subTest(change=change),self.assertRaisesRegex(ProviderError,'STT_RESPONSE_INVALID'):
                stt._result([row],SimpleNamespace(duration_after_vad=1),2,'small.en')

    def test_recognizer_uses_vad_word_timing_and_no_previous_prompt(self):
        model=Mock();model.transcribe.return_value=([segment()],SimpleNamespace(duration_after_vad=1))
        config=dict(model='small.en',beam=1,maxSeconds=600)
        waveform=object()
        with patch.object(stt,'_decode_audio',return_value=(waveform,2)):
            result=stt._recognize(model,'local.wav',config)
        self.assertEqual(model.transcribe.call_args.args,(waveform,))
        flags=model.transcribe.call_args.kwargs
        self.assertTrue(flags['vad_filter']);self.assertTrue(flags['word_timestamps'])
        self.assertFalse(flags['condition_on_previous_text'])
        self.assertNotIn('initial_prompt',flags);self.assertEqual(flags['language'],'en')
        self.assertEqual(result['durationMs'],2000)


class LocalInputTests(SimpleTestCase):
    def test_wrong_mime_language_empty_oversize_missing_never_start_model(self):
        with TemporaryDirectory(prefix='bestway-stt-') as directory,patch.object(stt,'_request') as request:
            path=Path(directory)/'audio.wav';path.write_bytes(b'RIFFfixture')
            for mime,language in [('text/html','en'),('audio/wav','uz')]:
                with self.subTest(mime=mime,language=language),self.assertRaisesRegex(ProviderError,'STT_INPUT_INVALID'):
                    stt.transcribe(path,mime,language)
            path.write_bytes(b'')
            with self.assertRaisesRegex(ProviderError,'STT_INPUT_INVALID'):stt.transcribe(path,'audio/wav')
            with path.open('wb') as stream:stream.truncate(stt.MAX_BYTES+1)
            with self.assertRaisesRegex(ProviderError,'STT_INPUT_INVALID'):stt.transcribe(path,'audio/wav')
            with self.assertRaisesRegex(ProviderError,'STT_INPUT_INVALID'):stt.transcribe(Path(directory)/'missing.wav','audio/wav')
            request.assert_not_called()

    def test_request_ignores_timer_duration_and_cannot_download_models(self):
        with TemporaryDirectory(prefix='bestway-stt-') as directory,patch.object(stt,'_request',return_value=dict(durationMs=2000)) as request,patch.dict(os.environ,{},clear=True):
            path=Path(directory)/'audio.webm';path.write_bytes(b'fixture')
            result=stt.transcribe(path,'audio/webm',duration_ms=120000)
        self.assertEqual(result['durationMs'],2000)
        self.assertEqual(request.call_args.args[1],dict(action='transcribe',path=str(path),allowDownload=False))

    def test_explicit_warmup_is_the_only_download_operation(self):
        with patch.object(stt,'_request',return_value=dict(ready=True)) as request,patch.dict(os.environ,{},clear=True):
            stt.warmup();self.assertFalse(request.call_args.args[1]['allowDownload'])
            stt.warmup(allow_download=True);self.assertTrue(request.call_args.args[1]['allowDownload'])

    def test_cpu_model_load_is_lazy_bounded_and_offline(self):
        factory=Mock(return_value='cached-model')
        with patch.dict(sys.modules,{'faster_whisper':SimpleNamespace(WhisperModel=factory)}):
            value=stt._model(dict(model='small.en',threads=1,cache='/cache'),False)
        self.assertEqual(value,'cached-model')
        self.assertEqual(factory.call_args.kwargs,dict(device='cpu',compute_type='int8',cpu_threads=1,num_workers=1,
            download_root='/cache',local_files_only=True))

    def test_absent_dependency_is_an_explicit_manual_review_error(self):
        with patch.dict(sys.modules,{'faster_whisper':None}):
            with self.assertRaisesRegex(ProviderError,'STT_LOCAL_DEPENDENCY_UNAVAILABLE'):
                stt._model(dict(model='small.en',threads=1,cache='/cache'),False)

    def test_models_memory_threads_audio_duration_and_timeouts_have_hard_bounds(self):
        for settings in (dict(STT_MODEL='large-v3'),dict(STT_LOCAL_CPU_THREADS='8'),dict(STT_LOCAL_MAX_AUDIO_SECONDS='601'),dict(STT_LOCAL_TIMEOUT_SECONDS='600')):
            with self.subTest(settings=settings),patch.dict(os.environ,settings,clear=True),self.assertRaisesRegex(ProviderError,'STT_LOCAL_CONFIG_INVALID'):
                stt.configuration()

    def test_decoding_stops_before_a_compressed_file_expands_beyond_duration(self):
        data=Mock();data.reshape.return_value=SimpleNamespace(size=16001)
        output=Mock();output.to_ndarray.return_value=data
        resampler=Mock();resampler.resample.return_value=[output]
        source=Mock();source.__enter__=Mock(return_value=source);source.__exit__=Mock(return_value=False)
        source.decode.return_value=iter([SimpleNamespace(pts=0)])
        av=SimpleNamespace(open=Mock(return_value=source),audio=SimpleNamespace(resampler=SimpleNamespace(AudioResampler=Mock(return_value=resampler))))
        numpy=Mock()
        with patch.dict(sys.modules,dict(av=av,numpy=numpy)):
            with self.assertRaisesRegex(ProviderError,'STT_AUDIO_TOO_LONG'):stt._decode_audio('compressed.ogg',1)
        numpy.concatenate.assert_not_called()

    def test_modern_pyav_open_and_passthrough_flush_decode_valid_audio(self):
        data=Mock(size=8000);data.reshape.return_value=data
        output=Mock();output.to_ndarray.return_value=data
        resampler=Mock();resampler.resample.side_effect=[[output],[None]]
        source=Mock();source.__enter__=Mock(return_value=source);source.__exit__=Mock(return_value=False)
        source.decode.return_value=iter([SimpleNamespace(pts=0)])
        opened=[]
        # Match PyAV 19's strict keyword signature, rather than accepting any kwargs.
        def open_audio(path,mode='r'):
            opened.append((path,mode));return source
        av=SimpleNamespace(open=open_audio,audio=SimpleNamespace(resampler=SimpleNamespace(AudioResampler=Mock(return_value=resampler))))
        numpy=Mock();audio=Mock()
        numpy.concatenate.return_value.astype.return_value=audio
        numpy.isfinite.return_value.all.return_value=True;numpy.sqrt.return_value=.2
        with patch.dict(sys.modules,dict(av=av,numpy=numpy)):
            decoded,duration=stt._decode_audio('valid.webm',600)
        self.assertIs(decoded,audio);self.assertEqual(duration,.5)
        self.assertEqual(opened,[('valid.webm','r')])
        source.decode.assert_called_once_with(audio=0)
        self.assertIsNone(resampler.resample.call_args_list[-1].args[0])
        numpy.concatenate.assert_called_once_with([data])

    def test_empty_passthrough_flush_returns_ungraded_empty_audio(self):
        resampler=Mock();resampler.resample.return_value=[None]
        source=Mock();source.__enter__=Mock(return_value=source);source.__exit__=Mock(return_value=False)
        source.decode.return_value=iter([])
        av=SimpleNamespace(open=Mock(return_value=source),audio=SimpleNamespace(resampler=SimpleNamespace(AudioResampler=Mock(return_value=resampler))))
        numpy=Mock()
        with patch.dict(sys.modules,dict(av=av,numpy=numpy)):
            with self.assertRaisesRegex(ProviderError,'STT_EMPTY_TRANSCRIPT'):
                stt._decode_audio('empty.wav',600)
        numpy.concatenate.assert_not_called()


class LocalProcessTests(SimpleTestCase):
    def config(self):
        return dict(model='small.en',cache='/cache',threads=1,beam=1,maxSeconds=600,timeout=5,lockTimeout=1)

    def test_busy_lock_never_spawns_an_extra_inference_process(self):
        lock=Mock();lock.acquire.return_value=False
        with patch.object(stt,'_lock',lock),patch.object(stt.multiprocessing,'get_context') as context:
            with self.assertRaises(ProviderError) as error:stt._request(self.config(),dict(action='warmup'))
        self.assertEqual(error.exception.code,'STT_LOCAL_BUSY');self.assertFalse(error.exception.uncertain)
        context.assert_not_called();lock.release.assert_not_called()

    def test_timeout_terminates_owned_native_process_and_releases_lock(self):
        process=Mock(pid=123);process.is_alive.return_value=True
        pipe=Mock();pipe.poll.return_value=False;lock=Mock();lock.acquire.return_value=True
        config=self.config()
        with patch.object(stt,'_process',process),patch.object(stt,'_pipe',pipe),\
                patch.object(stt,'_signature',tuple(sorted(config.items()))),patch.object(stt,'_lock',lock):
            with self.assertRaises(ProviderError) as error:stt._request(config,dict(action='warmup'))
        self.assertEqual(error.exception.code,'STT_LOCAL_TIMEOUT')
        self.assertTrue(error.exception.transient);self.assertFalse(error.exception.uncertain)
        process.terminate.assert_called_once();process.kill.assert_called_once()
        pipe.close.assert_called_once();lock.release.assert_called_once()

    def test_successful_requests_reuse_existing_cached_model_process(self):
        process=Mock(pid=123);process.is_alive.return_value=True
        pipe=Mock();pipe.poll.return_value=True;pipe.recv.return_value=dict(value=dict(ready=True))
        config=self.config()
        with patch.object(stt,'_process',process),patch.object(stt,'_pipe',pipe),\
                patch.object(stt,'_signature',tuple(sorted(config.items()))),patch.object(stt.multiprocessing,'get_context') as context:
            self.assertTrue(stt._request(config,dict(action='warmup'))['ready'])
            self.assertTrue(stt._request(config,dict(action='warmup'))['ready'])
        context.assert_not_called();self.assertEqual(pipe.send.call_count,2)

    def test_child_warmup_then_transcription_loads_the_model_once(self):
        pipe=Mock();pipe.recv.side_effect=[dict(action='warmup',allowDownload=True),dict(action='transcribe',path='audio.wav'),dict(action='stop')]
        with patch.object(stt,'_model',return_value='one-model') as model,patch.object(stt,'_recognize',return_value=dict(text='Hello there.')) as recognize:
            stt._serve(pipe,self.config())
        model.assert_called_once_with(self.config(),True)
        recognize.assert_called_once_with('one-model','audio.wav',self.config())
        self.assertEqual(pipe.send.call_count,2);pipe.close.assert_called_once()
