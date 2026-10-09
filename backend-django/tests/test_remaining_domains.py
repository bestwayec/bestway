import os
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch
from django.test import SimpleTestCase
from django.core.files.uploadedfile import SimpleUploadedFile
from common.api.exceptions import ContractAPIException
from apps.core import content_media,user_admin,video_views,videos,legacy_import_parser,telegram_bot,telegram_menu,telegram_delivery


class ContentStorageTests(SimpleTestCase):
    def test_storage_rejects_directory_escape(self):
        with TemporaryDirectory() as directory,patch.dict(os.environ,{'STORAGE_DIR':directory}):
            for key in ('../private','../../private'):
                with self.subTest(key=key),self.assertRaises(ContractAPIException):content_media.storage_path(key)

    def test_image_extension_and_mime_both_required(self):
        for name,mime in [('bad.svg','image/png'),('bad.png','text/html')]:
            with self.subTest(name=name),self.assertRaises(ContractAPIException):
                content_media.save_upload(SimpleUploadedFile(name,b'fixture',mime),'gallery')

    def test_upload_delete_and_directory_initialization(self):
        with TemporaryDirectory() as directory,patch.dict(os.environ,{'STORAGE_DIR':directory}):
            content_media.initialize_storage()
            self.assertTrue(all((Path(directory)/name).is_dir() for name in ('videos','gallery','teachers','thumbnails')))
            key=content_media.save_upload(SimpleUploadedFile('photo.PNG',b'image','image/png'),'teachers')
            self.assertTrue(key.startswith('teachers/'));self.assertTrue(key.endswith('.png'))
            self.assertEqual(content_media.storage_path(key).read_bytes(),b'image')
            content_media.delete_file(key);self.assertFalse(content_media.storage_path(key).exists())
            content_media.delete_file(key)

    def test_safe_links_and_boolean_transform(self):
        self.assertEqual(content_media.validate({'isActive':'1'})['isActive'],False)
        self.assertEqual(content_media.validate({'isActive':'true'})['isActive'],True)
        for value in ('javascript:alert(1)','data:text/html,a','https://bad url'):
            with self.subTest(value=value),self.assertRaises(ContractAPIException):content_media.validate({'link':value})

    def test_teacher_bounds_and_optional_null_update(self):
        for data in ({'experienceYears':81},{'sortOrder':-1},{'name':'x'}):
            with self.subTest(data=data),self.assertRaises(ContractAPIException):content_media.validate(data,True,True)
        self.assertIsNone(content_media.validate({'name':None},True,True)['name'])


class UserDtoTests(SimpleTestCase):
    def test_complete_dto_and_nullable_optional_fields(self):
        base=dict(name='Student',phone='+998901234567',password='long-password',role='student')
        self.assertEqual(user_admin.validate(base),base)
        self.assertEqual(user_admin.validate({'groupId':None,'telegramChatId':None},True),{'groupId':None,'telegramChatId':None})

    def test_invalid_dto_rejected_before_any_database_write(self):
        base=dict(name='Student',phone='+998901234567',password='long-password',role='student')
        for key,value in [('name','x'),('phone','bad'),('password','short'),('role','receptionist'),('groupId',12)]:
            with self.subTest(key=key),self.assertRaises(ContractAPIException):user_admin.validate(dict(base,**{key:value}))


