import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import PDFDocument from 'pdfkit';

const SKILL_LABELS: Record<string, string> = {
  listening: 'Listening',
  reading: 'Reading',
  writing: 'Writing',
  speaking: 'Speaking',
};

export interface MockCertificateData {
  studentName: string;
  examTitle: string;
  examType: string;
  level: string | null;
  isIelts: boolean;
  finishedAt: Date;
  attemptId: string;
  sections: Array<{ skill: string; score: number; max: number; band: number | null; standardScore?: number | null }>;
  overallScore?: number | null;
  specificationVersion?: string | null;
  overallBand: number | null;
  cefrLevel: string | null;
}

/** Mock imtihon natija sertifikati (band / CEFR bilan) — pdfkit */
@Injectable()
export class MockCertificateService {
  constructor(private readonly config: ConfigService) {}

  async generate(data: MockCertificateData): Promise<Buffer> {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve) =>
      doc.on('end', () => resolve(Buffer.concat(chunks))),
    );

    const centerName = this.config.get<string>('CENTER_NAME') ?? "O'quv Markazi";
    const pageW = doc.page.width;
    const accent = '#1a4f8b';

    doc.rect(30, 30, pageW - 60, doc.page.height - 60).lineWidth(2).stroke(accent);
    doc.rect(36, 36, pageW - 72, doc.page.height - 72).lineWidth(0.5).stroke(accent);

    doc.moveDown(3);
    doc.font('Helvetica-Bold').fontSize(24).fillColor(accent).text(centerName, { align: 'center' });
    doc.moveDown(0.3);
    doc
      .font('Helvetica')
      .fontSize(13)
      .fillColor('#444')
      .text(data.specificationVersion ? 'ESTIMATED MULTILEVEL RESULT' : 'MOCK EXAM RESULT', { align: 'center', characterSpacing: 2 });

    doc.moveDown(1.6);
    doc.font('Helvetica').fontSize(11).fillColor('#666').text('This is to certify that', { align: 'center' });
    doc.moveDown(0.4);
    doc.font('Helvetica-Bold').fontSize(20).fillColor('#000').text(data.studentName, { align: 'center' });
    doc.moveDown(0.4);
    doc
      .font('Helvetica-Bold')
      .fontSize(13)
      .fillColor(accent)
      .text(
        `${data.examTitle}${data.level ? ` (${data.level})` : ''} — ${data.examType.replace('_', ' ').toUpperCase()}`,
        { align: 'center' },
      );

    // Bo'limlar jadvali
    doc.moveDown(1.8);
    const tableX = 150;
    const colScore = tableX + 170;
    const colBand = tableX + 260;
    let y = doc.y;

    doc.font('Helvetica-Bold').fontSize(11).fillColor('#000');
    doc.text('Section', tableX, y);
    doc.text('Score', colScore, y);
    if (data.isIelts) doc.text('Band', colBand, y);
    else if (data.specificationVersion) doc.text('Estimate /75', colBand, y);
    y += 6;
    doc.moveTo(tableX, y + 10).lineTo(colBand + 60, y + 10).lineWidth(0.5).stroke('#999');
    y += 18;

    doc.font('Helvetica').fontSize(11).fillColor('#222');
    for (const s of data.sections) {
      doc.text(SKILL_LABELS[s.skill] ?? s.skill, tableX, y);
      doc.text(`${s.score} / ${s.max}`, colScore, y);
      if (data.isIelts) doc.text(s.band !== null ? s.band.toFixed(1) : '—', colBand, y);
      else if (data.specificationVersion) doc.text(String(s.standardScore ?? 'Pending'), colBand, y);
      y += 20;
    }
    y += 8;
    doc.moveTo(tableX, y).lineTo(colBand + 60, y).lineWidth(0.5).stroke('#999');

    // Umumiy natija — band yoki CEFR
    doc.moveDown(2.2);
    if (data.isIelts && data.overallBand !== null) {
      doc.font('Helvetica').fontSize(12).fillColor('#666').text('Overall Band Score', { align: 'center' });
      doc.moveDown(0.2);
      doc.font('Helvetica-Bold').fontSize(40).fillColor(accent).text(data.overallBand.toFixed(1), { align: 'center' });
    } else if (data.cefrLevel) {
      doc.font('Helvetica').fontSize(12).fillColor('#666').text(data.specificationVersion ? `Estimated score: ${data.overallScore ?? 'Pending'} /75` : 'CEFR Level', { align: 'center' });
      doc.moveDown(0.2);
      doc.font('Helvetica-Bold').fontSize(40).fillColor(accent).text(data.cefrLevel, { align: 'center' });
    }

    const bottomY = doc.page.height - 110;
    doc
      .font('Helvetica')
      .fontSize(10)
      .fillColor('#444')
      .text(`Date: ${data.finishedAt.toISOString().slice(0, 10)}`, 60, bottomY);
    doc.fontSize(8).fillColor('#888').text(`Certificate ID: ${data.attemptId}`, 60, bottomY + 16);
    doc
      .fontSize(8)
      .fillColor('#888')
      .text(
        'Bu — amaliy (mock) imtihon natijasi. Rasmiy IELTS/Multilevel sertifikati emas.',
        60,
        bottomY + 32,
        { width: pageW - 120 },
      );

    doc.end();
    return done;
  }
}
