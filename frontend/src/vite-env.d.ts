interface ImportMetaEnv {

  readonly VITE_API_BASE_URL?: string;

  readonly VITE_CERT_INDEX?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
