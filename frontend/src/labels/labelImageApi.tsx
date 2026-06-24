import { useEffect, useState, type CSSProperties } from "react";

import apiClient from "../api/client";

export interface LabelImageUploadResult {
  id: string;
  mime: string;
}

export async function uploadLabelImage(file: File): Promise<LabelImageUploadResult> {
  const form = new FormData();
  form.append("file", file);
  const res = await apiClient.post<LabelImageUploadResult>("/labels/images", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return res.data;
}

export function pickImageFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/svg+xml";
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}

interface AuthenticatedLabelImageProps {
  imageId: string;
  alt?: string;
  className?: string;
  style?: CSSProperties;
}

export function AuthenticatedLabelImage({
  imageId,
  alt = "",
  className,
  style,
}: AuthenticatedLabelImageProps) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;

    apiClient
      .get(`/labels/images/${imageId}`, { responseType: "blob" })
      .then((res) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(res.data);
        setSrc(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setSrc(null);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [imageId]);

  if (!src) {
    return (
      <div
        className={className}
        style={{
          ...style,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#f1f5f9",
          color: "#94a3b8",
          fontSize: 10,
        }}
      >
        …
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      draggable={false}
      className={className}
      style={{ objectFit: "contain", display: "block", ...style }}
    />
  );
}
