/** SVGs are image resources, never markup in the application's document. */
export function ProviderSvg({ svg }: { readonly svg: string }) {
  const source = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  // A mask preserves theme-aware monochrome marks without injecting SVG.
  const monochrome = svg.includes("currentColor");
  return (
    <img
      alt=""
      className={monochrome ? "provider-svg monochrome" : "provider-svg"}
      src={
        monochrome
          ? "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs="
          : source
      }
      style={
        monochrome
          ? {
              maskImage: `url("${source}")`,
              WebkitMaskImage: `url("${source}")`,
            }
          : undefined
      }
    />
  );
}
