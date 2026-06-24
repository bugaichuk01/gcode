/** Реестр предопределённых знаков соответствия (canvas / превью в модале). */

export interface SignDefinition {
  key: string;
  label: string;
  asset: string;
}

export const SIGN_REGISTRY: SignDefinition[] = [
  {
    key: "rst_decl",
    label: "Знак соответствия РСТ декларирования",
    asset: "rst_decl.svg",
  },
  { key: "ctr", label: "СТР", asset: "ctr.svg" },
  { key: "rst", label: "Знак соответствия РСТ", asset: "rst.svg" },
  { key: "eac", label: "Знак ЕАС", asset: "eac.svg" },
  { key: "ce", label: "CE", asset: "ce.svg" },
];

const SIGN_BY_KEY = new Map(SIGN_REGISTRY.map((s) => [s.key, s]));

export function resolveSignByKey(key: string): SignDefinition | undefined {
  return SIGN_BY_KEY.get(key);
}

/** URL bundled SVG для canvas и превью в модале. */
export function signSvgUrl(asset: string): string {
  return new URL(`./signs/${asset}`, import.meta.url).href;
}

export function signPreviewUrl(signKey: string): string | undefined {
  const def = resolveSignByKey(signKey);
  return def ? signSvgUrl(def.asset) : undefined;
}
