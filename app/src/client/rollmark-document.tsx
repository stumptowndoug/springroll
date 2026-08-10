import mermaid from "mermaid";
import { useEffect, useRef, useState } from "react";
import { type MountedRollmark, mountRollmarkDocument } from "rollmark";

import {
  builtInThemes,
  type RollmarkChartColors,
  resolveRollmarkChartColors,
  type ThemeColors,
} from "./themes.ts";

type RollmarkTheme = "light" | "dark";

interface RollmarkPresentation {
  readonly theme: RollmarkTheme;
  readonly colors: RollmarkChartColors;
}

export function RollmarkDocument({ content }: { readonly content: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const presentation = useRollmarkPresentation();

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const container = document.createElement("div");
    container.className = "rollmark-document";
    host.replaceChildren(container);

    let disposed = false;
    let mounted: MountedRollmark | undefined;

    void mountRollmarkDocument(container, content, {
      theme: presentation.theme,
      colors: presentation.colors,
      mermaid,
    })
      .then((next) => {
        if (disposed) next.dispose();
        else mounted = next;
      })
      .catch(() => {
        if (!disposed) container.textContent = "Report could not be rendered.";
      });

    return () => {
      disposed = true;
      mounted?.dispose();
      container.remove();
    };
  }, [content, presentation]);

  return <div ref={hostRef} />;
}

function useRollmarkPresentation(): RollmarkPresentation {
  const [presentation, setPresentation] = useState<RollmarkPresentation>(
    readRollmarkPresentation,
  );

  useEffect(() => {
    const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setPresentation(readRollmarkPresentation());
    const observer = new MutationObserver(update);

    darkQuery.addEventListener("change", update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-appearance", "data-theme", "style"],
    });

    return () => {
      darkQuery.removeEventListener("change", update);
      observer.disconnect();
    };
  }, []);

  return presentation;
}

function readRollmarkPresentation(): RollmarkPresentation {
  const appearance = document.documentElement.dataset.appearance;
  const theme =
    appearance === "light" || appearance === "dark"
      ? appearance
      : window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
  const styles = getComputedStyle(document.documentElement);
  const names = ["bg", "fg", "accent", "run", "ok", "warn", "danger"] as const;
  const values = Object.fromEntries(
    names.map((name) => [name, styles.getPropertyValue(`--${name}`).trim()]),
  ) as unknown as Record<(typeof names)[number], string>;
  const complete = names.every((name) => values[name] !== "");
  const fallback = builtInThemes.find(
    (candidate) => candidate.id === `springroll-${theme}`,
  )?.preview;
  const themeColors = (complete ? values : fallback) as ThemeColors;

  return {
    theme,
    colors: resolveRollmarkChartColors(themeColors),
  };
}
