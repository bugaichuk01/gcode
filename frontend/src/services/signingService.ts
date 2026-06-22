import { createDetachedSignature, createHash } from "crypto-pro";
import {
  checkPluginStatus,
  getUserCertificates as getCryptoProCertificates,
  type UserCertificate,
} from "./cryptoPro";

export type { UserCertificate };

export type CadesPluginApi = {
  CreateObjectAsync: (name: string) => Promise<CadesAsyncObject>;
  CADESCOM_CONTAINER_STORE: number;
  CAPICOM_MY_STORE: string;
  CAPICOM_STORE_OPEN_MAXIMUM_ALLOWED: number;
  CADESCOM_BASE64_TO_BINARY: number;
  CADESCOM_STRING_TO_UCS2LE: number;
  CADESCOM_CADES_BES: number;
};

type CadesAsyncObject = {
  Open?: (...args: unknown[]) => Promise<void>;
  Close?: () => Promise<void>;
  Certificates?: Promise<CadesAsyncObject>;
  Item?: (index: number) => Promise<CadesAsyncObject>;
  propset_Certificate?: (cert: CadesAsyncObject) => Promise<void>;
  propset_CheckCertificate?: (value: boolean) => Promise<void>;
  propset_ContentEncoding?: (value: number) => Promise<void>;
  propset_Content?: (value: string) => Promise<void>;
  SignCades?: (signer: CadesAsyncObject, type: number, detached: boolean) => Promise<string>;
  Count?: Promise<number>;
  SubjectName?: Promise<string>;
  ValidToDate?: Promise<string>;
  Thumbprint?: Promise<string>;
};

export type SigningBackend = "cadesplugin" | "crypto-pro";

declare global {
  interface Window {

    cadesplugin?: Promise<void> & CadesPluginApi;
  }
}

function buildPluginHint(extra?: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const hasGlobal = typeof window.cadesplugin !== "undefined";

  const lines = [
    "На песочнице ЦРПТ window.cadesplugin — это Promise: скрипт cadesplugin_api.js ждёт расширение браузера.",
    "",
    `Сейчас: ${origin || "—"}, window.cadesplugin = ${hasGlobal ? "есть (дождитесь await)" : "нет — проверьте /cadesplugin_api.js в index.html"}.`,
    "",
    "Яндекс Браузер:",
    "1. Расширение «КриптоПро ЭЦП Browser plug-in» включено, доступ к этому сайту разрешён.",
    "2. F12 → await window.cadesplugin — без ошибки.",
    "3. Адрес: http://127.0.0.1:5173 или http://localhost:5173 (как в настройках расширения).",
  ];
  if (extra) {
    lines.push("", extra);
  }
  return lines.join("\n");
}

