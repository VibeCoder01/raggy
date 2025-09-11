export function cosineSim(a, b) {
    let dot = 0, na = 0, nb = 0;
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    return dot / ((Math.sqrt(na) * Math.sqrt(nb)) || 1);
}
export function l2Normalize(v) {
    let n2 = 0;
    for (let i = 0; i < v.length; i++)
        n2 += v[i] * v[i];
    const n = Math.sqrt(n2) || 1;
    if (Math.abs(n - 1) < 1e-12)
        return v.slice();
    const out = new Array(v.length);
    for (let i = 0; i < v.length; i++)
        out[i] = v[i] / n;
    return out;
}
export function dot(a, b) {
    let s = 0;
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++)
        s += a[i] * b[i];
    return s;
}
//# sourceMappingURL=vector.js.map