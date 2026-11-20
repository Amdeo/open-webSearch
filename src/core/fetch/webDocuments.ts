import { randomBytes } from 'node:crypto';

const TTL_MS = 30 * 60 * 1000;
const MAX_BYTES = 16 * 1024 * 1024;
const MAX_DOCUMENTS = 128;
const documents = new Map<string, { owner: symbol; content: string; expires: number; timer: NodeJS.Timeout }>();
let bytes = 0;

function remove(id: string): void {
    const document = documents.get(id);
    if (!document) return;
    clearTimeout(document.timer);
    bytes -= document.content.length * 2;
    documents.delete(id);
}

export function saveWebDocument(owner: symbol, content: string): string | undefined {
    const size = content.length * 2;
    if (size > MAX_BYTES) return undefined;
    for (const [id, document] of documents) {
        if (document.expires <= Date.now()) remove(id);
    }
    while (documents.size >= MAX_DOCUMENTS || bytes + size > MAX_BYTES) {
        remove(documents.keys().next().value!);
    }
    const id = randomBytes(32).toString('hex');
    const timer = setTimeout(() => remove(id), TTL_MS);
    timer.unref();
    // Detach slices from their original response so retained backing storage is bounded too.
    const storedContent = Buffer.from(content, 'utf16le').toString('utf16le');
    documents.set(id, { owner, content: storedContent, expires: Date.now() + TTL_MS, timer });
    bytes += size;
    return id;
}

export function readWebDocument(owner: symbol, id: string, offset: number, maxChars: number, keyword?: string) {
    const document = documents.get(id);
    if (document && document.expires <= Date.now()) remove(id);
    if (!document || document.expires <= Date.now() || document.owner !== owner) {
        throw new Error('Document expired, evicted, or unavailable in this session; fetch it again.');
    }
    const matchOffset = keyword === undefined ? undefined : document.content.indexOf(keyword, offset);
    if (matchOffset === -1) return { found: false, nextOffset: null };
    const start = matchOffset === undefined ? offset : Math.max(0, matchOffset - Math.floor((maxChars - keyword!.length) / 2));
    const content = document.content.slice(start, start + maxChars);
    const end = start + content.length;
    return { found: true, offset: start, content, nextOffset: end < document.content.length ? end : null, ...(matchOffset === undefined ? {} : { matchOffset }) };
}
