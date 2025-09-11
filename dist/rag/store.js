import { promises as fs } from 'fs';
import * as fsc from 'fs';
import readline from 'readline';
import path from 'path';
import crypto from 'crypto';
import { ensureDir, listFilesRec, readTextFile, statSafe, isProbablyTextPath } from './fs.js';
import { chunkMarkdown, chunkPlainSentences, chunkPdfSentences } from './chunker.js';
import { createEmbedder } from './provider.js';
import { cosineSim, l2Normalize } from './vector.js';
import { tryLoadLocalIndex } from './index.js';
import { extractPdfText } from './pdf.js';
import { env } from '../lib/env.js';
const DATA_DIR = path.join(process.cwd(), 'data');
const EMB_DIR = path.join(DATA_DIR, 'embeddings');
const REGISTRY_PATH = path.join(EMB_DIR, 'registry.json');
const CHUNKS_PATH = path.join(EMB_DIR, 'chunks.jsonl');
const META_PATH = path.join(EMB_DIR, 'meta.json');
// In-memory ingest progress tracker
let currentProgress = { status: 'idle', totalFiles: 0, processedFiles: 0 };
// Simple in-memory cache for query embeddings (LRU-ish by insertion order)
const qCache = new Map();
const Q_CACHE_MAX = 100;
function cacheGet(key) { return qCache.get(key); }
function cacheSet(key, val) {
    if (qCache.has(key))
        qCache.delete(key);
    qCache.set(key, val);
    if (qCache.size > Q_CACHE_MAX) {
        const firstKey = qCache.keys().next().value;
        qCache.delete(firstKey);
    }
}
export function getIngestProgress() {
    return { ...currentProgress };
}
export function markIngestError(message) {
    try {
        currentProgress.status = 'error';
        currentProgress.message = message;
        currentProgress.updatedAt = new Date().toISOString();
    }
    catch { }
}
export function startIngestProgress(message = 'Starting…') {
    try {
        const now = new Date().toISOString();
        currentProgress = {
            status: 'running',
            totalFiles: 0,
            processedFiles: 0,
            startedAt: now,
            updatedAt: now,
            message,
            currentFilePath: undefined,
            currentFileTotalChunks: 0,
            currentFileProcessedChunks: 0,
            currentFileStatus: 'idle',
        };
    }
    catch { }
}
export async function initStore() {
    await ensureDir(EMB_DIR);
    if (!(await statSafe(REGISTRY_PATH)))
        await fs.writeFile(REGISTRY_PATH, '[]', 'utf8');
    if (!(await statSafe(CHUNKS_PATH)))
        await fs.writeFile(CHUNKS_PATH, '', 'utf8');
    if (!(await statSafe(META_PATH))) {
        const meta = { schemaVersion: 1, embeddingModel: env.EMBEDDINGS_MODEL, dim: undefined, normalised: undefined, createdAt: new Date().toISOString() };
        await fs.writeFile(META_PATH, JSON.stringify(meta, null, 2), 'utf8');
    }
}
export async function resetStore() {
    // Remove embeddings directory entirely and recreate an empty store
    try {
        await fs.rm(EMB_DIR, { recursive: true, force: true });
    }
    catch { }
    await ensureDir(EMB_DIR);
    await fs.writeFile(REGISTRY_PATH, '[]', 'utf8');
    await fs.writeFile(CHUNKS_PATH, '', 'utf8');
    await fs.writeFile(META_PATH, JSON.stringify({ schemaVersion: 1, embeddingModel: env.EMBEDDINGS_MODEL, dim: undefined, normalised: undefined, createdAt: new Date().toISOString() }, null, 2), 'utf8');
}
export async function listRegistry() {
    const buf = await fs.readFile(REGISTRY_PATH, 'utf8');
    return JSON.parse(buf);
}
async function writeRegistry(items) {
    await fs.writeFile(REGISTRY_PATH, JSON.stringify(items, null, 2), 'utf8');
}
// Compute sha1 hash of file bytes and return hex + file size
async function contentHashOfFile(filePath) {
    const h = crypto.createHash('sha1');
    const st = await fs.stat(filePath);
    await new Promise((resolve, reject) => {
        const s = fsc.createReadStream(filePath);
        s.on('data', (d) => h.update(d));
        s.on('end', () => resolve());
        s.on('error', reject);
    });
    return { hash: h.digest('hex'), size: st.size };
}
async function readMeta() {
    try {
        const txt = await fs.readFile(META_PATH, 'utf8');
        return JSON.parse(txt);
    }
    catch {
        return { schemaVersion: 1, createdAt: new Date().toISOString() };
    }
}
async function writeMeta(meta) {
    await fs.writeFile(META_PATH, JSON.stringify(meta, null, 2), 'utf8');
}
// Atomically append new lines to a JSONL file by rewriting to a tmp file and renaming
export async function atomicWriteFile(filePath, data) {
    const tmpPath = filePath + '.tmp';
    await fs.writeFile(tmpPath, data);
    await new Promise((resolve, reject) => {
        // @ts-ignore types for fd
        fsc.open(tmpPath, 'r+', (err, fd) => {
            if (err)
                return reject(err);
            fsc.fsync(fd, (err2) => {
                fsc.close(fd, () => (err2 ? reject(err2) : resolve()));
            });
        });
    });
    await fs.rename(tmpPath, filePath);
}
async function atomicAppendLines(filePath, lines) {
    const tmpPath = filePath + '.tmp';
    // Stream existing file (if any) into tmp, then append new lines
    const ws = fsc.createWriteStream(tmpPath, { encoding: 'utf8' });
    await new Promise((resolve, reject) => {
        const rs = fsc.createReadStream(filePath, { encoding: 'utf8' });
        rs.on('error', (err) => {
            if (err && err.code === 'ENOENT') {
                resolve();
            }
            else {
                reject(err);
            }
        });
        rs.pipe(ws, { end: false });
        rs.on('end', resolve);
    }).catch(async (e) => {
        // If original doesn't exist, ensure ws is open before continuing
        if (String(e?.code || '') !== 'ENOENT')
            throw e;
    });
    await new Promise((resolve, reject) => {
        try {
            if (lines.length)
                ws.write(lines.join('\n') + '\n');
            ws.end(resolve);
        }
        catch (e) {
            reject(e);
        }
    });
    // fsync to flush
    await new Promise((resolve, reject) => {
        // @ts-ignore types for fd
        fsc.open(tmpPath, 'r+', (err, fd) => {
            if (err)
                return reject(err);
            fsc.fsync(fd, (err2) => {
                fsc.close(fd, () => (err2 ? reject(err2) : resolve()));
            });
        });
    });
    await fs.rename(tmpPath, filePath);
}
export async function ingestPaths(paths) {
    await initStore();
    const embedder = createEmbedder();
    const registry = await listRegistry();
    let addedDocs = 0, addedChunks = 0;
    const chunkLines = [];
    let validPaths = 0;
    let processedFiles = 0;
    let skippedZeroChunkFiles = 0;
    let skippedNonTextFiles = 0;
    let skippedEmptyEmbeddingChunks = 0;
    let skippedDuplicateChunks = 0;
    const duplicateChunksByFile = {};
    // Set running state immediately so UI doesn't see 'idle'
    currentProgress = {
        status: 'running',
        totalFiles: 0,
        processedFiles: 0,
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        message: 'Enumerating files…',
    };
    // Pre-compute file list for progress bar (best-effort). This may be slow on large trees.
    const allFiles = [];
    for (const p of paths) {
        const st = await statSafe(p);
        if (!st)
            continue;
        const files = st.isDirectory() ? await listFilesRec(p) : [p];
        for (const f of files)
            allFiles.push(f);
    }
    try {
        currentProgress.totalFiles = allFiles.length;
        currentProgress.updatedAt = new Date().toISOString();
        currentProgress.message = allFiles.length ? 'Starting…' : 'No files';
    }
    catch { }
    for (const p of paths) {
        const st = await statSafe(p);
        if (!st)
            continue;
        validPaths++;
        const files = st.isDirectory() ? await listFilesRec(p) : [p];
        for (const file of files) {
            processedFiles++;
            // Handle PDFs specially; skip other non-text files
            const isPdf = file.toLowerCase().endsWith('.pdf');
            if (!isPdf && !isProbablyTextPath(file)) {
                skippedNonTextFiles++;
                try {
                    currentProgress.processedFiles = Math.min(processedFiles, currentProgress.totalFiles || processedFiles);
                    currentProgress.updatedAt = new Date().toISOString();
                }
                catch { }
                continue;
            }
            try {
                currentProgress.message = `Processing ${path.basename(file)}`;
                currentProgress.currentFilePath = file;
                currentProgress.currentFileTotalChunks = 0;
                currentProgress.currentFileProcessedChunks = 0;
                currentProgress.currentFileStatus = 'embedding';
                currentProgress.updatedAt = new Date().toISOString();
            }
            catch { }
            // Compute content hash for stable docId independent of path
            const { hash: contentHash, size } = await contentHashOfFile(file);
            const docId = contentHash;
            const stNow = await fs.stat(file);
            const mtimeMs = stNow.mtimeMs;
            // Remove stale registry item for this exact path if doc content changed
            for (let i = registry.length - 1; i >= 0; i--) {
                const r = registry[i];
                if (r.path === file && r.id !== docId)
                    registry.splice(i, 1);
            }
            const existingById = registry.find((r) => r.id === docId);
            if (existingById) {
                // Content already ingested; update metadata only, avoid duplicate chunks
                existingById.path = file;
                existingById.mtimeMs = mtimeMs;
                existingById.size = size;
                existingById.contentHash = contentHash;
                try {
                    currentProgress.currentFileStatus = 'skipped';
                    currentProgress.updatedAt = new Date().toISOString();
                }
                catch { }
                continue;
            }
            const content = isPdf ? (await extractPdfText(file)) : (await readTextFile(file));
            // Smarter chunking with sentence windows and headings/pages when available
            let richChunks = [];
            const useTok = env.SENT_TOKENIZER === 'smart' ? 'smart' : 'regex';
            if (isPdf) {
                richChunks = chunkPdfSentences(content, { maxSent: 6, overlapSent: 2, tokenizer: useTok });
            }
            else if (file.toLowerCase().endsWith('.md') || file.toLowerCase().endsWith('.markdown')) {
                richChunks = chunkMarkdown(content, { maxSent: 6, overlapSent: 2, tokenizer: useTok }).map(c => ({ text: c.text, heading: c.meta?.heading }));
            }
            else {
                richChunks = chunkPlainSentences(content, { maxSent: 6, overlapSent: 2, tokenizer: useTok });
            }
            // Build initial chunk texts
            let chunks = richChunks.map(c => c.text);
            // Exact-text per-file de-duplication; keep first occurrence
            try {
                const before = chunks.length;
                const seen = new Set();
                const uniqChunks = [];
                const uniqRich = [];
                for (let i = 0; i < chunks.length; i++) {
                    const t = String(chunks[i] || '').trim();
                    if (t && !seen.has(t)) {
                        seen.add(t);
                        uniqChunks.push(chunks[i]);
                        uniqRich.push(richChunks[i]);
                    }
                }
                const dup = Math.max(0, before - uniqChunks.length);
                if (dup > 0) {
                    skippedDuplicateChunks += dup;
                    duplicateChunksByFile[file] = (duplicateChunksByFile[file] || 0) + dup;
                }
                chunks = uniqChunks;
                richChunks = uniqRich;
            }
            catch { }
            // Prepend filename to text used for embeddings to enable name-based retrieval,
            // but keep stored chunk text unchanged for display.
            const fileBase = path.basename(file);
            const embedTexts = chunks.map(t => fileBase ? `filename: ${fileBase}\n${t}` : t);
            try {
                currentProgress.currentFileTotalChunks = chunks.length;
                currentProgress.updatedAt = new Date().toISOString();
            }
            catch { }
            if (chunks.length === 0) {
                skippedZeroChunkFiles++;
                try {
                    currentProgress.currentFileStatus = 'skipped';
                }
                catch { }
                continue;
            }
            registry.push({ id: docId, path: file, addedAt: new Date().toISOString(), mtimeMs, size, contentHash });
            addedDocs++;
            let embeddings = await embedder.embed(embedTexts);
            // Normalize embeddings at write time (unit L2)
            embeddings = embeddings.map((e) => Array.isArray(e) ? l2Normalize(e) : e);
            // Update meta info with dim and normalization
            try {
                const meta = await readMeta();
                if (!meta.dim && Array.isArray(embeddings[0]))
                    meta.dim = embeddings[0].length | 0;
                if (meta.normalised !== true)
                    meta.normalised = true;
                if (!meta.embeddingModel)
                    meta.embeddingModel = env.EMBEDDINGS_MODEL;
                await writeMeta(meta);
            }
            catch { }
            try {
                currentProgress.currentFileStatus = 'writing';
            }
            catch { }
            for (let i = 0; i < chunks.length; i++) {
                const emb = embeddings[i];
                if (!Array.isArray(emb) || emb.length === 0 || !Number.isFinite(emb[0] ?? 0)) {
                    skippedEmptyEmbeddingChunks++;
                    continue;
                }
                const meta = richChunks[i] || {};
                const rec = { id: `${docId}:${i}`, docId, path: file, chunkIndex: i, text: chunks[i], embedding: emb, heading: meta.heading, page: meta.page };
                chunkLines.push(JSON.stringify(rec));
                addedChunks++;
                try {
                    currentProgress.currentFileProcessedChunks = i + 1;
                    currentProgress.updatedAt = new Date().toISOString();
                }
                catch { }
            }
            try {
                currentProgress.currentFileStatus = 'done';
            }
            catch { }
            // Update progress after each file
            try {
                currentProgress.processedFiles = Math.min(processedFiles, currentProgress.totalFiles || processedFiles);
                currentProgress.updatedAt = new Date().toISOString();
            }
            catch { }
        }
    }
    if (chunkLines.length)
        await atomicAppendLines(CHUNKS_PATH, chunkLines);
    await writeRegistry(registry);
    const report = {
        added: addedDocs,
        chunks: addedChunks,
        requestedPaths: paths.length,
        validPaths,
        processedFiles,
        skippedZeroChunkFiles,
        skippedNonTextFiles,
        skippedEmptyEmbeddingChunks,
        skippedDuplicateChunks,
        duplicateChunksByFile: Object.keys(duplicateChunksByFile).length ? duplicateChunksByFile : undefined,
    };
    try {
        currentProgress.status = 'done';
        currentProgress.updatedAt = new Date().toISOString();
        currentProgress.message = `Added ${report.added} doc(s), ${report.chunks} chunk(s).`;
    }
    catch { }
    return report;
}
export async function search(query, k = 5, minScore = 0, opts = {}) {
    await initStore();
    const embedder = createEmbedder();
    const cacheKey = `${env.EMBEDDINGS_PROVIDER}|${env.EMBEDDINGS_MODEL}|${query}`;
    let qEmb0 = cacheGet(cacheKey);
    if (!qEmb0) {
        const [computed] = await embedder.embed([query]);
        qEmb0 = Array.isArray(computed) ? computed : [];
        cacheSet(cacheKey, qEmb0);
    }
    const qEmb = l2Normalize(qEmb0);
    // Try fast local index if present
    try {
        const idx = await tryLoadLocalIndex(path.join(process.cwd(), 'data', 'embeddings', 'index'));
        if (idx) {
            const cand = idx.query(qEmb, Math.max(k * (opts.mmrPool ? Math.ceil(opts.mmrPool / k) : 8), k));
            // Map to SearchResultItems
            const mapped = cand.map(({ index, score }) => {
                const lite = idx.getRecordByRow(index);
                if (!lite)
                    return null;
                return { score, path: lite.path, docId: lite.docId, chunkIndex: lite.chunkIndex, text: lite.text, heading: lite.heading, page: lite.page };
            }).filter(Boolean);
            // Apply MMR and minScore like before
            return await searchMMRFromCandidates(mapped, qEmb, k, minScore, opts);
        }
    }
    catch (e) {
        console.warn('[search] index load/use failed; falling back:', e?.message || e);
    }
    try {
        const dim = await getStoredEmbeddingDim();
        if (dim != null && Number(dim) !== qEmb.length) {
            console.warn(`[search] warning: embedding dim mismatch store=${dim} query=${qEmb.length}; scores may be ~0. Re-ingest with consistent provider/model.`);
        }
    }
    catch { }
    const stream = fsc.createReadStream(CHUNKS_PATH, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    // Maintain a larger candidate pool for MMR diversification
    const poolSize = Math.max(env.MMR_POOL_MIN, opts.mmrPool ?? (env.MMR_POOL_BASE * k));
    const pool = [];
    function sortPool() { pool.sort((a, b) => b.item.score - a.item.score); }
    function pushPool(item, emb) {
        if (item.score < minScore)
            return;
        if (pool.length < poolSize) {
            pool.push({ item, emb });
            sortPool();
            return;
        }
        if (poolSize === 0)
            return;
        if (item.score > pool[pool.length - 1].item.score) {
            pool[pool.length - 1] = { item, emb };
            sortPool();
        }
    }
    for await (const line of rl) {
        if (!line)
            continue;
        try {
            const rec = JSON.parse(line);
            // Cosine remains correct for both normalized and non-normalized store vectors
            const score = cosineSim(qEmb, rec.embedding);
            pushPool({ score, path: rec.path, docId: rec.docId, chunkIndex: rec.chunkIndex, text: rec.text, heading: rec.heading, page: rec.page }, rec.embedding);
        }
        catch { /* ignore bad lines */ }
    }
    // If no MMR needed or k >= pool, return top-k from pool
    if (k <= 0)
        return [];
    if (pool.length <= k)
        return pool.map(c => c.item);
    // MMR from pool
    const cands = pool.map(c => ({ ...c.item }));
    return await searchMMRFromCandidates(cands, qEmb, k, minScore, opts);
}
export async function getStoredEmbeddingDim() {
    try {
        const meta = await readMeta();
        return (typeof meta.dim === 'number' ? meta.dim : null);
    }
    catch {
        return null;
    }
}
// Compute chunk counts per document id by scanning the chunks file
export async function getChunkCountsByDoc() {
    await initStore();
    const counts = {};
    const stream = fsc.createReadStream(CHUNKS_PATH, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of rl) {
        if (!line)
            continue;
        try {
            const rec = JSON.parse(line);
            const id = rec.docId;
            counts[id] = (counts[id] || 0) + 1;
        }
        catch { /* ignore malformed lines */ }
    }
    return counts;
}
async function searchMMRFromCandidates(candidates, qEmb, k, minScore, opts) {
    if (k <= 0)
        return [];
    const pool = candidates.filter(c => c.score >= minScore);
    if (pool.length <= k) {
        // Even when pool is small, enforce bucket diversity to avoid duplicates
        const bucketOf = (r) => `${r.path}:${Math.floor(r.chunkIndex / 2)}`;
        const seen = new Set();
        const out = [];
        for (const c of pool) {
            const b = bucketOf(c);
            if (seen.has(b))
                continue;
            out.push(c);
            seen.add(b);
            if (out.length >= k)
                break;
        }
        return out;
    }
    const lambda = Math.min(1, Math.max(0, opts.mmrLambda ?? 0.5));
    const selected = [];
    const selectedEmb = [];
    // We don't have candidate embeddings here (when using index) — approximate diversity by grouping doc+chunk windows
    // Seed with best
    selected.push(pool[0]);
    // Greedy pick based on lambda*rel - (1-lambda)*maxSim; since we lack embeddings, use path+chunkIndex buckets to reduce duplicates.
    const bucketOf = (r) => `${r.path}:${Math.floor(r.chunkIndex / 2)}`;
    const used = new Set([bucketOf(pool[0])]);
    for (let i = 1; i < pool.length && selected.length < k; i++) {
        const cand = pool[i];
        const b = bucketOf(cand);
        if (!used.has(b) || selected.length === 0) {
            selected.push(cand);
            used.add(b);
        }
    }
    // Fill up to k while preserving bucket diversity (avoid duplicate path/chunk windows)
    let i = 0;
    const usedBuckets = new Set(selected.map(bucketOf));
    while (selected.length < k && i < pool.length) {
        const c = pool[i++];
        const b = bucketOf(c);
        if (usedBuckets.has(b))
            continue;
        selected.push(c);
        usedBuckets.add(b);
    }
    return selected.slice(0, k);
}
//# sourceMappingURL=store.js.map