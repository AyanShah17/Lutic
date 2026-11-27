import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Exact Lutic brand mascot SVG synced from AyanShah17/Lutic-UI (`components/logo.jsx`).
 */
export function LuticLogo({
  className,
  decorative = true
}: {
  className?: string;
  decorative?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 200 200"
      aria-hidden={decorative ? "true" : undefined}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : "Lutic"}
      className={cn("h-7 w-7 shrink-0", className)}
    >
      <polygon
        points="156.4,120.5 110.4,159.1 54.0,138.6 43.6,79.5 89.6,40.9 146.0,61.4"
        fill="#ee5414"
        stroke="#ee5414"
        strokeWidth="34"
        strokeLinejoin="round"
      />
      <circle cx="100" cy="100" r="52" fill="#101012" />
      <g>
        <ellipse cx="82" cy="106" rx="6.5" ry="8.5" fill="#ffffff" />
      </g>
      <g>
        <ellipse cx="118" cy="97" rx="6.5" ry="8.5" fill="#ffffff" />
      </g>
    </svg>
  );
}
