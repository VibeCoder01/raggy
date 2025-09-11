import express from 'express';
import path from 'path';
import { env } from './lib/env.js';
import { ingestPaths, listRegistry, search, initStore, resetStore, getIngestProgress, markIngestError, startIngestProgress, getChunkCountsByDoc } from './rag/store.js';
import { statSafe, expandGlobsDetailed } from './rag/fs.js';
export function createServer() {
    const app = express();
    app.use(express.json());
    // Global request logger
    app.use((req, res, next) => {
        const start = Date.now();
        let bodySnippet = '';
        try {
            if (req.body && typeof req.body === 'object')
                bodySnippet = ' body=' + JSON.stringify(req.body).slice(0, 400);
        }
        catch { }
        console.log(`[http] -> ${req.method} ${req.url}${bodySnippet}`);
        function done() {
            res.removeListener('finish', done);
            res.removeListener('close', done);
            const ms = Date.now() - start;
            console.log(`[http] <- ${req.method} ${req.url} ${res.statusCode} ${ms}ms`);
        }
        res.on('finish', done);
        res.on('close', done);
        next();
    });
    app.get('/', async (_req, res) => {
        try {
            console.log('[ui] serve / — sending HTML shell');
        }
        catch { }
        // Determine initial state of the documents list for immediate feedback
        let initialDocListHtml = 'Loading…';
        let initialDocListAttrs = '';
        try {
            await initStore();
            const docs = await listRegistry();
            if (!docs || docs.length === 0) {
                initialDocListHtml = 'No documents ingested yet.';
                initialDocListAttrs = ' data-empty="1"';
            }
        }
        catch { }
        res.set('cache-control', 'no-store').type('html').send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>RAG Server</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    /* Minimal helpers to complement Tailwind */
    .muted{ color:#6b7280 } /* gray-500 */
    .ok{ color:#059669 }    /* emerald-600 */
    .err{ color:#dc2626 }   /* red-600 */
    code{ word-break: break-all }
  </style>
  <script>try{tailwind.config={theme:{extend:{}}}}catch{}</script>
  <link rel="icon" href="data:," />
  <meta name="color-scheme" content="light dark" />
  <meta name="description" content="Lightweight RAG server" />
  <meta name="robots" content="noindex" />
  <meta name="referrer" content="no-referrer" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="mobile-web-app-capable" content="yes" />
</head>
<body class="min-h-screen bg-slate-50 text-slate-900">
  <header class="bg-white border-b border-slate-200">
    <div class="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
      <h1 class="text-2xl font-semibold tracking-tight">RAG Server</h1>
      <nav class="flex items-center gap-2 text-sm">
        <button id="btnS" class="px-3 py-1.5 rounded-md bg-slate-900 text-white hover:bg-slate-800">Refresh Summary</button>
        <div class="flex items-center gap-2">
          <button id="btnO" class="px-3 py-1.5 rounded-md bg-emerald-600 text-white hover:bg-emerald-500">Test Ollama</button>
          <span id="oOut" class="muted"></span>
        </div>
        <div class="flex items-center gap-2">
          <button id="btnR" class="px-3 py-1.5 rounded-md bg-red-600 text-white hover:bg-red-500">Reset Data</button>
          <button id="btnRR" class="px-3 py-1.5 rounded-md border border-red-300 text-red-700 hover:bg-red-50">Reset &amp; Reingest</button>
          <span id="rOut" class="muted"></span>
        </div>
      </nav>
    </div>
  </header>

  <main class="max-w-5xl mx-auto px-4 py-6 grid gap-6">
    <!-- Summary -->
    <section class="bg-white border border-slate-200 rounded-xl p-4">
      <h2 class="text-lg font-medium mb-2">Summary</h2>
      <div id="sOut" class="muted">Loading…</div>
    </section>

    <!-- Search -->
    <section class="bg-white border border-slate-200 rounded-xl p-4">
      <h2 class="text-lg font-medium mb-3">Search</h2>
      <form id="f" class="grid gap-3 md:grid-cols-6 items-end">
        <label class="md:col-span-3 text-sm">
          <span class="block text-slate-700 mb-1 font-semibold">Query</span>
          <input id="q" required placeholder="Search phrase" class="w-full rounded-lg border-2 border-slate-400 px-4 py-3 text-lg bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-emerald-400 placeholder:text-slate-400 transition" />
        </label>
        <label class="text-sm">
          <span class="block text-slate-600 mb-1">Top K Files</span>
          <input id="k" type="number" value="5" min="1" max="20" title="Top K Files (groups)" class="w-full rounded-md border-slate-300 focus:ring-2 focus:ring-slate-300 focus:outline-none px-3 py-2" />
        </label>
        <label class="text-sm">
          <span class="block text-slate-600 mb-1">Min Score (0-1)</span>
          <input id="t" type="number" value="${env.SEARCH_MIN_SCORE}" min="0" max="1" step="0.01" title="Min Score (0-1)" class="w-full rounded-md border-slate-300 focus:ring-2 focus:ring-slate-300 focus:outline-none px-3 py-2" />
          <input id="tSlider" type="range" min="0" max="1" step="0.01" value="${env.SEARCH_MIN_SCORE}" class="w-full mt-2" title="Adjust minimum score" />
        </label>
        <div class="md:col-span-6 flex flex-col gap-2">
          <button class="self-end px-4 py-2 rounded-md bg-slate-900 text-white hover:bg-slate-800">Search</button>
          <div class="flex items-center gap-2">
            <button type="button" id="btnEA" class="px-3 py-1.5 rounded-md border border-slate-300 hover:bg-slate-50 text-sm">Expand All</button>
            <button type="button" id="btnCA" class="px-3 py-1.5 rounded-md border border-slate-300 hover:bg-slate-50 text-sm">Collapse All</button>
            <button type="button" id="btnDL" class="px-4 py-2 rounded-md border border-slate-300 hover:bg-slate-50">Download</button>
          </div>
        </div>
      </form>
      <div id="out" class="mt-4 grid gap-3"></div>
    </section>

    <!-- Ingest -->
    <section class="bg-white border border-slate-200 rounded-xl p-4">
      <h2 class="text-lg font-medium mb-2">Ingest Server Path</h2>
      <p class="muted mb-2 text-sm">Enter absolute path(s) on the server, one per line.</p>
      <form id="ing" class="grid gap-3">
        <textarea id="paths" class="w-full h-40 rounded-md border-slate-300 focus:ring-2 focus:ring-slate-300 focus:outline-none p-3" placeholder="/abs/path/to/file-or-folder\n/another/path"></textarea>
        <label class="inline-flex items-center gap-2 text-sm"><input id="recurse" type="checkbox" class="rounded border-slate-300"/> Recurse subfolders</label>
        <button class="self-start px-4 py-2 rounded-md bg-emerald-600 text-white hover:bg-emerald-500">Ingest</button>
      </form>
      <p class="muted text-sm mt-2">On Ubuntu, network shares (smb:// or cifs://) must be mounted first. See <code>docs/mounting-smb-ubuntu.md</code>.</p>
      <div id="ingOut" class="muted mt-2"></div>
      <div class="mt-6">
        <details id="docsSection" class="group">
          <summary class="font-medium mb-2 flex items-center justify-between cursor-pointer select-none list-none">
            <span title="Documents that have been ingested. Click to expand/collapse; use the buttons to expand or collapse all items.">Currently Ingested</span>
            <span class="flex items-center gap-2">
              <span id="docsCount" class="muted text-sm"></span>
              <button id="docsExpandAll" type="button" class="px-2 py-1 rounded-md border border-slate-300 hover:bg-slate-50">Expand all</button>
              <button id="docsCollapseAll" type="button" class="px-2 py-1 rounded-md border border-slate-300 hover:bg-slate-50">Collapse all</button>
            </span>
          </summary>
          <div class="mt-2">
            <div id="docList" class="muted"${initialDocListAttrs}>${initialDocListHtml}</div>
          </div>
        </details>
      </div>
    </section>
  </main>

  <!-- Modal Root -->
  <div id="modal" class="fixed inset-0 z-50 hidden">
    <div id="modalBackdrop" class="absolute inset-0 bg-black/40"></div>
    <div class="relative min-h-full flex items-start md:items-center justify-center p-4">
      <div class="w-full max-w-lg bg-white rounded-xl shadow-lg border border-slate-200 p-4">
        <div class="flex items-center justify-between mb-2">
          <h3 id="modalTitle" class="text-lg font-medium">Modal</h3>
          <button id="modalClose" class="px-2 py-1 rounded-md border border-slate-300 hover:bg-slate-50">Close</button>
        </div>
        <div id="modalBody" class="text-sm text-slate-700"></div>
      </div>
    </div>
  </div>

  <script src="/static/app.js" defer></script>
</body></html>`);
    });
    // Static client
    app.use('/static', express.static(path.join(process.cwd(), 'public'), { etag: false, cacheControl: false, maxAge: 0 }));
    app.get('/ui/ping', (req, res) => { console.log('[ui] ping', req.query); res.json({ ok: true, ts: Date.now() }); });
    // Quiet favicon noise
    app.get('/favicon.ico', (_req, res) => res.status(204).end());
    app.get('/health', (_req, res) => res.json({ status: 'ok', uptime: process.uptime() }));
    app.get('/documents', async (_req, res) => {
        try {
            await initStore();
            const docs = await listRegistry();
            const counts = await getChunkCountsByDoc();
            const enriched = docs.map((d) => ({ ...d, chunks: counts[d.id] || 0 }));
            res.json({ documents: enriched });
        }
        catch (e) {
            res.status(500).json({ error: String(e?.message || e) });
        }
    });
    app.get('/ingest/progress', async (_req, res) => {
        try {
            res.set('cache-control', 'no-store').json(getIngestProgress());
        }
        catch (e) {
            res.status(500).json({ status: 'error', message: String(e?.message || e) });
        }
    });
    app.post('/ingest', async (req, res) => {
        const t0 = Date.now();
        try {
            // Reject concurrent ingests to prevent duplicate writes
            try {
                const cur = getIngestProgress();
                if (cur && cur.status === 'running') {
                    console.warn('[ingest] rejected: another ingest is already running');
                    return res.status(409).json({ error: 'An ingest operation is already running. Please wait for it to finish.' });
                }
            }
            catch { }
            const paths = req.body?.paths || [];
            console.log(`[ingest] intent: ingest ${Array.isArray(paths) ? paths.length : 0} path(s)`);
            // Expand simple globs in provided paths (e.g., /dir/*.txt)
            let expandedPaths = paths.slice();
            let unmatchedGlobs = [];
            try {
                const { expanded, unmatched } = await expandGlobsDetailed(paths);
                expandedPaths = expanded.length ? expanded : paths;
                unmatchedGlobs = unmatched;
            }
            catch { }
            // Ubuntu-specific guard: reject smb:// or cifs:// URIs with guidance to mount first
            async function isUbuntu() {
                try {
                    const fs = await import('node:fs/promises');
                    const txt = await fs.readFile('/etc/os-release', 'utf8').catch(() => '');
                    return /\bID=ubuntu\b/i.test(txt) || /\bUbuntu\b/i.test(txt);
                }
                catch {
                    return false;
                }
            }
            const forbidRe = /^(smb|cifs):\/\//i;
            if (Array.isArray(paths) && paths.some(p => typeof p === 'string' && forbidRe.test(p))) {
                if (await isUbuntu()) {
                    const bad = paths.filter(p => forbidRe.test(String(p)));
                    console.warn(`[ingest] rejected: ${bad.length} smb/cifs URL(s) on Ubuntu; require mount`);
                    try {
                        markIngestError('smb:// and cifs:// URLs are not supported on Ubuntu; mount the share first.');
                    }
                    catch { }
                    return res.status(400).json({
                        error: 'On Ubuntu, smb:// and cifs:// URLs are not supported. Mount the SMB share and provide the mounted path.',
                        ubuntuHint: [
                            'sudo apt-get install -y cifs-utils',
                            'sudo mkdir -p /mnt/smb_share',
                            'sudo mount -t cifs //<host>/<share> /mnt/smb_share -o username=YOUR_USER,vers=3.0,uid=$(id -u),gid=$(id -g)'
                        ],
                    });
                }
            }
            if (!Array.isArray(expandedPaths) || expandedPaths.length === 0) {
                console.warn('[ingest] rejected: no paths provided');
                try {
                    markIngestError('No paths provided');
                }
                catch { }
                return res.status(400).json({ error: 'Provide body { paths: string[] }' });
            }
            // Fast-fail when none of the provided paths exist
            const invalidPaths = [...(unmatchedGlobs || [])];
            let validPathsCount = 0;
            for (const p of expandedPaths) {
                if (typeof p !== 'string' || p.trim() === '') {
                    invalidPaths.push(String(p));
                    continue;
                }
                const st = await statSafe(p).catch(() => null);
                if (st)
                    validPathsCount++;
                else
                    invalidPaths.push(p);
            }
            if (validPathsCount === 0) {
                console.warn(`[ingest] rejected: 0/${expandedPaths.length} valid paths (missing/inaccessible)`);
                try {
                    markIngestError('None of the provided paths exist or are accessible on the server.');
                }
                catch { }
                return res.status(400).json({
                    error: 'None of the provided paths exist or are accessible on the server.',
                    invalidPaths,
                    note: 'Paths must be absolute on the server host (not the browser/client).',
                    ubuntuNote: 'If these are network shares, mount them on the server first. See docs/mounting-smb-ubuntu.md.'
                });
            }
            // Flip progress state immediately so UI sees running even while enumerating
            try {
                startIngestProgress('Enumerating files…');
            }
            catch { }
            const result = await ingestPaths(expandedPaths);
            const ms = Date.now() - t0;
            const disc = [];
            if ((result.validPaths ?? 0) < (result.requestedPaths ?? expandedPaths.length))
                disc.push(`${(result.requestedPaths ?? expandedPaths.length) - (result.validPaths ?? 0)} invalid/missing path(s)`);
            if ((result.skippedZeroChunkFiles ?? 0) > 0)
                disc.push(`skipped ${(result.skippedZeroChunkFiles ?? 0)} file(s) with 0 chunks`);
            if ((result.processedFiles ?? 0) > result.added)
                disc.push(`${(result.processedFiles ?? 0) - result.added} file(s) produced no new doc entry`);
            if ((result.skippedNonTextFiles ?? 0) > 0)
                disc.push(`skipped ${(result.skippedNonTextFiles ?? 0)} non-text file(s)`);
            if ((result.skippedDuplicateChunks ?? 0) > 0)
                disc.push(`skipped ${(result.skippedDuplicateChunks ?? 0)} duplicate chunk(s)`);
            if ((result.skippedEmptyEmbeddingChunks ?? 0) > 0)
                disc.push(`skipped ${(result.skippedEmptyEmbeddingChunks ?? 0)} chunk(s) with empty embeddings`);
            const discMsg = disc.length ? ` discrepancy: ${disc.join('; ')}; action: ignored missing/empty entries` : ' discrepancy: none';
            console.log(`[ingest] result: added=${result.added} chunks=${result.chunks} in ${ms}ms;${discMsg}`);
            res.json({ ...result, invalidPaths: disc.length ? invalidPaths : undefined });
        }
        catch (e) {
            const ms = Date.now() - t0;
            console.error('[ingest] error after', ms + 'ms', e?.message || e);
            try {
                markIngestError(String(e?.message || e));
            }
            catch { }
            res.status(500).json({ error: String(e?.message || e) });
        }
    });
    app.get('/search', async (req, res) => {
        const t0 = Date.now();
        try {
            const q = req.query.q || '';
            const k = Number(req.query.k ?? 5);
            const min = Number(req.query.t ?? req.query.minScore ?? env.SEARCH_MIN_SCORE ?? 0);
            if (!q) {
                console.warn('[search] rejected: missing q');
                return res.status(400).json({ error: 'Missing q' });
            }
            console.log(`[search] intent: q="${(q || '').slice(0, 80)}" len=${q.length} k=${k} min=${isFinite(min) ? min : 0}`);
            const minScore = isFinite(min) ? min : 0;
            // Tunable MMR via query overrides
            const mmrLambda = Math.min(1, Math.max(0, Number(req.query['mmr.lambda'] ?? env.MMR_LAMBDA)));
            const basePool = Math.max(env.MMR_POOL_MIN, env.MMR_POOL_BASE * k);
            const mmrPool = Math.max(10, Number(req.query['mmr.pool'] ?? basePool));
            const results = await search(q, k, minScore, { mmrLambda, mmrPool });
            const ms = Date.now() - t0;
            const top = results[0]?.score != null ? Number(results[0].score).toFixed(3) : '-';
            const discMsg = results.length < k ? ` discrepancy: hits<k by ${k - results.length}; action: returned available` : ' discrepancy: none';
            console.log(`[search] result: ${results.length} hit(s), top=${top}, ${ms}ms;${discMsg}`);
            res.set('cache-control', 'no-store').json({ query: q, results });
        }
        catch (e) {
            const ms = Date.now() - t0;
            console.error('[search] error after', ms + 'ms', e?.message || e);
            res.status(500).json({ error: String(e?.message || e) });
        }
    });
    app.get('/ingest/stats', async (_req, res) => {
        const t0 = Date.now();
        try {
            console.log('[stats] intent: compute documents/chunks');
            await initStore();
            const docs = await listRegistry();
            const t1 = Date.now();
            // chunks count from file lines
            const fs = await import('node:fs/promises');
            const path = await import('node:path');
            const CHUNKS_PATH = path.default.join(process.cwd(), 'data', 'embeddings', 'chunks.jsonl');
            let chunks = 0;
            try {
                const txt = await fs.readFile(CHUNKS_PATH, 'utf8');
                chunks = txt.split('\n').filter(Boolean).length;
            }
            catch { }
            // Additional store info
            const { getStoredEmbeddingDim } = await import('./rag/store.js');
            let embeddingDim = null;
            try {
                embeddingDim = await getStoredEmbeddingDim();
            }
            catch { }
            const ms = Date.now() - t0;
            const msReg = t1 - t0;
            const msChunks = ms - msReg;
            const discMsg = (docs.length > 0 && chunks === 0) ? ' discrepancy: registry>0 but chunks=0; action: none' : (chunks > 0 && docs.length === 0) ? ' discrepancy: chunks>0 but registry=0; action: none' : ' discrepancy: none';
            console.log(`[stats] result: documents=${docs.length} chunks=${chunks} in ${ms}ms (registry ${msReg}ms, chunks ${msChunks}ms);${discMsg}`);
            res.set('cache-control', 'no-store').json({ documents: docs.length, chunks, provider: env.EMBEDDINGS_PROVIDER, model: env.EMBEDDINGS_MODEL, embeddingDim });
        }
        catch (e) {
            const ms = Date.now() - t0;
            console.error('[stats] error after', ms + 'ms', e?.message || e);
            res.status(500).json({ error: String(e?.message || e) });
        }
    });
    app.post('/ingest/reset', async (_req, res) => {
        const t0 = Date.now();
        console.log('[reset] intent: clear ingested data');
        try {
            await resetStore();
            // Verify state
            const fs = await import('node:fs/promises');
            const path = await import('node:path');
            const CHUNKS_PATH = path.default.join(process.cwd(), 'data', 'embeddings', 'chunks.jsonl');
            const REGISTRY_PATH = path.default.join(process.cwd(), 'data', 'embeddings', 'registry.json');
            let chunks = 0;
            try {
                const txt = await fs.readFile(CHUNKS_PATH, 'utf8');
                chunks = txt.split('\n').filter(Boolean).length;
            }
            catch { }
            let docs = 0;
            try {
                const txt = await fs.readFile(REGISTRY_PATH, 'utf8');
                const arr = JSON.parse(txt);
                docs = Array.isArray(arr) ? arr.length : 0;
            }
            catch { }
            let action = 'none';
            if (docs > 0 || chunks > 0) {
                await resetStore();
                action = 're-ran reset';
            }
            const ms = Date.now() - t0;
            const discMsg = (docs > 0 || chunks > 0) ? ` discrepancy: after-reset docs=${docs} chunks=${chunks}; action: ${action}` : ' discrepancy: none';
            console.log(`[reset] result: ok in ${ms}ms;${discMsg}`);
            res.set('cache-control', 'no-store').json({ ok: true });
        }
        catch (e) {
            const ms = Date.now() - t0;
            console.error('[reset] error after', ms + 'ms', e?.message || e);
            res.status(500).json({ error: String(e?.message || e) });
        }
    });
    app.post('/ingest/reingest', async (_req, res) => {
        const t0 = Date.now();
        console.log('[reingest] intent: reset and reingest from registry');
        try {
            await initStore();
            const docs = await listRegistry();
            const paths = docs.map(d => d.path);
            if (!paths.length)
                return res.status(400).json({ error: 'No documents in registry to reingest' });
            try {
                startIngestProgress('Resetting…');
            }
            catch { }
            await resetStore();
            try {
                startIngestProgress('Enumerating files…');
            }
            catch { }
            const result = await ingestPaths(paths);
            const ms = Date.now() - t0;
            console.log(`[reingest] result: added=${result.added} chunks=${result.chunks} in ${ms}ms`);
            res.set('cache-control', 'no-store').json({ ...result, requestedPaths: paths.length });
        }
        catch (e) {
            const ms = Date.now() - t0;
            console.error('[reingest] error after', ms + 'ms', e?.message || e);
            try {
                markIngestError(String(e?.message || e));
            }
            catch { }
            res.status(500).json({ error: String(e?.message || e) });
        }
    });
    app.get('/ollama/test', async (_req, res) => {
        const t0 = Date.now();
        console.log('[ollama] intent: probe connectivity');
        try {
            const base = env.EMBEDDINGS_BASE_URL;
            const url1 = new URL('/api/tags', base);
            console.log('[ollama] GET', url1.toString());
            const ctrl = new AbortController();
            const to = setTimeout(() => ctrl.abort(), 2000);
            let usedFallback = false;
            let r = await fetch(url1, { method: 'GET', signal: ctrl.signal }).catch((err) => { console.warn('[ollama] /api/tags error', err?.message || err); return null; });
            clearTimeout(to);
            if (!r || !r.ok) {
                const url2 = new URL('/api/version', base);
                console.log('[ollama] fallback GET', url2.toString());
                r = await fetch(url2, { method: 'GET' });
                usedFallback = true;
            }
            const status = r?.status ?? 0;
            let parsed = null;
            try {
                parsed = r ? await r.json() : null;
            }
            catch { }
            const modelsArr = parsed?.models && Array.isArray(parsed.models)
                ? parsed.models.map((m) => String(m?.name || m?.model || m?.tag || '')).filter(Boolean)
                : undefined;
            const models = Array.isArray(modelsArr) ? modelsArr.length : undefined;
            const ms = Date.now() - t0;
            const disc = [];
            if (usedFallback)
                disc.push('primary /api/tags failed; used /api/version');
            if (models == null)
                disc.push('models not reported');
            const discMsg = disc.length ? ` discrepancy: ${disc.join('; ')}; action: none` : ' discrepancy: none';
            console.log(`[ollama] result: ok=${Boolean(r && r.ok)} status=${status} models=${models ?? '?'} in ${ms}ms;${discMsg}`);
            res.set('cache-control', 'no-store').status(status || 500).json({ ok: Boolean(r && r.ok), status, baseUrl: base, endpoint: r?.url, models, modelsList: modelsArr });
        }
        catch (e) {
            const ms = Date.now() - t0;
            console.error('[ollama] error after', ms + 'ms', e?.message || e);
            res.set('cache-control', 'no-store').status(500).json({ ok: false, error: String(e?.message || e), baseUrl: env.EMBEDDINGS_BASE_URL });
        }
    });
    // Error logger
    app.use((err, req, res, _next) => {
        console.error('[http] !! error', req?.method, req?.url, err?.stack || err);
        if (!res.headersSent)
            res.status(500).json({ error: 'Internal Server Error' });
    });
    return app;
}
// If run directly
if (import.meta.url === `file://${process.argv[1]}`) {
    const app = createServer();
    const server = app.listen(env.PORT, () => console.log(`Server http://localhost:${env.PORT}`));
    try { // Relax timeouts
        // @ts-ignore
        server.requestTimeout = 0; // disable
        // @ts-ignore
        server.keepAliveTimeout = 120000;
        // @ts-ignore
        if (typeof server.setTimeout === 'function')
            server.setTimeout(0);
    }
    catch { }
}
//# sourceMappingURL=server.js.map