class VideoContractTests(SimpleTestCase):
    def test_token_signature_expiry_and_reference_suffix_behavior(self):
        with patch.dict(os.environ,{'STREAM_TOKEN_SECRET':'test-secret'}),patch.object(videos.time,'time',return_value=1000):
            token=videos.sign('video','student',60)['token']
            self.assertEqual(videos.verify(token+'.ignored'),dict(v='video',u='student',e=1060))
            with self.assertRaises(ContractAPIException):videos.verify(token+'bad')
            with patch.object(videos.time,'time',return_value=1061):
                with self.assertRaises(ContractAPIException) as error:videos.verify(token)
                self.assertEqual(error.exception.contract_code,'STREAM_TOKEN_EXPIRED')

    def test_exact_range_suffix_open_end_clamping_and_errors(self):
        with TemporaryDirectory() as directory,patch.dict(os.environ,{'STORAGE_DIR':directory}),patch.object(videos,'verify',return_value={'v':'v'}),patch.object(videos,'get',return_value=SimpleNamespace(file_key='videos/v.mp4',mime_type='video/mp4')):
            target=Path(directory)/'videos';target.mkdir();(target/'v.mp4').write_bytes(b'0123456789')
            for range,expected in [('bytes=0-3',b'0123'),('bytes=4-',b'456789'),('bytes=-3',b'789'),('bytes=8-999',b'89')]:
                with self.subTest(range=range):
                    response=videos.stream('token',range);self.assertEqual(response.status_code,206);self.assertEqual(b''.join(response.streaming_content),expected)
            for range in ('bytes=-0','bytes=-','bytes=10-11','garbage','bytes=0-1,3-4'):
                with self.subTest(range=range),self.assertRaises(ContractAPIException):videos.stream('token',range)

    def test_video_dto_coercion_and_unsafe_types(self):
        self.assertEqual(video_views.validate({'title':'Video','price':'0','isFreeForApproved':'false'}),{'title':'Video','price':0,'isFreeForApproved':False})
        for price in (-1,'abc',1.5):
            with self.subTest(price=price),self.assertRaises(ContractAPIException):video_views.validate({'title':'Video','price':price})


class LegacyImportTests(SimpleTestCase):
    def test_section_context_options_and_answer_key(self):
        result=legacy_import_parser.parse('[READING]\nPassage: Local text\nInstructions: Choose\n1. Select one\nA) First\nB) Second\nAnswer key:\n1: B')
        self.assertEqual(result['errors'],[]);self.assertEqual(result['questions'][0]['correctAnswer'],'Second')
        self.assertEqual(result['questions'][0]['passageText'],'Local text');self.assertEqual(result['sectionCounts'],{'reading':1})

    def test_duplicate_numbers_answers_and_unknown_keys_are_not_silenced(self):
        result=legacy_import_parser.parse('1. First\n1. Again\nAnswer key:\n1: A\n1: B\n2: C','reading')
        self.assertTrue(any('repeated' in r['message'] for r in result['errors']))
        self.assertEqual(result['warnings'][-1]['message'],'Answer 2 has no matching question and will be ignored.')

    def test_manual_tasks_need_no_fabricated_answer(self):
        result=legacy_import_parser.parse('[WRITING]\n1. Write an essay\n[SPEAKING]\n2. Speak about school')
        self.assertEqual(result['errors'],[]);self.assertEqual([q['type'] for q in result['questions']],['essay','speaking_prompt'])


class TelegramLifecycleTests(SimpleTestCase):
    def test_disabled_lifecycle_has_no_provider_call(self):
        with patch.dict(os.environ,{'TELEGRAM_BOT_TOKEN':''}),patch.object(telegram_delivery,'call') as provider:
            self.assertEqual(telegram_bot.initialize(),'off');provider.assert_not_called()

    def test_webhook_requires_both_url_and_secret_before_registration(self):
        with patch.dict(os.environ,{'TELEGRAM_BOT_TOKEN':'fixture','TELEGRAM_MODE':'webhook','TELEGRAM_WEBHOOK_URL':'https://example.invalid/hook','TELEGRAM_WEBHOOK_SECRET':''}),patch.object(telegram_delivery,'call') as provider:
            self.assertEqual(telegram_bot.initialize(),'webhook');self.assertEqual([call.args[0] for call in provider.call_args_list],['setMyCommands'])

    def test_polling_once_offsets_and_dispatches_updates(self):
        from threading import Event
        with patch.object(telegram_bot,'initialize',return_value='polling'),patch.object(telegram_delivery,'call',return_value=[{'update_id':12}]) as provider,patch.object(telegram_bot,'handle') as handle:
            telegram_bot.run(Event(),once=True);handle.assert_called_once_with({'update_id':12});self.assertEqual(provider.call_args.args[1]['timeout'],30)

    def test_role_menus_are_exact_and_html_is_escaped(self):
        self.assertEqual(telegram_menu.menu_for('teacher')['keyboard'][0],[{'text':'👥 Guruhlarim'},{'text':'✍️ Baholash navbati'}])
        from apps.core.telegram_links import escape
        self.assertEqual(escape('<student&>'),'&lt;student&amp;&gt;')
