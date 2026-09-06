/** SVGs are image resources, never markup in the application's document. */
export function ProviderSvg({ svg }: { readonly svg: string }) {
  const source = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  // A mask preserves theme-aware monochrome marks without injecting SVG.
  const monochrome = svg.includes("currentColor");
  if (monochrome) {
    return (
      <span
        aria-hidden="true"
        className="provider-svg monochrome"
        style={{
          maskImage: `url("${source}")`,
          WebkitMaskImage: `url("${source}")`,
        }}
      />
    );
  }
  return <img alt="" className="provider-svg" src={source} />;
}
