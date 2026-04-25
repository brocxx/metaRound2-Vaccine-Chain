"use client";

/**
 * Tiny typewriter primitive used by BriefingPanel + ReasoningStream.
 *
 * Reveals `text` character-by-character on a key change. Calls `onDone`
 * when the full string is displayed. `instant` skips the animation
 * (used when the user scrubs back/forth and the panel shouldn't replay).
 */

import { useEffect, useState } from "react";

interface TypewriterProps {
  text: string;
  speedMs?: number;
  /** Forces re-typing when this changes. */
  resetKey?: string | number;
  className?: string;
  /** If true, render the full text immediately. */
  instant?: boolean;
  onDone?: () => void;
  /** Render-prop alternative; receives current visible text. */
  children?: (visible: string, done: boolean) => React.ReactNode;
}

export function Typewriter({
  text,
  speedMs = 18,
  resetKey,
  className,
  instant = false,
  onDone,
  children,
}: TypewriterProps) {
  const [shown, setShown] = useState(instant ? text : "");

  useEffect(() => {
    if (instant) {
      setShown(text);
      onDone?.();
      return;
    }
    setShown("");
    if (!text) return;
    let i = 0;
    const id = window.setInterval(() => {
      i++;
      if (i >= text.length) {
        setShown(text);
        window.clearInterval(id);
        onDone?.();
      } else {
        setShown(text.slice(0, i));
      }
    }, speedMs);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, resetKey, instant, speedMs]);

  if (children) {
    return <>{children(shown, shown.length >= text.length)}</>;
  }
  return <span className={className}>{shown}</span>;
}
