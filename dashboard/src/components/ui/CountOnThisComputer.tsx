"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Monitor, Play, Check, AlertTriangle } from "lucide-react";
import { listCameras } from "@/lib/cameraMode";

/**
 * "Use this computer" — counting with no install.
 *
 * Plug the camera (or a transmitter's capture card) into the computer you're
 * sitting at, press Start, and Kyro counts in the browser. The Camera Mode page
 * does the work; this is the way in from the Cameras page, where people look.
 */
export function CountOnThisComputer({ alreadyCounting }: { alreadyCounting: boolean }) {
  const [found, setFound] = useState<string[] | null>(null);

  // Camera names only appear once the browser has been allowed to use them,
  // so an empty list here doesn't mean there's no camera.
  useEffect(() => {
    let alive = true;
    listCameras()
      .then((cams) => { if (alive) setFound(cams.map((c) => c.label).filter(Boolean)); })
      .catch(() => { if (alive) setFound([]); });
    return () => { alive = false; };
  }, []);

  return (
    <div className="mb-6">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Count with this computer</p>
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <Monitor size={18} className="text-indigo-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-white font-medium">No install needed</p>
            <p className="text-xs text-gray-400 leading-relaxed mt-0.5">
              Plug your camera into <strong>this</strong> computer — straight in, or a wireless transmitter&apos;s receiver through a
              capture card — and press Start. Kyro counts right here in the browser.
            </p>
            {found && found.length > 0 && (
              <p className="text-xs text-gray-500 mt-1.5 flex items-center gap-1">
                <Check size={12} className="text-green-400" /> Plugged in now: {found.join(", ")}
              </p>
            )}
          </div>
          <Link href="/camera-mode?start=1"
            className="shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-500">
            <Play size={14} /> Start counting
          </Link>
        </div>

        <div className="flex items-start gap-2 rounded-lg px-3 py-2" style={{ background: "var(--bg-hover)" }}>
          <AlertTriangle size={13} className="text-amber-400 shrink-0 mt-0.5" />
          <p className="text-xs text-gray-400 leading-relaxed">
            Counting only runs while that page stays open on this computer. Keep the tab open and stop the computer sleeping for
            the whole service. To have it count by itself, with nothing open and after restarts, use a camera computer below.
          </p>
        </div>

        {alreadyCounting && (
          <p className="text-xs text-green-400 flex items-center gap-1"><Check size={12} /> This computer is already counting.</p>
        )}
      </div>
    </div>
  );
}
