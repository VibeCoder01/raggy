export function splitText(text, opts = {}) {
    const chunkChars = opts.chunkChars ?? 800;
    const overlap = opts.overlap ?? 120;
    const out = [];
    const clean = text.replace(/\r\n/g, '\n');
    for (let i = 0; i < clean.length; i += (chunkChars - overlap)) {
        out.push(clean.slice(i, i + chunkChars));
    }
    return out.filter(Boolean);
}
//# sourceMappingURL=split.js.map