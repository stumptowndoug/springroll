import type { ImageArtifactMediaType } from "./storage/sqlite-run-artifact-repository.ts";

export interface InspectedImage {
  readonly mediaType: ImageArtifactMediaType;
  readonly width?: number;
  readonly height?: number;
}

export function decodeImageDataUrl(value: string): {
  readonly bytes: Uint8Array;
  readonly inspected: InspectedImage;
} {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([a-z0-9+/=]+)$/i.exec(
    value,
  );
  if (!match?.[1] || !match[2]) {
    throw new TypeError(
      "Image attachments must be PNG, JPEG, or WebP data URLs",
    );
  }
  const bytes = Uint8Array.from(Buffer.from(match[2], "base64"));
  if (bytes.byteLength === 0) {
    throw new TypeError("Image attachment must not be empty");
  }
  return { bytes, inspected: inspectImage(bytes, match[1].toLowerCase()) };
}

export function imageDataUrl(
  bytes: Uint8Array,
  mediaType: ImageArtifactMediaType,
): string {
  return `data:${mediaType};base64,${Buffer.from(bytes).toString("base64")}`;
}

export function inspectImage(
  bytes: Uint8Array,
  declaredMediaType: string,
): InspectedImage {
  const actualMediaType = sniffImageMediaType(bytes);
  if (!actualMediaType || actualMediaType !== declaredMediaType) {
    throw new TypeError(
      `Image bytes do not match ${declaredMediaType || "the declared media type"}`,
    );
  }
  if (
    actualMediaType === "image/png" &&
    bytes.byteLength >= 24 &&
    ascii(bytes, 12, 16) === "IHDR"
  ) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16);
    const height = view.getUint32(20);
    if (width > 0 && height > 0) {
      return { mediaType: actualMediaType, width, height };
    }
  }
  return { mediaType: actualMediaType };
}

function sniffImageMediaType(
  bytes: Uint8Array,
): ImageArtifactMediaType | undefined {
  if (
    bytes.byteLength >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes.byteLength >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    bytes.byteLength >= 12 &&
    ascii(bytes, 0, 4) === "RIFF" &&
    ascii(bytes, 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return undefined;
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}
