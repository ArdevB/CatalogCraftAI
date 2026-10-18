/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional absolute API URL for production, e.g. https://api.example.com/api/v1 */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
