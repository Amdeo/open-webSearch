import { JSDOM } from 'jsdom';
import TurndownService from 'turndown';
import { tables } from 'turndown-plugin-gfm';
import { isPublicHttpUrl } from '../../utils/urlSafety.js';

const converter = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' }).use(tables);
converter.addRule('preformattedBlock', {
    filter: 'pre',
    replacement: (_content, node) => {
        const code = (node.textContent ?? '').replace(/\n$/, '');
        const language = node.querySelector('code')?.className.match(/\blanguage-([\w.+#-]+)/)?.[1] ?? '';
        let length = 3;
        for (const match of code.matchAll(/^ {0,3}(`{3,})/gm)) {
            length = Math.max(length, match[1].length + 1);
        }
        const fence = '`'.repeat(length);
        return `\n\n${fence}${language}\n${code}\n${fence}\n\n`;
    }
});
converter.addRule('tableCell', {
    filter: ['th', 'td'],
    replacement: (content, node) => {
        const prefix = node.previousElementSibling ? ' ' : '| ';
        return prefix + content.trim().replace(/\n+/g, ' ').replace(/\|/g, '\\|') + ' |';
    }
});

export function htmlToMarkdown(html: string, finalUrl: string, baseHref?: string): string {
    const fragment = JSDOM.fragment(html);
    for (const br of fragment.querySelectorAll('pre br')) br.replaceWith('\n');
    for (const line of Array.from(fragment.querySelectorAll('pre div, pre p')).reverse()) {
        const previous = line.previousSibling?.textContent;
        if (previous && !previous.endsWith('\n') && !line.textContent?.startsWith('\n')) line.before('\n');
        if (!line.textContent?.endsWith('\n') && !line.nextSibling?.textContent?.startsWith('\n')) line.append('\n');
    }
    const base = baseHref && URL.canParse(baseHref, finalUrl) ? new URL(baseHref, finalUrl).href : finalUrl;
    for (const node of fragment.querySelectorAll('a[href], img[src]')) {
        const attr = node.tagName === 'A' ? 'href' : 'src';
        const value = node.getAttribute(attr)!;
        const url = URL.canParse(value, base) ? new URL(value, base) : null;
        if (url && !url.username && !url.password && isPublicHttpUrl(url.href)) {
            node.setAttribute(attr, url.href);
        } else {
            node.removeAttribute(attr);
        }
    }
    for (const table of fragment.querySelectorAll('table')) {
        if (table.caption) {
            const caption = table.ownerDocument.createElement('p');
            caption.textContent = table.caption.textContent;
            table.before(caption);
            table.caption.remove();
        }
        const firstRow = table.rows[0];
        if (!firstRow?.cells.length) {
            table.replaceWith(...table.childNodes);
        } else if (firstRow.parentElement !== table.tHead) {
            const head = table.createTHead();
            if (Array.from(firstRow.cells).every(cell => cell.tagName === 'TH')) {
                head.append(firstRow);
            } else {
                // GFM needs a header. An empty one keeps the first data row intact.
                const header = head.insertRow();
                for (let i = 0; i < firstRow.cells.length; i++) {
                    header.appendChild(table.ownerDocument.createElement('th'));
                }
            }
        }
    }
    return converter.turndown(fragment);
}
