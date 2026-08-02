import type { ReactNode } from "react";

/*
 * UI icons in the Lucide/Feather dialect: 24px grid, 2px stroke, round caps
 * and joins, currentColor. Inlined as components so themes tint them and no
 * icon dependency ships. Keep every addition on this same grammar.
 */
function IconBase({
  size,
  children,
}: {
  readonly size: number;
  readonly children: ReactNode;
}) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      role="presentation"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width={size}
    >
      {children}
    </svg>
  );
}

export function PlayIcon({ size = 14 }: { readonly size?: number }) {
  return (
    <IconBase size={size}>
      <polygon points="6 3 20 12 6 21 6 3" />
    </IconBase>
  );
}

export function PauseIcon({ size = 14 }: { readonly size?: number }) {
  return (
    <IconBase size={size}>
      <rect height="16" rx="1" width="4" x="14" y="4" />
      <rect height="16" rx="1" width="4" x="6" y="4" />
    </IconBase>
  );
}

export function PlusIcon({ size = 15 }: { readonly size?: number }) {
  return (
    <IconBase size={size}>
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </IconBase>
  );
}

export function SlidersIcon({ size = 17 }: { readonly size?: number }) {
  return (
    <IconBase size={size}>
      <path d="M21 5h-7" />
      <path d="M10 5H3" />
      <path d="M21 12h-9" />
      <path d="M8 12H3" />
      <path d="M21 19h-5" />
      <path d="M12 19H3" />
      <path d="M14 3v4" />
      <path d="M8 10v4" />
      <path d="M16 17v4" />
    </IconBase>
  );
}

export function ChevronRightIcon({ size = 16 }: { readonly size?: number }) {
  return (
    <IconBase size={size}>
      <path d="m9 18 6-6-6-6" />
    </IconBase>
  );
}
