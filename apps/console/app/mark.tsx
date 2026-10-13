/**
 * The bracket key. Brackets are set notation, and Venue's thesis is that the set of parties
 * who can legally settle is the set the book was projected for.
 *
 * Brackets are lighter than the V - 1.7 against 2.4 - so the letter reads first and the
 * brackets frame it. That ratio holds at every size.
 */
export function Mark({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <g stroke="currentColor" fill="none" strokeLinecap="butt">
        <path d="M8 3.5 H5.6 V20.5 H8" strokeWidth="1.7" />
        <path d="M9.3 3.5 L12 19.4 L14.7 3.5" strokeWidth="2.4" strokeLinejoin="miter" />
        <path d="M16 3.5 H18.4 V20.5 H16" strokeWidth="1.7" />
      </g>
    </svg>
  )
}
