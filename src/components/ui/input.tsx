import { type InputHTMLAttributes, forwardRef } from "react";

type InputVariant = "light" | "dark";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  variant?: InputVariant;
}

const VARIANT_LABEL: Record<InputVariant, string> = {
  light: "text-gray-700",
  dark: "text-slate-200",
};

const VARIANT_INPUT: Record<InputVariant, string> = {
  light:
    "border-gray-300 bg-white text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:ring-blue-500/20 disabled:bg-gray-50 disabled:text-gray-500",
  dark:
    "border-slate-600 bg-slate-900/60 text-slate-100 placeholder:text-slate-500 focus:border-blue-400 focus:ring-blue-400/30 disabled:bg-slate-800 disabled:text-slate-500",
};

export const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    { label, error, className = "", id, variant = "light", ...props },
    ref
  ) => {
    const inputId = id || label?.toLowerCase().replace(/\s/g, "-");

    return (
      <div className="space-y-1">
        {label && (
          <label
            htmlFor={inputId}
            className={`block text-sm font-medium ${VARIANT_LABEL[variant]}`}
          >
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={`block w-full rounded-lg border px-3 py-2
            shadow-sm focus:outline-none focus:ring-2
            ${VARIANT_INPUT[variant]}
            ${error ? "border-red-500 focus:border-red-500 focus:ring-red-500/20" : ""}
            ${className}`}
          {...props}
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    );
  }
);

Input.displayName = "Input";
