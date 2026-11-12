/**
 * Connection lines that carry the artwork's glowing routes out across the open
 * sky to its left, as in the reference design. Drawn in the artwork's own
 * coordinates (the artwork is 100 units wide, 117 tall) so the lines stay
 * attached to its globe at every size; the SVG simply extends 60 units past
 * the artwork's left edge. Decorative only.
 *
 * Everything left of the artwork stays above y = 14 units, which is above the
 * eyebrow line at every desktop width, so no line or node ever crosses text.
 */

// [path, end node or null] — every route starts on a node painted in the
// artwork; a null end runs off the top of the panel.
const ROUTES = [
  ['M18.8 14.8 Q-10 -1 -46 5', [-46, 5]],
  ['M45.4 29.9 Q16 4 -20 10', [-20, 10]],
  ['M73.6 24.9 Q58 4 30 -4', null],
]

export function GlowArcs({ className }) {
  return (
    <svg
      viewBox="-60 0 160 70"
      className={className}
      aria-hidden="true"
      focusable="false"
      overflow="visible"
    >
      <g fill="none" strokeLinecap="round">
        {ROUTES.map(([d], i) => (
          <g key={i}>
            <path
              d={d}
              stroke="#22d3ee"
              strokeOpacity="0.14"
              strokeWidth="5"
              vectorEffect="non-scaling-stroke"
            />
            <path
              d={d}
              stroke="#5eead4"
              strokeOpacity="0.5"
              strokeWidth="1.3"
              vectorEffect="non-scaling-stroke"
            />
            <path
              d={d}
              pathLength="100"
              className="zm-globe-flow"
              stroke="#ecfeff"
              strokeWidth="2"
              strokeDasharray="8 92"
              vectorEffect="non-scaling-stroke"
              style={{ animationDelay: `${(i * -0.9).toFixed(1)}s` }}
            />
          </g>
        ))}
      </g>
      {ROUTES.filter(([, end]) => end).map(([, [x, y]], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r="2.4" fill="#5eead4" fillOpacity="0.2" />
          <circle
            cx={x}
            cy={y}
            r="1.3"
            className="zm-globe-pulse"
            fill="none"
            stroke="#5eead4"
            strokeWidth="1.2"
            vectorEffect="non-scaling-stroke"
            style={{ animationDelay: `${(i * -0.7).toFixed(1)}s` }}
          />
          <circle cx={x} cy={y} r="0.85" fill="#ecfeff" />
        </g>
      ))}
    </svg>
  )
}
