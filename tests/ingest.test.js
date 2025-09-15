import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('ingestPaths skips registry entry when embeddings are empty', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'raggy-test-'));
  const originalCwd = process.cwd();
  process.chdir(tmpDir);
  try {
    const { ingestPaths } = await import('../dist/rag/store.js');
    const filePath = path.join(tmpDir, 'doc.txt');
    await fs.writeFile(filePath, 'Hello world');
    const embedder = { async embed(texts) { return texts.map(() => []); } };
    const result = await ingestPaths([filePath], { embedder });
    assert.equal(result.added, 0);
    assert.equal(result.chunks, 0);
    assert.equal(result.skippedFilesNoEmbeddings, 1);
    const registryPath = path.join(tmpDir, 'data', 'embeddings', 'registry.json');
    const registryRaw = await fs.readFile(registryPath, 'utf8');
    const registry = JSON.parse(registryRaw);
    assert.equal(registry.length, 0);
    const chunksPath = path.join(tmpDir, 'data', 'embeddings', 'chunks.jsonl');
    const chunkContent = await fs.readFile(chunksPath, 'utf8');
    assert.equal(chunkContent.trim(), '');
  }
  finally {
    process.chdir(originalCwd);
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
