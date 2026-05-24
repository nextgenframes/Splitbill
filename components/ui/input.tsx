import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      className={cn(
        "flex h-11 w-full rounded-xl border bg-background/80 px-3 py-2 text-sm outline-none ring-offset-background transition-all file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:border-slate-300 focus-visible:ring-2 focus-visible:ring-ring/10 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white/5",
        className
      )}
      ref={ref}
      {...props}
    />
  )
);
Input.displayName = "Input";
