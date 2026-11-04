"use client";

import { useEffect } from "react";
import { Laptop, Smartphone, Tablet, Users as UsersIcon } from "lucide-react";
import { usePresenceHeartbeat, useWhoIsHere, agoWords, type HereUser, type WhoIsHere } from "@/lib/presence";
import { isEdgeLive, edgeTokenPayload } from "@/lib/edgeAuth";

/** Mounted once for the whole site: tells the server this browser is here. */
export function PresenceHeartbeat() {
  usePresenceHeartbeat();
  return null;
}

const ICONS = { phone: Smartphone, tablet: Tablet, computer: Laptop } as const;

function DeviceIcon({ kind }: { kind: string }) {
  const I = ICONS[kind as keyof typeof ICONS] ?? Laptop;
  return <I size={12} />;
}

function Dot({ on }: { on: boolean }) {
  return (
    <span className="inline-block w-2 h-2 rounded-full shrink-0"
      style={{ background: on ? "#22c55e" : "var(--text-faint)", boxShadow: on ? "0 0 0 3px rgba(34,197,94,0.15)" : "none" }} />
  );
}

/**
 * "Who's on Kyro now" — every account signed in at this moment, and how many
 * browsers each one is signed in from. Administrators only.
 */
export function WhoIsOnKyro({ onLoad }: { onLoad?: (here: WhoIsHere) => void }) {
  const me = edgeTokenPayload();
  const here = useWhoIsHere(isEdgeLive() && me?.role === "admin");
  useEffect(() => { if (here) onLoad?.(here); }, [here, onLoad]);
  if (!isEdgeLive() || me?.role !== "admin") return null;

  const users = here?.users ?? [];
  const total = here?.sessions ?? 0;

  return (
    <div className="rounded-2xl overflow-hidden mb-8"
      style={{ background: "var(--bg-card)", border: "1px solid var(--border-subtle)" }}>
      <div className="px-5 py-4 flex items-center gap-2.5" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
        <UsersIcon size={15} style={{ color: "#818cf8" }} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Who&apos;s on Kyro now</p>
          <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
            {here === null
              ? "Checking…"
              : users.length === 0
                ? "Nobody else is signed in right now"
                : `${users.length} ${users.length === 1 ? "person" : "people"} signed in, on ${total} ${total === 1 ? "device" : "devices"}`}
          </p>
        </div>
      </div>

      {users.map((u: HereUser, i: number) => {
        const isMe = u.username === me?.sub;
        return (
          <div key={u.username} className="px-5 py-3 flex flex-wrap items-center gap-3"
            style={i > 0 ? { borderTop: "1px solid var(--border-subtle)" } : {}}>
            <Dot on />
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium truncate" style={{ color: "var(--text-primary)" }}>{u.name}</p>
                {isMe && (
                  <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: "rgba(99,102,241,0.18)", color: "#6366f1" }}>you</span>
                )}
                <span className="text-xs font-mono" style={{ color: "var(--text-faint)" }}>{u.username}</span>
              </div>
              <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                {u.sessions === 1 ? "On 1 device" : `On ${u.sessions} devices at once`}
                {u.role === "admin" ? " · administrator" : ""}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {u.devices.map((d, k) => (
                <span key={k} className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg"
                  style={{ background: "var(--bg-hover)", color: "var(--text-secondary)" }}
                  title={`Last heard from ${agoWords(d.seconds_ago)}`}>
                  <DeviceIcon kind={d.kind} />
                  {isMe && k === 0 && u.devices.length > 1 ? "this one" : d.kind}
                </span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * The green/grey dot and device count beside one name in the users list, so an
 * admin can see at a glance who is on and from how many places.
 *
 * Takes the list as a prop rather than asking for it: one page shows a row per
 * user, and each row fetching separately would ask the server a dozen times
 * over for the same answer.
 */
export function UserPresence({ here, username }: { here: WhoIsHere | null; username: string }) {
  if (!here) return null;
  const u = here.users.find((x) => x.username === username);
  return (
    <span className="flex items-center gap-1.5 text-xs" style={{ color: u ? "#22c55e" : "var(--text-faint)" }}>
      <Dot on={!!u} />
      {u ? (u.sessions === 1 ? "Online" : `Online · ${u.sessions} devices`) : "Offline"}
    </span>
  );
}
