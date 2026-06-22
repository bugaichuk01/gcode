import { ReactNode } from "react";
import { AlertCircle, CheckCircle2, Info, X, XCircle } from "lucide-react";

type AlertVariant = "error" | "success" | "warning" | "info";

type AlertProps = {
  variant?: AlertVariant;
  children: ReactNode;
  onDismiss?: () => void;
  className?: string;
};

const variantClass: Record<AlertVariant, string> = {
  error: "alert-error",
  success: "alert-success",
  warning: "alert-warning",
  info: "alert-info",
};

const variantIcon: Record<AlertVariant, typeof AlertCircle> = {
  error: XCircle,
  success: CheckCircle2,
  warning: AlertCircle,
  info: Info,
};

export default function Alert({
  variant = "info",
  children,
  onDismiss,
  className = "",
}: AlertProps) {
  const Icon = variantIcon[variant];

  return (
    <div className={`${variantClass[variant]} ${className}`} role="alert">
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="flex-1 leading-relaxed">{children}</div>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 rounded-lg p-1 opacity-60 transition hover:opacity-100"
          aria-label="Закрыть"
        >
          <X className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}
