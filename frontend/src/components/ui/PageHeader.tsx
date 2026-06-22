import { ReactNode } from "react";
import { FloralHeaderAccent } from "./FloralDecor";

type PageHeaderProps = {
  title: string;
  description?: string;
  actions?: ReactNode;
  compact?: boolean;
};

export default function PageHeader({ title, description, actions, compact }: PageHeaderProps) {
  return (
    <header
      className={`relative overflow-hidden ${compact ? "mb-4" : "mb-6 sm:mb-8"}`}
    >
      <FloralHeaderAccent className="absolute -right-2 -top-2 h-16 w-24 opacity-80 sm:h-20 sm:w-28" />
      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <h1 className="section-title">{title}</h1>
          {description ? <p className="section-subtitle">{description}</p> : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
    </header>
  );
}
