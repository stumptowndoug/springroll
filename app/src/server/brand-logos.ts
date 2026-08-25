import { readFileSync } from "node:fs";
import { sanitizeProviderLogo } from "./provider-logos.ts";

interface SimpleIconMetadata {
  readonly title: string;
  readonly slug: string;
  readonly hex: string;
  readonly aliases?: {
    readonly aka?: readonly string[];
    readonly old?: readonly string[];
    readonly dup?: readonly { readonly title: string }[];
  };
}

const iconMetadata = JSON.parse(
  readFileSync(new URL(import.meta.resolve("simple-icons/icons.json")), "utf8"),
) as readonly SimpleIconMetadata[];

const iconsByName = new Map<string, SimpleIconMetadata>();
for (const icon of iconMetadata) {
  const names = [
    icon.title,
    icon.slug,
    ...(icon.aliases?.aka ?? []),
    ...(icon.aliases?.old ?? []),
    ...(icon.aliases?.dup?.map((alias) => alias.title) ?? []),
  ];
  for (const name of names) iconsByName.set(normalizeBrandName(name), icon);
}

const logoCache = new Map<string, string | undefined>();

/**
 * Resolves only exact brand-name aliases from the pinned Simple Icons catalog.
 * Exact matching avoids assigning a plausible but incorrect provider mark.
 */
export function resolveBrandLogoSvg(
  name: string,
  operator?: string,
): string | undefined {
  const candidates = brandCandidates(name, operator);
  const cacheKey = candidates.join("|");
  if (logoCache.has(cacheKey)) return logoCache.get(cacheKey);
  const icon = candidates
    .map((candidate) => iconsByName.get(candidate))
    .find((candidate) => candidate !== undefined);
  if (!icon) {
    logoCache.set(cacheKey, undefined);
    return undefined;
  }
  const raw = readFileSync(
    new URL(import.meta.resolve(`simple-icons/icons/${icon.slug}.svg`)),
    "utf8",
  );
  const ink = isGrayscaleHex(icon.hex) ? "currentColor" : `#${icon.hex}`;
  const colored = raw.replace("<svg ", `<svg fill="${ink}" `);
  const sanitized = sanitizeProviderLogo(colored);
  logoCache.set(cacheKey, sanitized);
  return sanitized;
}

function brandCandidates(name: string, operator?: string): readonly string[] {
  const values = [name, operator].filter(
    (value): value is string =>
      typeof value === "string" && value.trim() !== "",
  );
  const candidates = values.flatMap((value) => {
    const withoutConnectorSuffix = value.replace(
      /\s+(?:mcp(?:\s+server)?|connector|integration|api)$/i,
      "",
    );
    const withoutAccountSuffix =
      withoutConnectorSuffix.split(/\s+·\s+/, 1)[0] ?? withoutConnectorSuffix;
    const withoutParentBrand = withoutAccountSuffix.replace(
      /^(?:google|microsoft|atlassian|salesforce)\s+/i,
      "",
    );
    return [
      value,
      withoutConnectorSuffix,
      withoutAccountSuffix,
      withoutParentBrand,
    ].map(normalizeBrandName);
  });
  return [...new Set(candidates.filter(Boolean))];
}

function normalizeBrandName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isGrayscaleHex(hex: string): boolean {
  const normalized = hex.replace(/^#/, "").toUpperCase();
  return (
    /^[0-9A-F]{6}$/.test(normalized) &&
    normalized.slice(0, 2) === normalized.slice(2, 4) &&
    normalized.slice(2, 4) === normalized.slice(4, 6)
  );
}
