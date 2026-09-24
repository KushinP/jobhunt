/**
 * Minimal .docx text extraction: a .docx is a ZIP whose `word/document.xml` holds the
 * body. Implemented here rather than pulling in a ZIP library because Workers already
 * provide DecompressionStream, and the tailoring step and interview claim audit both need
 * the master's text, not just its bytes.
 *
 * Reads the central directory rather than scanning local headers, because local headers
 * can carry zeroed sizes when the archive was written as a stream.
 */

const EOCD_SIG = 0x06054b50;
const CD_SIG = 0x02014b50;

export interface DocxText {
  ok: boolean;
  text: string;
  reason?: string;
  paragraphs: number;
}

export async function extractDocxText(bytes: Uint8Array): Promise<DocxText> {
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const eocd = findEocd(view, bytes.byteLength);
    if (eocd < 0) return { ok: false, text: '', paragraphs: 0, reason: 'not a zip archive' };

    const entryCount = view.getUint16(eocd + 10, true);
    let offset = view.getUint32(eocd + 16, true);

    for (let i = 0; i < entryCount; i++) {
      if (view.getUint32(offset, true) !== CD_SIG) break;
      const method = view.getUint16(offset + 10, true);
      const compressedSize = view.getUint32(offset + 20, true);
      const nameLen = view.getUint16(offset + 28, true);
      const extraLen = view.getUint16(offset + 30, true);
      const commentLen = view.getUint16(offset + 32, true);
      const localOffset = view.getUint32(offset + 42, true);
      const name = new TextDecoder().decode(
        bytes.subarray(offset + 46, offset + 46 + nameLen));

      if (name === 'word/document.xml') {
        const localNameLen = view.getUint16(localOffset + 26, true);
        const localExtraLen = view.getUint16(localOffset + 28, true);
        const dataStart = localOffset + 30 + localNameLen + localExtraLen;
        const raw = bytes.subarray(dataStart, dataStart + compressedSize);
        const xml = method === 0
          ? new TextDecoder().decode(raw)
          : new TextDecoder().decode(await inflateRaw(raw));
        return xmlToText(xml);
      }
      offset += 46 + nameLen + extraLen + commentLen;
    }
    return { ok: false, text: '', paragraphs: 0, reason: 'no word/document.xml in the archive' };
  } catch (e) {
    return { ok: false, text: '', paragraphs: 0, reason: String(e) };
  }
}

function findEocd(view: DataView, length: number): number {
  // the end-of-central-directory record sits in the last 64KB, after an optional comment
  const from = Math.max(0, length - 66_000);
  for (let i = length - 22; i >= from; i--) {
    if (view.getUint32(i, true) === EOCD_SIG) return i;
  }
  return -1;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data]).stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function xmlToText(xml: string): DocxText {
  // paragraph and line breaks become real newlines; tabs inside a run become spaces
  let s = xml
    .replace(/<w:tab\b[^>]*\/?>/g, ' ')
    .replace(/<w:br\b[^>]*\/?>/g, '\n')
    .replace(/<\/w:p>/g, '\n');
  const paragraphs = (xml.match(/<w:p[\s>]/g) ?? []).length;
  s = s.replace(/<[^>]+>/g, '');
  s = s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { ok: s.length > 0, text: s, paragraphs, reason: s.length ? undefined : 'no text found' };
}
