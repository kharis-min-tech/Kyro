"use client";

import { useState } from "react";
import { useStreamSrc } from "@/lib/streamToken";
import { MapPin, X } from "lucide-react";
import { useSeatAlertContext, type SeatAlert } from "@/lib/SeatAlertContext";
import { ZoomableImage } from "@/components/ui/ZoomableImage";
import { seatsApi } from "@/lib/api";
import { inDemoMode } from "@/lib/liveMode";

/**
 * Mounted once in the root layout, alongside GlobalReviewOverlay.
 * Shows a stack of compact "Seat X available" cards with a thumbnail —
 * click one to open the full evidence photo with zoom/pan.
 */
/**
 * The evidence photo for a seat alert.
 *
 * Its own component because the URL now has to be FETCHED rather than built.
 * An <img src> cannot carry an Authorization header, so it takes its token in
 * the query string — and a query string is written to the web server's access
 * log, to every proxy in front of it, and to the browser's history. What used
 * to go there was the session token: the key to somebody's whole account, in
 * a log file. It takes a short-lived, watch-only token instead. See
 * lib/streamToken.ts.
 */
function SeatShot({ cameraId, seatId, className, style }: {
  cameraId: string; seatId: string; className?: string; style?: React.CSSProperties;
}) {
  const src = useStreamSrc(() => seatsApi.availableSnapshotUrl(cameraId, seatId), [cameraId, seatId]);
  if (!src) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={`Seat ${seatId} available`} className={className} style={style}
      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
  );
}

/** The same photo, big, for the expanded alert. */
function SeatZoom({ cameraId, seatId }: { cameraId: string; seatId: string }) {
  const src = useStreamSrc(() => seatsApi.availableSnapshotUrl(cameraId, seatId), [cameraId, seatId]);
  if (!src) return null;
  return (
    <ZoomableImage src={src} alt={`Seat ${seatId} available`} maxHeight={420}
      badge={<><MapPin size={9} /> Seat {seatId}</>} />
  );
}

export function GlobalSeatAlertOverlay() {
  const { alerts, dismissAlert } = useSeatAlertContext();
  const [expanded, setExpanded] = useState<SeatAlert | null>(null);

  if (inDemoMode()) return null; // no real seat-alert data in demo mode
  if (alerts.length === 0) return null;

  return (
    <>
      <div className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] left-4 z-40 flex flex-col gap-2 max-w-xs">
        {alerts.map((alert) => (
          <div
            key={alert.alert_id}
            className="rounded-xl overflow-hidden cursor-pointer shadow-lg"
            style={{ background: "var(--bg-base)", border: "1px solid var(--border-strong)" }}
            onClick={() => setExpanded(alert)}
          >
            <div className="relative">
              <SeatShot cameraId={alert.camera_id} seatId={alert.seat_id}
                className="w-full object-cover" style={{ height: 90 }} />
              <button
                onClick={(e) => { e.stopPropagation(); dismissAlert(alert.alert_id); }}
                className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full flex items-center justify-center"
                style={{ background: "rgba(13,15,26,0.85)", color: "var(--text-tertiary)" }}
              >
                <X size={11} />
              </button>
            </div>
            <div className="px-3 py-2 flex items-center gap-2">
              <MapPin size={13} style={{ color: "#4ade80" }} />
              <span className="text-sm text-white font-medium">Seat {alert.seat_id} available</span>
            </div>
          </div>
        ))}
      </div>

      {expanded && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-6"
          style={{ background: "rgba(0,0,0,0.75)" }}
          onClick={() => setExpanded(null)}
        >
          <div
            className="w-full max-w-lg rounded-xl overflow-hidden"
            style={{ background: "var(--bg-base)", border: "1px solid var(--border-strong)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: "1px solid var(--border-strong)" }}>
              <span className="text-sm font-semibold text-white">Seat {expanded.seat_id} — available</span>
              <button onClick={() => setExpanded(null)} className="text-gray-400 hover:text-white">
                <X size={16} />
              </button>
            </div>
            <div className="p-3">
              <SeatZoom cameraId={expanded.camera_id} seatId={expanded.seat_id} />
              <p className="text-xs mt-2" style={{ color: "#6b7280" }}>
                Scroll or pinch to zoom, drag to pan. Photo captured the moment this seat became available.
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