function parseCertIndex(): number {
  const raw = (import.meta.env.VITE_CERT_INDEX as string | undefined)?.trim();
  if (!raw) return 1;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export async function getCadesPlugin(): Promise<CadesPluginApi> {
  if (typeof window.cadesplugin === "undefined") {
    throw new Error(
      buildPluginHint("Скрипт /cadesplugin_api.js не загружен."),
    );
  }

  try {
    await window.cadesplugin;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(
      buildPluginHint("КриптоПро ЭЦП Browser plug-in не инициализировался: " + msg),
    );
  }

  const api = window.cadesplugin as unknown as CadesPluginApi;

  if (typeof api.CreateObjectAsync !== "function") {
    throw new Error(
      buildPluginHint(
        "CreateObjectAsync недоступен. Установите КриптоПро ЭЦП Browser plug-in " +
          "и КриптоПро CSP, затем разрешите сайту доступ к расширению.",
      ),
    );
  }

  return api;
}

async function signWithCadesPlugin(
  cadesplugin: CadesPluginApi,
  bodyString: string,
  certIndex: number,
): Promise<string> {
  const oStore = await cadesplugin.CreateObjectAsync("CAdESCOM.Store");
  await oStore.Open!(
    cadesplugin.CADESCOM_CONTAINER_STORE,
    cadesplugin.CAPICOM_MY_STORE,
    cadesplugin.CAPICOM_STORE_OPEN_MAXIMUM_ALLOWED,
  );

  const certs = (await oStore.Certificates) as CadesAsyncObject;
  const count = (await certs.Count) ?? 0;
  if (count < 1) {
    await oStore.Close?.();
    throw new Error("В хранилище нет сертификатов для подписи.");
  }
  if (certIndex < 1 || certIndex > count) {
    await oStore.Close?.();
    throw new Error(`Сертификат с индексом ${certIndex} не найден (всего ${count}). Задайте VITE_CERT_INDEX.`);
  }

  const cert = (await certs.Item!(certIndex)) as CadesAsyncObject;

  const oSigner = await cadesplugin.CreateObjectAsync("CAdESCOM.CPSigner");
  await oSigner.propset_Certificate!(cert);
  await oSigner.propset_CheckCertificate!(true);

  const oSignedData = await cadesplugin.CreateObjectAsync("CAdESCOM.CadesSignedData");

  await oSignedData.propset_ContentEncoding!(cadesplugin.CADESCOM_STRING_TO_UCS2LE);
  await oSignedData.propset_Content!(bodyString);

  const signed = await oSignedData.SignCades!(oSigner, cadesplugin.CADESCOM_CADES_BES, true);

  await oStore.Close?.();
  return signed.replace(/[\r\n]/g, "");
}

async function signWithCryptoPro(thumbprint: string, bodyString: string): Promise<string> {
  const hash = await createHash(bodyString, { encoding: "utf8" });
  const signature = await createDetachedSignature(thumbprint, hash);
  return signature.replace(/[\r\n]/g, "");
}

async function listCertsFromCadesPlugin(): Promise<UserCertificate[]> {
  const cadesplugin = await getCadesPlugin();

  const oStore = await cadesplugin.CreateObjectAsync("CAdESCOM.Store");
  await oStore.Open!(
    cadesplugin.CADESCOM_CONTAINER_STORE,
    cadesplugin.CAPICOM_MY_STORE,
    cadesplugin.CAPICOM_STORE_OPEN_MAXIMUM_ALLOWED,
  );

  const certs = (await oStore.Certificates) as CadesAsyncObject;
  const count = (await certs.Count) ?? 0;
  const list: UserCertificate[] = [];

  for (let i = 1; i <= count; i += 1) {
    const cert = (await certs.Item!(i)) as CadesAsyncObject;
    list.push({
      ownerName: (await cert.SubjectName) ?? `Сертификат ${i}`,
      validTo: (await cert.ValidToDate) ?? "",
      thumbprint: ((await cert.Thumbprint) ?? "").replace(/\s/g, ""),
    });
  }

  await oStore.Close?.();
  return list;
}

export async function detectSigningBackend(): Promise<SigningBackend> {
  try {
    await getCadesPlugin();
    return "cadesplugin";
  } catch {
    const status = await checkPluginStatus();
    if (status.installed) {
      return "crypto-pro";
    }
    throw new Error(buildPluginHint(status.hint));
  }
}

export async function ensureSigningReady(): Promise<SigningBackend> {
  return detectSigningBackend();
}

export async function getUserCertificates(): Promise<UserCertificate[]> {
  try {
    return await listCertsFromCadesPlugin();
  } catch (error) {
    console.warn("cadesplugin: сертификаты через API недоступны, пробуем crypto-pro:", error);
  }

  const status = await checkPluginStatus();
  if (!status.installed) {
    throw new Error(buildPluginHint(status.hint));
  }

  return getCryptoProCertificates();
}

async function signBase64WithCadesPlugin(
  cadesplugin: CadesPluginApi,
  bodyBase64: string,
  certIndex: number,
): Promise<string> {
  const oStore = await cadesplugin.CreateObjectAsync("CAdESCOM.Store");
  await oStore.Open!(
    cadesplugin.CADESCOM_CONTAINER_STORE,
    cadesplugin.CAPICOM_MY_STORE,
    cadesplugin.CAPICOM_STORE_OPEN_MAXIMUM_ALLOWED,
  );

  const certs = (await oStore.Certificates) as CadesAsyncObject;
  const count = (await certs.Count) ?? 0;
  if (count < 1) {
    await oStore.Close?.();
    throw new Error("В хранилище нет сертификатов для подписи.");
  }
  if (certIndex < 1 || certIndex > count) {
    await oStore.Close?.();
    throw new Error(`Сертификат с индексом ${certIndex} не найден (всего ${count}). Задайте VITE_CERT_INDEX.`);
  }

  const cert = (await certs.Item!(certIndex)) as CadesAsyncObject;

  const oSigner = await cadesplugin.CreateObjectAsync("CAdESCOM.CPSigner");
  await oSigner.propset_Certificate!(cert);
  await oSigner.propset_CheckCertificate!(true);

  const oSignedData = await cadesplugin.CreateObjectAsync("CAdESCOM.CadesSignedData");
  await oSignedData.propset_ContentEncoding!(cadesplugin.CADESCOM_BASE64_TO_BINARY);
  await oSignedData.propset_Content!(bodyBase64);

  const signed = await oSignedData.SignCades!(oSigner, cadesplugin.CADESCOM_CADES_BES, true);

  await oStore.Close?.();
  return signed.replace(/[\r\n]/g, "");
}

function base64ToUtf8(bodyBase64: string): string {
  const binary = atob(bodyBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

export async function signBodyBase64(
  bodyBase64: string,
  options: { certIndex?: number; thumbprint?: string } = {},
): Promise<string> {
  const certIndex = options.certIndex ?? parseCertIndex();

  try {
    const api = await getCadesPlugin();
    return await signBase64WithCadesPlugin(api, bodyBase64, certIndex);
  } catch (cadesError) {
    console.warn("cadesplugin: base64-подпись недоступна, пробуем crypto-pro:", cadesError);
  }

  let thumbprint = options.thumbprint?.replace(/\s/g, "");
  if (!thumbprint) {
    const certs = await getUserCertificates();
    const pick = certs[certIndex - 1] ?? certs[0];
    thumbprint = pick?.thumbprint;
  }

  if (!thumbprint) {
    throw new Error(buildPluginHint("Не найден сертификат для подписи через crypto-pro."));
  }

  try {
    return await signWithCryptoPro(thumbprint, base64ToUtf8(bodyBase64));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(buildPluginHint(msg));
  }
}

export async function signBody(
  bodyString: string,
  options: { certIndex?: number; thumbprint?: string } = {},
): Promise<string> {
  const certIndex = options.certIndex ?? parseCertIndex();

  try {
    const api = await getCadesPlugin();
    return await signWithCadesPlugin(api, bodyString, certIndex);
  } catch (cadesError) {
    console.warn("cadesplugin: подпись недоступна, пробуем crypto-pro:", cadesError);
  }

  let thumbprint = options.thumbprint?.replace(/\s/g, "");
  if (!thumbprint) {
    const certs = await getUserCertificates();
    const pick = certs[certIndex - 1] ?? certs[0];
    thumbprint = pick?.thumbprint;
  }

  if (!thumbprint) {
    throw new Error(buildPluginHint("Не найден сертификат для подписи через crypto-pro."));
  }

  try {
    return await signWithCryptoPro(thumbprint, bodyString);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(buildPluginHint(msg));
  }
}

export function serializeSuzOrderBody(orderBody: Record<string, unknown>): string {
  return JSON.stringify(orderBody);
}

export type CertificateOption = {
  index: number;
  name: string;
};

function extractCn(subject: string): string {
  return subject.match(/CN=([^,]+)/)?.[1]?.trim() || subject;
}

async function signAttachedWithCadesPlugin(
  cadesplugin: CadesPluginApi,
  challengeData: string,
  certIndex: number,
): Promise<string> {
  const oStore = await cadesplugin.CreateObjectAsync("CAdESCOM.Store");
  await oStore.Open!(
    cadesplugin.CADESCOM_CONTAINER_STORE,
    cadesplugin.CAPICOM_MY_STORE,
    cadesplugin.CAPICOM_STORE_OPEN_MAXIMUM_ALLOWED,
  );

  const certs = (await oStore.Certificates) as CadesAsyncObject;
  const count = (await certs.Count) ?? 0;
  if (count < 1) {
    await oStore.Close?.();
    throw new Error("В хранилище нет сертификатов для подписи.");
  }
  if (certIndex < 1 || certIndex > count) {
    await oStore.Close?.();
    throw new Error(`Сертификат с индексом ${certIndex} не найден (всего ${count}).`);
  }

  const cert = (await certs.Item!(certIndex)) as CadesAsyncObject;

  const oSigner = await cadesplugin.CreateObjectAsync("CAdESCOM.CPSigner");
  await oSigner.propset_Certificate!(cert);
  await oSigner.propset_CheckCertificate!(true);

  const oSignedData = await cadesplugin.CreateObjectAsync("CAdESCOM.CadesSignedData");
  await oSignedData.propset_ContentEncoding!(cadesplugin.CADESCOM_BASE64_TO_BINARY);
  await oSignedData.propset_Content!(btoa(challengeData));

  const signed = await oSignedData.SignCades!(oSigner, cadesplugin.CADESCOM_CADES_BES, false);

  await oStore.Close?.();
  return signed.replace(/[\r\n]/g, "");
}

export async function listCertificateOptions(): Promise<CertificateOption[]> {
  const cadesplugin = await getCadesPlugin();

  const oStore = await cadesplugin.CreateObjectAsync("CAdESCOM.Store");
  await oStore.Open!(
    cadesplugin.CADESCOM_CONTAINER_STORE,
    cadesplugin.CAPICOM_MY_STORE,
    cadesplugin.CAPICOM_STORE_OPEN_MAXIMUM_ALLOWED,
  );

  const certs = (await oStore.Certificates) as CadesAsyncObject;
  const count = (await certs.Count) ?? 0;
  const list: CertificateOption[] = [];

  for (let i = 1; i <= count; i += 1) {
    const cert = (await certs.Item!(i)) as CadesAsyncObject;
    const subject = (await cert.SubjectName) ?? `Сертификат ${i}`;
    list.push({ index: i, name: extractCn(subject) });
  }

  await oStore.Close?.();
  return list;
}

export async function signAuthChallenge(
  challengeData: string,
  certIndex: number = 1,
): Promise<string> {
  const api = await getCadesPlugin();
  return signAttachedWithCadesPlugin(api, challengeData, certIndex);
}

export { parseCertIndex, buildPluginHint };
