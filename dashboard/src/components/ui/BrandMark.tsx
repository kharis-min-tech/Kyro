/**
 * Kyro's brand: the see-through Kharis dove + "KYRO" with a gold K — the same as
 * the welcome page. The dove and text follow the theme (white in dark, navy in light).
 */
export function BrandMark({ size = 32, subtitle = false, large = false }: { size?: number; subtitle?: boolean; large?: boolean }) {
  return (
    <div className={`flex items-center ${large ? "flex-col gap-3" : "gap-2.5"}`}>
      <span aria-hidden className="shrink-0 block"
        style={{ width: size, height: size, background: "var(--text-primary)",
          WebkitMask: "url(/dove.png) center / contain no-repeat", mask: "url(/dove.png) center / contain no-repeat" }} />
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
