import { marked } from 'marked';
import DOMPurify from 'dompurify';

// 模型回覆只允許排版元素；不載入外部資源或產生可操作的連結。
export function renderAIReport(text: string): string {
  const html = marked.parse(text, { async: false, gfm: true });
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li',
      'strong', 'em', 'del', 'blockquote', 'pre', 'code', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td'],
    ALLOWED_ATTR: ['start'],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
  });
}
