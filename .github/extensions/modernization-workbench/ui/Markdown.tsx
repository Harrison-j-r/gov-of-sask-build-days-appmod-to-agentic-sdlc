import ReactMarkdown from "react-markdown";

export function Markdown({ children }: { children: string }) {
  return <ReactMarkdown skipHtml urlTransform={url => {
    try { return new URL(url).protocol === "https:" ? url : ""; }
    catch { return ""; }
  }} components={{ a: props => <a {...props} target="_blank" rel="noopener noreferrer" /> }}>{children}</ReactMarkdown>;
}
