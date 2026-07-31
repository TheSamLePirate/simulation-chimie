/**
 * The house mark: a bent triatomic molecule (the 104.5° water angle) inscribed in the
 * periodic cell, struck on an instrument bezel. Drawn inline so it inherits the gold
 * gradient and stays crisp at any size.
 */
export function Seal({ size = 46, title }: { size?: number; title?: string }) {
  const ticks = Array.from({ length: 12 }, (_, i) => i * 30);
  return (
    <svg
      className="seal"
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role={title ? "img" : "presentation"}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <defs>
        <linearGradient id="seal-brass" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f3d98a" />
          <stop offset="46%" stopColor="#d6ac55" />
          <stop offset="100%" stopColor="#9c7228" />
        </linearGradient>
        <radialGradient id="seal-field" cx="34%" cy="26%" r="82%">
          <stop offset="0%" stopColor="#101a3a" />
          <stop offset="100%" stopColor="#050811" />
        </radialGradient>
      </defs>

      <circle cx="32" cy="32" r="31" fill="url(#seal-field)" />

      {/* bezel: a double rule with twelve index ticks */}
      <circle cx="32" cy="32" r="30.2" fill="none" stroke="url(#seal-brass)" strokeWidth="1.6" />
      <circle
        cx="32"
        cy="32"
        r="26.4"
        fill="none"
        stroke="#d6ac55"
        strokeOpacity="0.34"
        strokeWidth="0.7"
      />
      <g stroke="#d6ac55" strokeOpacity="0.55" strokeWidth="1.1" strokeLinecap="round">
        {ticks.map((angle) => (
          <line
            key={angle}
            x1="32"
            y1="3.6"
            x2="32"
            y2="7.2"
            transform={`rotate(${angle} 32 32)`}
          />
        ))}
      </g>

      {/* the periodic cell the specimen lives in */}
      <polygon
        points="32,10.6 13.5,21.3 13.5,42.7 32,53.4 50.5,42.7 50.5,21.3"
        fill="none"
        stroke="#d6ac55"
        strokeOpacity="0.28"
        strokeWidth="0.9"
      />

      {/* the specimen: O + 2H, held at 104.5° */}
      <g stroke="url(#seal-brass)" strokeWidth="2.6" strokeLinecap="round">
        <line x1="32" y1="35" x2="20.6" y2="25.9" />
        <line x1="32" y1="35" x2="43.4" y2="25.9" />
      </g>
      <circle cx="20.6" cy="25.9" r="4.1" fill="#f3d98a" />
      <circle cx="43.4" cy="25.9" r="4.1" fill="#f3d98a" />
      <circle cx="32" cy="35" r="7.4" fill="url(#seal-brass)" />
      <circle cx="29.8" cy="32.6" r="2.1" fill="#fff6dc" fillOpacity="0.55" />
    </svg>
  );
}
