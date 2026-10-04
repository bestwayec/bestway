import * as fs from 'fs';
import { AppException } from '../common/app.exception';

/** Reject empty files and obvious MIME/extension spoofing before acknowledging
 * a take. This is container recognition, not decoding or an STT integration. */
export function assertSpeakingAudio(file: Pick<Express.Multer.File, 'path' | 'size'>): void {
  if (!file.size) throw new AppException('INVALID_AUDIO', 'The recording is empty', 400);
  const header = Buffer.alloc(16);
  const fd = fs.openSync(file.path, 'r');
  let count: number;
  try { count = fs.readSync(fd, header, 0, header.length, 0); }
  finally { fs.closeSync(fd); }
  const text = (start: number, end: number) => header.toString('ascii', start, end);
  const recognized = count >= 12 && (
    (text(0,4) === 'RIFF' && text(8,12) === 'WAVE') ||
    text(0,4) === 'OggS' || text(4,8) === 'ftyp' ||
    header.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3])) ||
    text(0,3) === 'ID3' || (header[0] === 0xff && (header[1] & 0xe0) === 0xe0)
  );
  if (!recognized) throw new AppException('INVALID_AUDIO', 'The file is not a supported audio recording', 400);
}
