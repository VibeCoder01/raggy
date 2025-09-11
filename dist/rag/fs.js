import { promises as fs } from 'fs';
import path from 'path';
export async function statSafe(p) {
    try {
        return await fs.stat(p);
    }
    catch {
        return null;
    }
}
export async function ensureDir(dir) {
    await fs.mkdir(dir, { recursive: true });
}
export async function listFilesRec(dir) {
    const out = [];
    async function walk(d) {
        const list = await fs.readdir(d, { withFileTypes: true });
        for (const e of list) {
            const p = path.join(d, e.name);
            if (e.isDirectory())
                await walk(p);
            else
                out.push(p);
        }
    }
    await walk(dir);
    return out;
}
export async function readTextFile(p) {
    const buf = await fs.readFile(p);
    return buf.toString('utf8');
}
export function isProbablyTextPath(p) {
    const ext = path.extname(p).toLowerCase();
    if (ext === '.pdf')
        return false; // handled separately
    const allow = new Set([
        '.txt', '.md', '.markdown', '.json', '.csv', '.tsv', '.log', '.ini', '.conf', '.cfg', '.yaml', '.yml', '.xml',
        '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.css', '.scss', '.less', '.html', '.htm', '.shtm', '.xhtml',
        '.py', '.rb', '.go', '.rs', '.java', '.kt', '.scala', '.c', '.h', '.cc', '.cpp', '.hpp', '.m', '.mm', '.swift', '.php', '.pl',
        '.sh', '.bash', '.zsh', '.fish', '.r', '.jl', '.lua', '.sql',
        // Windows batch files
        '.bat', '.cmd',
        // PowerShell and related manifests/modules
        '.ps1', '.psm1', '.psd1'
    ]);
    if (allow.has(ext))
        return true;
    return false;
}
// --- Minimal glob expansion (supports * and ? in basename; non-recursive) ---
function hasGlob(p) { return /[*?\[\]]/.test(p); }
function globToRegExp(glob) {
    // Escape regex special chars, then translate * and ?
    const esc = (s) => s.replace(/[.+^${}()|\\]/g, '\\$&');
    let pat = '';
    for (let i = 0; i < glob.length; i++) {
        const ch = glob[i];
        if (ch === '*')
            pat += '[^/]*';
        else if (ch === '?')
            pat += '[^/]';
        else
            pat += esc(ch);
    }
    return new RegExp('^' + pat + '$');
}
export async function expandGlobsDetailed(paths, opts = {}) {
    const out = [];
    const unmatched = [];
    for (const p of paths) {
        if (!hasGlob(p)) {
            out.push(p);
            continue;
        }
        if (!opts.recursive) {
            // Non-recursive: match basename only in the provided directory
            const base = path.dirname(p);
            const patt = path.basename(p);
            const re = globToRegExp(patt);
            try {
                const list = await fs.readdir(base, { withFileTypes: true });
                const matches = list.filter(e => e.isFile() && re.test(e.name)).map(e => path.join(base, e.name));
                if (matches.length)
                    out.push(...matches);
                else
                    unmatched.push(p);
            }
            catch {
                unmatched.push(p);
            }
            continue;
        }
        // Recursive matching: find non-glob prefix as base, walk and test full path
        const s = String(p);
        const chars = ['*', '?', '[', ']'];
        let idx = -1;
        for (let i = 0; i < s.length; i++) {
            if (chars.includes(s[i])) {
                idx = i;
                break;
            }
        }
        let baseDir;
        if (idx <= 0)
            baseDir = path.dirname(s);
        else {
            let sepIdx = -1;
            for (let i = idx; i >= 0; i--) {
                const ch = s[i];
                if (ch === '/' || ch === '\\') {
                    sepIdx = i;
                    break;
                }
            }
            baseDir = sepIdx >= 0 ? (s.slice(0, sepIdx) || path.sep) : path.dirname(s.slice(0, idx));
        }
        function globPathToRegExp(globPath) {
            const specials = /[.+^${}()|\\]/g;
            let out = '';
            for (let i = 0; i < globPath.length; i++) {
                const ch = globPath[i];
                const next = globPath[i + 1];
                if (ch === '*') {
                    if (next === '*') {
                        out += '[\\/\\s\n\S]*';
                        i++;
                    } // ** => match across dirs
                    else
                        out += '[^/\\\\]*';
                }
                else if (ch === '?')
                    out += '[^/\\\\]';
                else if (ch === '/' || ch === '\\')
                    out += '[\\/]';
                else
                    out += ch.replace(specials, '\\$&');
            }
            return new RegExp('^' + out + '$');
        }
        const reFull = globPathToRegExp(s);
        try {
            const files = await listFilesRec(baseDir);
            const matches = files.filter(fp => reFull.test(fp));
            if (matches.length)
                out.push(...matches);
            else
                unmatched.push(p);
        }
        catch {
            unmatched.push(p);
        }
    }
    return { expanded: out, unmatched };
}
//# sourceMappingURL=fs.js.map