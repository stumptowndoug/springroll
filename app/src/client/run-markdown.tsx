import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";

const allowedElements = [
  "a",
  "blockquote",
  "br",
  "code",
  "del",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "li",
  "ol",
  "p",
  "pre",
  "strong",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "ul",
] as const;

export function RunMarkdown({ content }: { readonly content: string }) {
  return (
    <ReactMarkdown
      allowedElements={[...allowedElements]}
      components={{
        a: ({ children, href }) => (
          <a href={href} rel="noreferrer" target="_blank">
            {children}
          </a>
        ),
        h1: ({ children }) => <h2>{children}</h2>,
      }}
      remarkPlugins={[remarkGfm]}
      skipHtml
      urlTransform={safeUrlTransform}
    >
      {content}
    </ReactMarkdown>
  );
}

function safeUrlTransform(url: string): string {
  const transformed = defaultUrlTransform(url);

  try {
    const parsed = new URL(transformed);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? transformed
      : "";
  } catch {
    return "";
  }
}
