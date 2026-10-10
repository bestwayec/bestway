"""Run Stage A regression plus Stage B cases in disposable local schemas."""
import os
import runpy
from pathlib import Path

os.environ['VERIFY_STAGE_B'] = '1'
runpy.run_path(str(Path(__file__).with_name('verify_stage_a_differential.py')), run_name='__main__')
