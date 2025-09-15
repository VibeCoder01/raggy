try {
    const dotenv = await import('dotenv');
    const cfg = typeof dotenv?.config === 'function' ? dotenv.config : (typeof dotenv?.default?.config === 'function' ? dotenv.default.config : null);
    if (cfg)
        cfg.call(dotenv);
}
catch { }
export const env = {
    NODE_ENV: process.env.NODE_ENV ?? 'development',
    PORT: Number(process.env.PORT ?? 3000),
    EMBEDDINGS_PROVIDER: (process.env.EMBEDDINGS_PROVIDER ?? 'ollama'),
    EMBEDDINGS_MODEL: process.env.EMBEDDINGS_MODEL ?? 'nomic-embed-text',
    EMBEDDINGS_BASE_URL: process.env.EMBEDDINGS_BASE_URL ?? 'http://localhost:11434',
    // Default minimum score threshold for search results (0-1)
    SEARCH_MIN_SCORE: Number(process.env.SEARCH_MIN_SCORE ?? 0.5),
    // Performance tuning
    EMBEDDINGS_CONCURRENCY: Math.max(1, Number(process.env.EMBEDDINGS_CONCURRENCY ?? 4)),
    CHUNK_CHARS: Math.max(200, Number(process.env.CHUNK_CHARS ?? 800)),
    CHUNK_OVERLAP: Math.min(500, Math.max(0, Number(process.env.CHUNK_OVERLAP ?? 120))),
    // MMR defaults
    MMR_LAMBDA: Math.min(1, Math.max(0, Number(process.env.MMR_LAMBDA ?? 0.5))),
    MMR_POOL_BASE: Number(process.env.MMR_POOL_BASE ?? 8), // multiplier of k
    MMR_POOL_MIN: Number(process.env.MMR_POOL_MIN ?? 50),
    // Sentence tokenizer
    SENT_TOKENIZER: (process.env.SENT_TOKENIZER ?? 'regex'),
};
//# sourceMappingURL=env.js.map
