import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium cursor-pointer transition-[color,background-color,border-color,box-shadow,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:translate-y-px disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-paper hover:bg-primary/88",
        destructive: "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90",
        outline:
          "border border-input bg-card text-foreground shadow-paper hover:bg-secondary hover:border-rule",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/70",
        ghost: "text-foreground/80 hover:bg-secondary hover:text-foreground",
        link: "text-link underline-offset-4 hover:underline",
        highlight:
          "bg-highlight text-highlight-foreground shadow-paper hover:brightness-[1.03] hover:shadow-lift",
        ink: "bg-ink text-ink-foreground hover:bg-ink/90 shadow-lift",
        "ink-outline":
          "border border-ink-foreground/25 text-ink-foreground bg-transparent hover:bg-ink-foreground/10",
        paper: "bg-paper text-foreground hover:bg-paper/90 shadow-lift",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        xs: "h-7 rounded px-2 text-xs gap-1.5 [&_svg]:size-3.5",
        lg: "h-11 rounded-md px-6 text-[0.9375rem]",
        icon: "h-9 w-9",
        "icon-sm": "h-7 w-7 [&_svg]:size-3.5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
