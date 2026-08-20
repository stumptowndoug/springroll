import type { RunResultArtifact } from "@springroll/kernel";
import { useEffect, useState } from "react";
import { CloseIcon, DownloadIcon, ExpandIcon } from "./icons.tsx";

export function RunArtifacts({
  ariaLabel = "Generated images",
  artifacts,
}: {
  readonly ariaLabel?: string;
  readonly artifacts: readonly RunResultArtifact[];
}) {
  const images = artifacts.filter((artifact) => artifact.kind === "image");
  const [expandedId, setExpandedId] = useState<string>();
  const expanded = images.find((artifact) => artifact.id === expandedId);

  useEffect(() => {
    if (!expanded) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpandedId(undefined);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [expanded]);

  if (images.length === 0) return null;

  return (
    <>
      <section className="run-artifacts" aria-label={ariaLabel}>
        {images.map((artifact) => (
          <RunImageArtifact
            artifact={artifact}
            key={artifact.id}
            onExpand={() => setExpandedId(artifact.id)}
          />
        ))}
      </section>
      {expanded ? (
        <ImageLightbox
          artifact={expanded}
          onClose={() => setExpandedId(undefined)}
        />
      ) : null}
    </>
  );
}

function RunImageArtifact({
  artifact,
  onExpand,
}: {
  readonly artifact: RunResultArtifact;
  readonly onExpand: () => void;
}) {
  const [broken, setBroken] = useState(false);
  const href = artifactHref(artifact);
  const alt = artifactAlt(artifact);
  const width = positiveInteger(artifact.payload?.width);
  const height = positiveInteger(artifact.payload?.height);

  return (
    <figure className="run-artifact">
      {broken ? (
        <div className="run-artifact-missing" role="status">
          This image is unavailable.
        </div>
      ) : (
        <div className="run-artifact-frame">
          <button
            aria-label={`Expand ${artifact.title}`}
            className="run-artifact-image-button"
            onClick={onExpand}
            type="button"
          >
            <img
              alt={alt}
              {...(height ? { height } : undefined)}
              loading="lazy"
              onError={() => setBroken(true)}
              src={href}
              {...(width ? { width } : undefined)}
            />
          </button>
          <div className="run-artifact-actions">
            <button onClick={onExpand} type="button">
              <ExpandIcon />
              Expand
            </button>
            <a
              download={artifactFilename(artifact)}
              href={`${href}?download=1`}
            >
              <DownloadIcon />
              Download
            </a>
          </div>
        </div>
      )}
      <ArtifactCaption artifact={artifact} />
    </figure>
  );
}

function ImageLightbox({
  artifact,
  onClose,
}: {
  readonly artifact: RunResultArtifact;
  readonly onClose: () => void;
}) {
  const href = artifactHref(artifact);
  return (
    <div className="image-lightbox-backdrop">
      <section
        aria-label={artifact.title}
        aria-modal="true"
        className="image-lightbox"
        role="dialog"
      >
        <header>
          <div>
            <strong>{artifact.title}</strong>
            <small>{artifactFacts(artifact).join(" · ")}</small>
          </div>
          <div className="image-lightbox-actions">
            <a
              download={artifactFilename(artifact)}
              href={`${href}?download=1`}
            >
              <DownloadIcon />
              Download
            </a>
            <button aria-label="Close image" onClick={onClose} type="button">
              <CloseIcon />
            </button>
          </div>
        </header>
        <div className="image-lightbox-canvas">
          <img alt={artifactAlt(artifact)} src={href} />
        </div>
      </section>
    </div>
  );
}

function ArtifactCaption({
  artifact,
}: {
  readonly artifact: RunResultArtifact;
}) {
  const provider = textValue(artifact.payload?.providerId);
  const model = textValue(artifact.payload?.modelId);
  return (
    <figcaption>
      <strong>{artifact.title}</strong>
      <span>{artifactFacts(artifact).join(" · ")}</span>
      {provider || model ? (
        <span>{[provider, model].filter(Boolean).join(" · ")}</span>
      ) : null}
    </figcaption>
  );
}

function artifactFacts(artifact: RunResultArtifact): readonly string[] {
  const width = positiveInteger(artifact.payload?.width);
  const height = positiveInteger(artifact.payload?.height);
  const byteSize = positiveInteger(artifact.payload?.byteSize);
  return [
    width && height
      ? `${width.toLocaleString()} × ${height.toLocaleString()}`
      : undefined,
    mediaTypeLabel(artifact.mediaType),
    byteSize ? formatBytes(byteSize) : undefined,
    "Stored on this Mac",
  ].filter((fact): fact is string => Boolean(fact));
}

function artifactHref(artifact: RunResultArtifact): string {
  return `/api/artifacts/${encodeURIComponent(artifact.id)}`;
}

function artifactAlt(artifact: RunResultArtifact): string {
  return textValue(artifact.payload?.alt) ?? artifact.title;
}

function artifactFilename(artifact: RunResultArtifact): string {
  const stem =
    artifact.title
      .normalize("NFKD")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "generated-image";
  const extension =
    artifact.mediaType === "image/jpeg"
      ? "jpg"
      : artifact.mediaType === "image/webp"
        ? "webp"
        : "png";
  return `${stem}.${extension}`;
}

function mediaTypeLabel(mediaType: string | undefined): string | undefined {
  if (mediaType === "image/png") return "PNG";
  if (mediaType === "image/jpeg") return "JPEG";
  if (mediaType === "image/webp") return "WebP";
  return undefined;
}

function formatBytes(value: number): string {
  if (value < 1_000) return `${value} B`;
  if (value < 1_000_000) return `${(value / 1_000).toFixed(1)} kB`;
  return `${(value / 1_000_000).toFixed(1)} MB`;
}

function textValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined;
}
