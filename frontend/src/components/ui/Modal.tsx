import { ReactNode, useEffect } from "react";
import { X } from "lucide-react";

type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  size?: "md" | "lg" | "full";
  footer?: ReactNode;
};

export default function Modal({
  open,
  onClose,
  title,
  description,
  children,
  size = "md",
  footer,
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handler);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  const panelClass =
    size === "full"
      ? "fixed inset-0 z-50 flex flex-col bg-white animate-fade-in"
      : size === "lg"
        ? "modal-panel-lg"
        : "modal-panel";

  if (size === "full") {
    return (
      <div className={panelClass} role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div className="flex items-center gap-3 border-b border-forest-100 bg-gradient-to-r from-forest-800 to-forest-700 px-4 py-3 text-white sm:px-6">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 transition hover:bg-white/10"
            aria-label="Закрыть"
          >
            <X className="h-5 w-5" />
          </button>
          <div>
            <h2 id="modal-title" className="font-semibold">
              {title}
            </h2>
            {description ? <p className="text-sm text-forest-100">{description}</p> : null}
          </div>
        </div>
        <div className="flex-1 overflow-hidden">{children}</div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div
        className={panelClass}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 id="modal-title" className="text-lg font-semibold text-forest-950">
              {title}
            </h2>
            {description ? (
              <p className="mt-1 text-sm text-sage-600">{description}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-sage-500 transition hover:bg-forest-50 hover:text-forest-800"
            aria-label="Закрыть"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div>{children}</div>
        {footer ? <div className="mt-6 flex justify-end gap-2 border-t border-forest-50 pt-4">{footer}</div> : null}
      </div>
    </div>
  );
}
