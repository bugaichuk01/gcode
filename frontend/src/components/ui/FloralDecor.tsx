type FloralDecorProps = {

  variant?: "header" | "empty" | "corner";

  className?: string;

};

export function FloralHeaderAccent({ className = "" }: { className?: string }) {

  return (

    <svg

      className={`pointer-events-none select-none ${className}`}

      viewBox="0 0 120 80"

      fill="none"

      aria-hidden="true"

    >

      <ellipse cx="95" cy="20" rx="18" ry="12" fill="#c7d2fe" opacity="0.45" />

      <ellipse cx="88" cy="18" rx="10" ry="7" fill="#a5b4fc" opacity="0.55" />

      <ellipse cx="102" cy="22" rx="8" ry="6" fill="#818cf8" opacity="0.4" />

      <path

        d="M70 50 Q85 30 95 20 Q100 35 90 45 Q80 55 70 50"

        stroke="#6366f1"

        strokeWidth="1.5"

        fill="none"

        opacity="0.25"

      />

      <circle cx="75" cy="48" r="3" fill="#4338ca" opacity="0.2" />

      <circle cx="82" cy="42" r="2" fill="#818cf8" opacity="0.35" />

    </svg>

  );

}

export function FloralEmptyState({ className = "" }: { className?: string }) {

  return (

    <svg

      className={`mx-auto ${className}`}

      width="120"

      height="100"

      viewBox="0 0 120 100"

      fill="none"

      aria-hidden="true"

    >

      <circle cx="60" cy="55" r="28" fill="#f5f7ff" />

      <ellipse cx="45" cy="42" rx="14" ry="10" fill="#e0e7ff" opacity="0.8" />

      <ellipse cx="60" cy="38" rx="16" ry="11" fill="#c7d2fe" opacity="0.7" />

      <ellipse cx="75" cy="42" rx="14" ry="10" fill="#e0e7ff" opacity="0.8" />

      <ellipse cx="52" cy="36" rx="8" ry="6" fill="#a5b4fc" opacity="0.55" />

      <ellipse cx="68" cy="36" rx="8" ry="6" fill="#a5b4fc" opacity="0.55" />

      <path

        d="M60 50 L60 75"

        stroke="#6366f1"

        strokeWidth="2"

        strokeLinecap="round"

        opacity="0.35"

      />

      <path

        d="M60 60 Q45 58 40 65"

        stroke="#4338ca"

        strokeWidth="1.5"

        fill="none"

        opacity="0.25"

      />

      <path

        d="M60 65 Q75 63 80 70"

        stroke="#4338ca"

        strokeWidth="1.5"

        fill="none"

        opacity="0.25"

      />

    </svg>

  );

}

export function OrganicBlob({ className = "" }: { className?: string }) {

  return (

    <div

      className={`pointer-events-none absolute rounded-full blur-3xl ${className}`}

      aria-hidden="true"

    />

  );

}

export default function FloralDecor({ variant = "header", className = "" }: FloralDecorProps) {

  if (variant === "empty") {

    return <FloralEmptyState className={className} />;

  }

  if (variant === "corner") {

    return (

      <OrganicBlob

        className={`h-64 w-64 bg-forest-200/25 ${className}`}

      />

    );

  }

  return <FloralHeaderAccent className={className} />;

}
