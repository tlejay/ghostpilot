interface Props {
  size?: number;
  className?: string;
}

// Inlined version of assets/icon.svg so the about/licenses windows can render
// the icon without depending on the bundled .icns / file paths.
export function GhostIcon({ size = 64, className }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 1024 1024"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <defs>
        <linearGradient id="gp-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#4a2d8a" />
          <stop offset="55%" stopColor="#231246" />
          <stop offset="100%" stopColor="#0c0820" />
        </linearGradient>
        <radialGradient id="gp-aura" cx="0.5" cy="0.45" r="0.55">
          <stop offset="0%" stopColor="#9f7bff" stopOpacity="0.55" />
          <stop offset="60%" stopColor="#6e4dff" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#6e4dff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="gp-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#dcd5ef" />
        </linearGradient>
        <radialGradient id="gp-lens" cx="0.35" cy="0.3" r="0.8">
          <stop offset="0%" stopColor="#9f7bff" />
          <stop offset="55%" stopColor="#3b1f7a" />
          <stop offset="100%" stopColor="#0d0524" />
        </radialGradient>
      </defs>

      <rect x="0" y="0" width="1024" height="1024" rx="228" ry="228" fill="url(#gp-bg)" />
      <ellipse cx="512" cy="470" rx="430" ry="380" fill="url(#gp-aura)" />

      <g transform="translate(512 540)">
        <path
          d="
            M -260 200
            L -260 0
            A 260 260 0 0 1 260 0
            L 260 200
            Q 208 244 156 200
            Q 104 244 52 200
            Q 0 244 -52 200
            Q -104 244 -156 200
            Q -208 244 -260 200
            Z
          "
          fill="url(#gp-body)"
        />

        <path
          d="
            M -252 -50
            Q 0 -78 252 -50
            L 252 -22
            Q 0 -50 -252 -22
            Z
          "
          fill="#1a0f3d"
        />

        <circle
          cx="-110"
          cy="-36"
          r="86"
          fill="url(#gp-lens)"
          stroke="#1a0f3d"
          strokeWidth="10"
        />
        <ellipse cx="-138" cy="-66" rx="28" ry="18" fill="#ffffff" opacity="0.55" />
        <circle cx="-92" cy="-22" r="10" fill="#c5a8ff" opacity="0.7" />

        <circle
          cx="110"
          cy="-36"
          r="86"
          fill="url(#gp-lens)"
          stroke="#1a0f3d"
          strokeWidth="10"
        />
        <ellipse cx="82" cy="-66" rx="28" ry="18" fill="#ffffff" opacity="0.55" />
        <circle cx="128" cy="-22" r="10" fill="#c5a8ff" opacity="0.7" />

        <rect x="-30" y="-44" width="60" height="18" rx="6" fill="#1a0f3d" />

        <ellipse cx="0" cy="100" rx="22" ry="30" fill="#3a2766" />
        <ellipse cx="-200" cy="60" rx="34" ry="14" fill="#ffb4c8" opacity="0.35" />
        <ellipse cx="200" cy="60" rx="34" ry="14" fill="#ffb4c8" opacity="0.35" />
      </g>
    </svg>
  );
}
