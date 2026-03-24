import { Injectable, Logger } from '@nestjs/common';
import * as pdfParse from 'pdf-parse';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const mammoth = require('mammoth');

const MIME_PDF = 'application/pdf';
const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MIME_DOC = 'application/msword';

@Injectable()
export class ResumeParserService {
  private readonly logger = new Logger(ResumeParserService.name);

  async extractText(buffer: Buffer, mimeType: string): Promise<string> {
    switch (mimeType) {
      case MIME_PDF:
        return this.extractFromPdf(buffer);
      case MIME_DOCX:
      case MIME_DOC:
        return this.extractFromWord(buffer);
      default:
        // Unknown type — attempt PDF first, then Word as fallback
        this.logger.warn(`Unknown MIME type '${mimeType}', attempting auto-detect`);
        return this.autoExtract(buffer);
    }
  }

  private async extractFromPdf(buffer: Buffer): Promise<string> {
    try {
      const data = await pdfParse(buffer);
      const text = data.text?.trim();
      if (!text) throw new Error('PDF contains no extractable text');
      this.logger.debug(`PDF extraction: ${text.length} chars`);
      return text;
    } catch (err) {
      this.logger.error('PDF text extraction failed', err);
      throw new Error(`PDF extraction error: ${err.message}`);
    }
  }

  private async extractFromWord(buffer: Buffer): Promise<string> {
    try {
      // mammoth handles both .docx and legacy .doc formats
      const result = await mammoth.extractRawText({ buffer });
      const text = result.value?.trim();
      if (!text) throw new Error('Word document contains no extractable text');
      if (result.messages?.length) {
        this.logger.warn(`Word extraction warnings: ${result.messages.map((m) => m.message).join('; ')}`);
      }
      this.logger.debug(`Word extraction: ${text.length} chars`);
      return text;
    } catch (err) {
      this.logger.error('Word text extraction failed', err);
      throw new Error(`Word extraction error: ${err.message}`);
    }
  }

  private async autoExtract(buffer: Buffer): Promise<string> {
    // Detect by magic bytes
    const header = buffer.slice(0, 4).toString('hex');
    if (header === '25504446') {
      // %PDF
      return this.extractFromPdf(buffer);
    }
    if (header === '504b0304') {
      // PK (ZIP = DOCX)
      return this.extractFromWord(buffer);
    }
    throw new Error(`Unsupported file format (magic: ${header}). Only PDF, DOCX, and DOC are supported.`);
  }
}
