import { forwardRef } from "react";
import type { ButtonHTMLAttributes } from "react";

import { cn } from "../../lib/cn";
import type { ClassName } from "../../lib/cn";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "icon";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: ClassName;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", className, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "ui-button",
        {
          "ui-button-primary": variant === "primary",
          "ui-button-ghost": variant === "ghost",
          "ui-button-danger": variant === "danger",
          "ui-button-sm": size === "sm",
          "ui-icon-button": size === "icon",
        },
        className,
      )}
      {...props}
    />
  );
});
