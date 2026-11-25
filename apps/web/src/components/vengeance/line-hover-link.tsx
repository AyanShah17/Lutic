import * as React from "react";
import Link, { type LinkProps } from "next/link";
import { cn } from "@/lib/utils";

/**
 * Vengeance UI — LineHoverLink (clean directional underline micro-interaction)
 */
export function LineHoverLink({
  className,
  children,
  ...props
}: LinkProps & {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      className={cn(
        "group relative inline-flex items-center gap-1.5 text-xs font-medium text-foreground transition-colors duration-150 hover:text-primary",
        className
      )}
      {...props}
    >
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">{children}</span>
      <span
        aria-hidden="true"
        className="absolute bottom-0 left-0 h-[1.5px] w-full origin-left scale-x-0 bg-primary transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-x-100 motion-reduce:transition-none"
      />
    </Link>
  );
}
