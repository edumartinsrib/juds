import { forwardRef } from "react";
import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

import { cn } from "../../lib/cn";
import type { ClassName } from "../../lib/cn";

export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  children: ReactNode;
  className?: ClassName;
}) {
  return (
    <div className={cn("v-stack gap-2", className)}>
      <label className={cn("text-sm font-semibold text-foreground")} htmlFor={htmlFor}>
        {label}
        {required ? <span className={cn("text-danger")}> *</span> : null}
      </label>
      {children}
      {hint && !error ? <p className={cn("text-xs leading-5 text-muted")}>{hint}</p> : null}
      {error ? (
        <p className={cn("text-sm text-danger")} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn("ui-input", className)} {...props} />;
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, ...props }, ref) {
    return <select ref={ref} className={cn("ui-input", className)} {...props} />;
  },
);

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={cn("ui-input min-h-28 resize-y", className)} {...props} />;
});
