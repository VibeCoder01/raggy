import { promises as fs } from 'fs';
import zlib from 'zlib';
const MAX_PDF_STREAM_SIZE = 10 * 1024 * 1024;
function bufferIndexOf(buf, search, start = 0) {
    return buf.indexOf(typeof search === 'string' ? Buffer.from(search) : search, start);
}
function decodePdfString(lit) {
    // Remove parentheses and unescape common sequences
    let s = lit;
    if (s.startsWith('(') && s.endsWith(')'))
        s = s.slice(1, -1);
    return s.replace(/\\([nrtbf\\()])/g, (_m, g1) => {
        if (g1 === 'n')
            return '\n';
        if (g1 === 'r')
            return '\r';
        if (g1 === 't')
            return '\t';
        if (g1 === 'b')
            return '\b';
        if (g1 === 'f')
            return '\f';
        return g1;
    });
}
function hexToString(hex) {
    const clean = hex.replace(/[^0-9a-fA-F]/g, '');
    const bytes = Buffer.from(clean.length % 2 ? clean + '0' : clean, 'hex');
    return bytes.toString('utf8');
}
function inflateWithLimit(data, limit) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let total = 0;
        const stream = zlib.createInflate();
        stream.on('data', (chunk) => {
            total += chunk.length;
            if (total > limit) {
                const err = new Error('PDF stream exceeds limit');
                err.code = 'PDF_STREAM_TOO_LARGE';
                stream.destroy(err);
                return;
            }
            chunks.push(chunk);
        });
        stream.on('error', reject);
        stream.on('end', () => resolve(Buffer.concat(chunks)));
        stream.end(data);
    });
}
export async function extractPdfText(filePath) {
    const buf = await fs.readFile(filePath);
    const out = [];
    let pos = 0;
    while (true) {
        const sIdx = bufferIndexOf(buf, 'stream', pos);
        if (sIdx < 0)
            break;
        const eIdx = bufferIndexOf(buf, 'endstream', sIdx);
        if (eIdx < 0)
            break;
        // Find the dictionary before 'stream'
        const dictStart = buf.lastIndexOf(Buffer.from('<<'), sIdx);
        const dictEnd = buf.indexOf(Buffer.from('>>'), dictStart);
        let hasFlate = false;
        if (dictStart >= 0 && dictEnd > dictStart) {
            const dict = buf.slice(dictStart, dictEnd + 2).toString('latin1');
            hasFlate = /\/Filter\s*\/FlateDecode/.test(dict);
        }
        // Stream data starts after newline following 'stream'
        let dataStart = sIdx + 'stream'.length;
        if (buf[dataStart] === 0x0d && buf[dataStart + 1] === 0x0a)
            dataStart += 2; // CRLF
        else if (buf[dataStart] === 0x0a)
            dataStart += 1; // LF
        const data = buf.slice(dataStart, eIdx);
        let content = data;
        try {
            if (hasFlate)
                content = await inflateWithLimit(data, MAX_PDF_STREAM_SIZE);
        }
        catch {
            content = Buffer.alloc(0);
        }
        if (!content || content.length === 0) {
            pos = eIdx + 'endstream'.length;
            continue;
        }
        const text = content.toString('latin1');
        // Extract text between BT ... ET blocks
        const btRe = /BT([\s\S]*?)ET/gm;
        let m;
        while ((m = btRe.exec(text))) {
            const block = m[1];
            // Literal strings in () and hex strings <...>
            const litRe = /\((?:\\.|[^\\])*?\)/g;
            const hexRe = /<([0-9A-Fa-f\s]+)>/g;
            let part = [];
            let lm;
            while ((lm = litRe.exec(block)))
                part.push(decodePdfString(lm[0]));
            let hm;
            while ((hm = hexRe.exec(block)))
                part.push(hexToString(hm[1]));
            if (part.length)
                out.push(part.join(' '));
        }
        pos = eIdx + 'endstream'.length;
    }
    return out.join('\n').trim();
}
//# sourceMappingURL=pdf.js.map
