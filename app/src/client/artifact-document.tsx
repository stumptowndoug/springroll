import type { RunResultArtifact } from "@springroll/kernel";
import { Fragment } from "react";
import { RollmarkDocument } from "./rollmark-document.tsx";
import { RunArtifacts } from "./run-artifacts.tsx";
import { RunMarkdown } from "./run-markdown.tsx";

function artifactReference() {
  return /^\s*\{\{artifact:([^}\s]+)\}\}\s*$/gm;
}

export function referencedArtifactIds(content: string): ReadonlySet<string> {
  return new Set(
    Array.from(
      content.matchAll(artifactReference()),
      (match) => match[1],
    ).filter((id): id is string => Boolean(id)),
  );
}

export function ArtifactDocument({
  artifacts,
  content,
  pending = false,
  showUnreferenced = true,
}: {
  readonly artifacts: readonly RunResultArtifact[];
  readonly content: string;
  readonly pending?: boolean;
  readonly showUnreferenced?: boolean;
}) {
  const byId = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
  const referenced = referencedArtifactIds(content);
  const blocks: Array<
    | {
        readonly kind: "markdown";
        readonly key: string;
        readonly content: string;
      }
    | {
        readonly kind: "artifact";
        readonly key: string;
        readonly artifact: RunResultArtifact;
      }
  > = [];
  let cursor = 0;
  for (const match of content.matchAll(artifactReference())) {
    const index = match.index;
    const id = match[1];
    if (index === undefined || !id) continue;
    const artifact = byId.get(id);
    if (!artifact) continue;
    const markdown = content.slice(cursor, index).trim();
    if (markdown) {
      blocks.push({
        kind: "markdown",
        key: `markdown:${cursor}`,
        content: markdown,
      });
    }
    blocks.push({
      kind: "artifact",
      key: `artifact:${id}:${index}`,
      artifact,
    });
    cursor = index + match[0].length;
  }
  const tail = content.slice(cursor).trim();
  if (tail)
    blocks.push({ kind: "markdown", key: `markdown:${cursor}`, content: tail });
  if (blocks.length === 0 && content.trim()) {
    blocks.push({ kind: "markdown", key: "markdown:complete", content });
  }

  const unreferenced = showUnreferenced
    ? artifacts.filter((artifact) => !referenced.has(artifact.id))
    : [];

  return (
    <>
      {blocks.map((block) => (
        <Fragment key={block.key}>
          {block.kind === "artifact" ? (
            <RunArtifacts artifacts={[block.artifact]} />
          ) : pending ? (
            <RunMarkdown content={block.content} />
          ) : (
            <RollmarkDocument content={block.content} />
          )}
        </Fragment>
      ))}
      <RunArtifacts artifacts={unreferenced} />
    </>
  );
}
