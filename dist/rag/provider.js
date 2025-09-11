import { env } from '../lib/env.js';
export function createEmbedder() {
    // Only Ollama is supported; mock has been removed
    return new OllamaEmbedder(env.EMBEDDINGS_BASE_URL, env.EMBEDDINGS_MODEL);
}
class OllamaEmbedder {
    baseUrl;
    model;
    constructor(baseUrl, model) {
        this.baseUrl = baseUrl;
        this.model = model;
    }
    async embed(texts) {
        const url = new URL('/api/embeddings', this.baseUrl);
        const conc = Math.max(1, Number(env.EMBEDDINGS_CONCURRENCY || 4));
        const out = new Array(texts.length);
        let idx = 0;
        async function worker() {
            while (true) {
                const i = idx++;
                if (i >= texts.length)
                    break;
                const t = texts[i];
                try {
                    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: this.model, prompt: t }) });
                    if (!res.ok)
                        throw new Error(`Ollama embeddings failed: ${res.status}`);
                    const j = await res.json();
                    const emb = j?.embedding ?? j?.data?.[0]?.embedding;
                    if (!Array.isArray(emb) || emb.length === 0 || !Number.isFinite(emb[0] ?? NaN)) {
                        try {
                            console.warn('[embeddings] invalid response (missing/empty); skipping one chunk');
                        }
                        catch { }
                        out[i] = [];
                    }
                    else {
                        out[i] = emb;
                    }
                }
                catch (e) {
                    try {
                        console.warn('[embeddings] request failed:', e?.message || e);
                    }
                    catch { }
                    out[i] = [];
                }
            }
        }
        const workers = [];
        for (let w = 0; w < conc; w++)
            workers.push(worker.call(this));
        await Promise.all(workers);
        return out;
    }
}
// Mock embedder removed
//# sourceMappingURL=provider.js.map