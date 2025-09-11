import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { l2Normalize } from './vector.js';
export class BruteIndex {
    baseDir;
    meta = null;
    vectors = null; // flat array length = count*dim
    ids = [];
    recs = new Map();
    constructor(baseDir) {
        this.baseDir = baseDir;
    }
    async available() {
        try {
            await fsp.access(path.join(this.baseDir, 'meta.json'));
            await fsp.access(path.join(this.baseDir, 'vectors.f32'));
            await fsp.access(path.join(this.baseDir, 'ids.txt'));
            await fsp.access(path.join(this.baseDir, 'records.jsonl'));
            return true;
        }
        catch {
            return false;
        }
    }
    async load() {
        const metaPath = path.join(this.baseDir, 'meta.json');
        const idsPath = path.join(this.baseDir, 'ids.txt');
        const vecPath = path.join(this.baseDir, 'vectors.f32');
        const recsPath = path.join(this.baseDir, 'records.jsonl');
        const meta = JSON.parse(await fsp.readFile(metaPath, 'utf8'));
        this.meta = meta;
        // Load vectors into memory
        const buf = await fsp.readFile(vecPath);
        this.vectors = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
        // Load ids
        this.ids = (await fsp.readFile(idsPath, 'utf8')).split('\n').filter(Boolean);
        // Load compact records (id->lite)
        const rl = readline.createInterface({ input: fs.createReadStream(recsPath, { encoding: 'utf8' }) });
        for await (const line of rl) {
            const s = String(line).trim();
            if (!s)
                continue;
            try {
                const r = JSON.parse(s);
                if (r && r.id)
                    this.recs.set(r.id, r);
            }
            catch { }
        }
    }
    getDim() { return this.meta?.dim || 0; }
    getCount() { return this.meta?.count || 0; }
    // Return top-n [index, score] pairs
    query(q, k) {
        if (!this.vectors || !this.meta)
            return [];
        const dim = this.meta.dim | 0;
        const N = (this.vectors.length / dim) | 0;
        const qn = l2Normalize(q);
        const scores = new Array(k).fill(-Infinity);
        const idxs = new Array(k).fill(-1);
        // Dot product since vectors are normalized at write time
        for (let row = 0; row < N; row++) {
            let s = 0;
            const off = row * dim;
            for (let j = 0; j < dim; j++)
                s += qn[j] * this.vectors[off + j];
            // insert into top-k
            if (s > scores[k - 1]) {
                scores[k - 1] = s;
                idxs[k - 1] = row;
                // bubble up
                for (let p = k - 1; p > 0 && scores[p] > scores[p - 1]; p--) {
                    const ts = scores[p - 1];
                    scores[p - 1] = scores[p];
                    scores[p] = ts;
                    const ti = idxs[p - 1];
                    idxs[p - 1] = idxs[p];
                    idxs[p] = ti;
                }
            }
        }
        const out = [];
        for (let i = 0; i < k; i++)
            if (idxs[i] >= 0)
                out.push({ index: idxs[i], score: scores[i] });
        return out;
    }
    getRecordByRow(row) {
        const id = this.ids[row];
        return id ? this.recs.get(id) : undefined;
    }
}
export async function tryLoadLocalIndex(baseDir) {
    const idx = new BruteIndex(baseDir);
    if (!(await idx.available()))
        return null;
    await idx.load();
    return idx;
}
//# sourceMappingURL=index.js.map