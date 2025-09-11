function splitSentencesRegex(txt) {
    const clean = String(txt || '').replace(/\r\n/g, '\n').replace(/[\t\v\f]+/g, ' ');
    // Simple sentence splitter: split on . ! ? followed by space/newline; keep punctuation
    const parts = [];
    let cur = '';
    for (let i = 0; i < clean.length; i++) {
        const ch = clean[i];
        cur += ch;
        if ((ch === '.' || ch === '!' || ch === '?') && /\s/.test(clean[i + 1] || '')) {
            parts.push(cur.trim());
            cur = '';
        }
    }
    if (cur.trim())
        parts.push(cur.trim());
    // Fallback: if no punctuation found, split by lines
    if (parts.length <= 1)
        return clean.split(/\n+/).map(s => s.trim()).filter(Boolean);
    return parts;
}
function splitSentencesSmart(txt) {
    const clean = String(txt || '').replace(/\r\n/g, '\n').replace(/[\t\v\f]+/g, ' ');
    const abbrev = new Set(['e.g.', 'i.e.', 'etc.', 'Mr.', 'Mrs.', 'Dr.', 'Prof.', 'Inc.', 'Ltd.', 'vs.', 'No.', 'Fig.', 'Eq.', 'Jan.', 'Feb.', 'Mar.', 'Apr.', 'Jun.', 'Jul.', 'Aug.', 'Sep.', 'Sept.', 'Oct.', 'Nov.', 'Dec.']);
    const parts = [];
    let cur = '';
    for (let i = 0; i < clean.length; i++) {
        const ch = clean[i];
        cur += ch;
        if ((ch === '.' || ch === '!' || ch === '?') && /\s/.test(clean[i + 1] || '')) {
            const tail = cur.slice(-6);
            let blocked = false;
            for (const a of abbrev) {
                if (tail.endsWith(a.slice(-Math.min(6, a.length)))) {
                    blocked = true;
                    break;
                }
            }
            if (!blocked) {
                parts.push(cur.trim());
                cur = '';
            }
        }
    }
    if (cur.trim())
        parts.push(cur.trim());
    if (parts.length <= 1)
        return clean.split(/\n+/).map(s => s.trim()).filter(Boolean);
    return parts;
}
export function chunkPlainSentences(text, { maxSent = 6, overlapSent = 2, tokenizer = 'regex' } = {}) {
    const sents = (tokenizer === 'smart' ? splitSentencesSmart : splitSentencesRegex)(text);
    const out = [];
    const step = Math.max(1, maxSent - overlapSent);
    for (let i = 0; i < sents.length; i += step) {
        const win = sents.slice(i, i + maxSent).join(' ');
        if (win.trim())
            out.push({ text: win });
    }
    return out;
}
export function chunkMarkdown(md, { maxSent = 6, overlapSent = 2, tokenizer = 'regex' } = {}) {
    const lines = String(md || '').replace(/\r\n/g, '\n').split('\n');
    const blocks = [];
    let sectionPath = [];
    for (const raw of lines) {
        const line = raw.trimEnd();
        const m = /^(#{1,6})\s+(.*)$/.exec(line);
        if (m) {
            const depth = m[1].length;
            const title = m[2].trim();
            sectionPath = sectionPath.slice(0, depth - 1).concat([title]);
            continue;
        }
        if (!line)
            continue;
        // Accumulate paragraphs (keep simple: one line = one block)
        blocks.push({ heading: sectionPath[sectionPath.length - 1], text: line, sectionPath: [...sectionPath] });
    }
    const out = [];
    for (const b of blocks) {
        const sents = (tokenizer === 'smart' ? splitSentencesSmart : splitSentencesRegex)(b.text);
        const step = Math.max(1, maxSent - overlapSent);
        for (let i = 0; i < sents.length; i += step) {
            const win = sents.slice(i, i + maxSent).join(' ');
            if (win.trim())
                out.push({ text: win, meta: { heading: b.heading, sectionPath: b.sectionPath } });
        }
    }
    return out;
}
export function chunkPdfSentences(text, { maxSent = 6, overlapSent = 2, tokenizer = 'regex' } = {}) {
    // Try to split on form feed as page breaks; fallback to whole text
    const pages = String(text || '').split('\f');
    const out = [];
    for (let p = 0; p < pages.length; p++) {
        const sents = (tokenizer === 'smart' ? splitSentencesSmart : splitSentencesRegex)(pages[p]);
        const step = Math.max(1, maxSent - overlapSent);
        for (let i = 0; i < sents.length; i += step) {
            const win = sents.slice(i, i + maxSent).join(' ');
            if (win.trim())
                out.push({ text: win, page: p + 1 });
        }
    }
    return out;
}
//# sourceMappingURL=chunker.js.map