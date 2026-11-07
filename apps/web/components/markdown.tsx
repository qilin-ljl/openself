'use client';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
export function Markdown({ body, base }: { body: string; base?: string }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        urlTransform={(url, key) => {
          const safe = defaultUrlTransform(url);
          if (!safe) return '';
          if (!base || /^(https?:|mailto:|#)/i.test(safe)) return safe;
          const resolved = new URL(safe, base);
          if (key === 'src') resolved.searchParams.set('raw', 'true');
          return resolved.href;
        }}
        components={{
          a: ({ children, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {body}
      </ReactMarkdown>
    </div>
  );
}
