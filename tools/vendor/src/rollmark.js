// Rollmark: Springroll's report format (Markdown plus ```chart and ```mermaid blocks).
// mount(container, source, {theme, colors}) draws a report; Mermaid loads only when a report has a diagram.
import { mountRollmarkDocument, renderRollmark } from '@stumptowndoug/rollmark';

let mermaidMod = null;
export async function mount(container, source, { theme = 'auto', colors } = {}) {
  const mermaid = /^\s*```mermaid/m.test(source) ? (await (mermaidMod ??= import('mermaid'))).default : undefined;
  return mountRollmarkDocument(container, source, { theme, colors, mermaid });
}
export { renderRollmark };
