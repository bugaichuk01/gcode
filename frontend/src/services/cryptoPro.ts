import {
  createDetachedSignature,
  createHash,
  getUserCertificates as getCryptoProCertificates,
  isValidSystemSetup,
} from "crypto-pro";

const PLUGIN_HELP_MESSAGE =
  "Проверьте, подключен ли у вас плагин в браузере (КриптоПро ЭЦП Browser plug-in). Для корректной работы используйте Яндекс Браузер или Chromium GOST";

export type CryptoProPluginStatus = {
  installed: boolean;
  hint?: string;
};

export type UserCertificate = {
  ownerName: string;
  validTo: string;
  thumbprint: string;
};

export type DetachedCmsSignature = {
  format: "detached_cms_base64";
  value: string;
  thumbprint: string;
  signed_at: string;
  metadata: {
    source: "crypto_pro_plugin";
    hash_algorithm: "gost3411_2012_256";
  };
};

function extractReadableCryptoError(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Неизвестная ошибка криптопровайдера";
  const normalizedMessage = message.toLowerCase();

  if (
    normalizedMessage.includes("token") ||
    normalizedMessage.includes("smart card") ||
    normalizedMessage.includes("scard") ||
    normalizedMessage.includes("card") ||
    normalizedMessage.includes("0x8010002e")
  ) {
    return "Не удалось получить доступ к сертификату. Вставьте токен и повторите попытку.";
  }

  if (
    normalizedMessage.includes("expired") ||
    normalizedMessage.includes("validity") ||
    normalizedMessage.includes("истек")
  ) {
    return "Срок действия сертификата истек. Выберите другой сертификат.";
  }

  if (
    normalizedMessage.includes("not found") ||
    normalizedMessage.includes("не найден")
  ) {
    return "Сертификат не найден. Обновите список сертификатов и повторите попытку.";
  }

  return `Ошибка CryptoPro: ${message}`;
}

export async function checkPluginStatus(): Promise<CryptoProPluginStatus> {
  try {
    const installed = await isValidSystemSetup();

    if (!installed) {
      return {
        installed: false,
        hint: PLUGIN_HELP_MESSAGE,
      };
    }

    return { installed: true };
  } catch (error) {
    console.error("CryptoPro plugin check failed:", error);
    return {
      installed: false,
      hint: PLUGIN_HELP_MESSAGE,
    };
  }
}

export async function getUserCertificates(): Promise<UserCertificate[]> {
  try {
    const certificates = await getCryptoProCertificates(true);

    return certificates.map((certificate) => ({
      ownerName: certificate.name,
      validTo: certificate.validTo,
      thumbprint: certificate.thumbprint,
    }));
  } catch (error) {
    throw new Error(extractReadableCryptoError(error));
  }
}

export async function signData(
  thumbprint: string,
  dataToSign: string,
): Promise<DetachedCmsSignature> {
  try {
    const messageHash = await createHash(dataToSign, { encoding: "utf8" });
    const value = await createDetachedSignature(thumbprint, messageHash);
    return {
      format: "detached_cms_base64",
      value,
      thumbprint,
      signed_at: new Date().toISOString(),
      metadata: {
        source: "crypto_pro_plugin",
        hash_algorithm: "gost3411_2012_256",
      },
    };
  } catch (error) {
    throw new Error(extractReadableCryptoError(error));
  }
}
