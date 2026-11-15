"use client";

import { useRef, useState, type ReactNode, type WheelEvent, type PointerEvent } from "react";

/**
 * ZoomableImage
 *
 * Scroll-to-zoom, drag-to-pan image viewer with +/- controls. Used for any
 * evidence photo the person needs to inspect closely — flagged review
 * areas, seat-available alerts, etc. Purely a viewer: takes a `src` and
 * renders it; fetching/refreshing that src is the caller's job.
 */
/** How far in the buttons will go. Past this a crop is just big pixels. */
export const MOST_ZOOM = 4;
/** One press of + or −. */
export const ZOOM_STEP = 0.5;

/**
 * Where zooming goes: the TOP of the picture, not the middle.
 *
 * "you are not showing me their face." A picture of a person is taller
 * than it is wide and their face is at the top of it, so zooming about
 * the centre walks away from the one part worth looking at — press + and
 * you get a bigger photograph of somebody's coat.
 *
 * Anchoring at the top means the head stays put and fills more of the
 * frame as it grows, which is what pressing + was for.
 */
const ZOOM_FROM = "center top";

export function ZoomableImage({
  src,
  alt,
  maxHeight = 160,
  badge,
}: {
  src: string;
  alt: string;
  maxHeight?: number;
  /** Optional small label shown top-left, e.g. "Live" or a timestamp. */
  badge?: ReactNode;
}) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragState = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const clampZoom = (z: number) => Math.min(MOST_ZOOM, Math.max(1, z));

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    setZoom((z) => {
      const next = clampZoom(z - e.deltaY * 0.0025);
      if (next === 1) setPan({ x: 0, y: 0 });
      return next;
    });
  };

  const onPointerDown = (e: PointerEvent) => {
    if (zoom <= 1) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    dragState.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y };
    setDragging(true);
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!dragState.current) return;
    const dx = e.clientX - dragState.current.startX;
    const dy = e.clientY - dragState.current.startY;
    setPan({ x: dragState.current.panX + dx, y: dragState.current.panY + dy });
  };
  const onPointerUp = () => { dragState.current = null; setDragging(false); };

  const resetZoom = () => { setZoom(1); setPan({ x: 0, y: 0 }); };

  return (
    <div
      className="relative w-full rounded-lg overflow-hidden select-none"
      style={{ border: "1px solid var(--border-strong)", background: "var(--bg-deep, #0d0f1a)",
               cursor: zoom > 1 ? "grab" : "default", touchAction: "none" }}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        className="w-full h-auto"
        style={{
          maxHeight,
          /**
           * The WHOLE picture, not a middle slice of it.
           *
           * "you are not showing me their face." This was "cover", which
           * fills the box and throws away whatever does not fit. A crop of
           * a person is tall and the box is short and wide, so what it
           * threw away was the top and the bottom — the head and the feet
           * — and what it kept was the torso. Every picture of a person in
           * a question was a photograph of their coat.
           *
           * "contain" fits the whole crop inside the box. It leaves a
           * margin at the sides on a tall picture, which is why there is a
           * dark background behind it, and it means the face is in the
           * picture before anybody touches the zoom.
           */
          objectFit: "contain",
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: ZOOM_FROM,
          transition: dragging ? "none" : "transform 0.08s ease-out",
        }}
        draggable={false}
      />
      {badge && (
        <div className="absolute top-1.5 left-1.5 flex items-center gap-1 px-2 py-0.5 rounded-full text-xs"
          style={{ background: "rgba(13,15,26,0.85)", color: "#a5b4fc" }}>
          {badge}
        </div>
      )}
      {/*
        * Zoom controls.
        *
        * "not working the - and +". They sit inside the element that
        * handles dragging, and once zoomed past 1 that handler took the
        * pointer off them mid-press — so the press never became a click
        * and the buttons did nothing. A button is not a drag; the presses
        * stop here.
        */}
      <div className="absolute bottom-1.5 right-1.5 flex items-center gap-1"
        onPointerDown={(e) => e.stopPropagation()}
        onPointerMove={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}>
        {zoom > 1 && (
          <button
            onClick={resetZoom}
            className="w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-xs font-bold"
            style={{ background: "rgba(13,15,26,0.85)", color: "#a5b4fc" }}
            title="Reset zoom"
          >⟲</button>
        )}
        <button
          onClick={() => setZoom((z) => clampZoom(z - ZOOM_STEP))}
          className="w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-sm font-bold"
          style={{ background: "rgba(13,15,26,0.85)", color: "#a5b4fc" }}
          title="Zoom out"
        >−</button>
        <button
          onClick={() => setZoom((z) => clampZoom(z + ZOOM_STEP))}
          className="w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-sm font-bold"
          style={{ background: "rgba(13,15,26,0.85)", color: "#a5b4fc" }}
          title="Zoom in"
        >+</button>
      </div>
    </div>
  );
}
