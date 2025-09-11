import { promises as fs } from 'fs';
import zlib from 'zlib';
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
                content = zlib.inflateSync(data);
        }
        catch { /* ignore inflate errors */ }
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