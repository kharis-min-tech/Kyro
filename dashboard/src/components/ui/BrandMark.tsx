/**
 * Kyro's brand: the Kharis dove app icon + "KYRO" with a gold K — the same as
 * the welcome page. Text colours follow the theme (light / dark).
 */
export function BrandMark({ size = 32, subtitle = false, large = false }: { size?: number; subtitle?: boolean; large?: boolean }) {
  return (
    <div className={`flex items-center ${large ? "flex-col gap-3" : "gap-2.5"}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icon-192.png" alt="" width={size} height={size} className="shrink-0"
        style={{ width: size, height: size, borderRadius: size * 0.28, boxShadow: "0 1px 2px rgba(0,0,0,0.25)" }} />
      <div className={large ? "text-center" : ""}>
        <span className="block font-black leading-none" style={{ color: "var(--text-primary)", letterSpacing: "-0.02em", fontSize: large ? 30 : 16 }}>
          <span style={{ color: "var(--brand-gold)" }}>K</span>YRO
        </span>
        {subtitle && (
          <span className="block mt-1" style={{ color: "var(--text-muted, #6b7280)", fontSize: large ? 14 : 11 }}>Vision Intelligence</span>
        )}
      </div>
    </div>
  );
}
