import { ChangeEvent, useRef, useState } from "react";
import PageHeader from "../components/ui/PageHeader";
import Alert from "../components/ui/Alert";
import EmptyState from "../components/ui/EmptyState";
import { Download, Loader2, Upload } from "lucide-react";
import apiClient from "../api/client";

type Product = {
  article: string;
  name: string;
  gtin: string;
  ozonId?: string | null;
};

type ProductApiShape = {
  article?: string;
  sku?: string;
  name?: string;
  title?: string;
  gtin?: string;
  ozonId?: string | null;
  ozon_id?: string | null;
};

type OzonParseXmlResponse = {
  products: ProductApiShape[];
};

type ExcelImportResult = {
  created: number;
  updated: number;
  skipped: number;
};

function mapProduct(raw: ProductApiShape): Product {
  return {
    article: raw.article ?? raw.sku ?? "-",
    name: raw.name ?? raw.title ?? "Без названия",
    gtin: raw.gtin ?? "-",
    ozonId: raw.ozonId ?? raw.ozon_id ?? null,
  };
}

function downloadBlob(blob: Blob, fallbackName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fallbackName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isUploadingXml, setIsUploadingXml] = useState(false);
  const [isDownloadingExcel, setIsDownloadingExcel] = useState(false);
  const [isImportingExcel, setIsImportingExcel] = useState(false);
  const [isTableVisible, setIsTableVisible] = useState(false);
  const [importInfo, setImportInfo] = useState<string | null>(null);
  const excelInputRef = useRef<HTMLInputElement | null>(null);
  const xmlInputRef = useRef<HTMLInputElement | null>(null);

  async function handleXmlUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const formData = new FormData();
    formData.append("file", file);

    setIsUploadingXml(true);
    setError(null);
    setImportInfo(null);
    try {
      const response = await apiClient.post<OzonParseXmlResponse>("/ozon/parse-xml", formData);
      const list = response.data?.products;
      const mapped = Array.isArray(list) ? list.map(mapProduct) : [];
      setProducts(mapped);
      setIsTableVisible(true);
    } catch (requestError) {
      console.error("Failed to parse XML:", requestError);
      setError("Не удалось обработать XML файл от Ozon.");
    } finally {
      setIsUploadingXml(false);
      event.target.value = "";
    }
  }

  async function handleDownloadTemplate() {
    if (products.length === 0) {
      setError("Сначала загрузите XML и получите список товаров.");
      return;
    }

    setIsDownloadingExcel(true);
    setError(null);
    try {
      const items = products.map((p) => ({
        article: p.article,
        name: p.name,
        gtin: p.gtin,
        ozon_id: p.ozonId ?? null,
      }));
      const response = await apiClient.post("/excel/generate-template", { items }, {
        responseType: "blob",
      });
      downloadBlob(response.data as Blob, "ozon_mapping_template.xlsx");
    } catch (requestError) {
      console.error("Failed to generate template:", requestError);
      setError("Не удалось скачать шаблон Excel.");
    } finally {
      setIsDownloadingExcel(false);
    }
  }

  async function handleImportExcel(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const formData = new FormData();
    formData.append("file", file);

    setIsImportingExcel(true);
    setError(null);
    setImportInfo(null);
    try {
      const response = await apiClient.post<ExcelImportResult>("/excel/import-ozon-id", formData);
      const { created, updated, skipped } = response.data;
      setImportInfo(
        `Импорт завершён: создано ${created}, обновлено ${updated}, пропущено ${skipped}. Чтобы подтянуть новые Ozon ID в таблицу, снова загрузите XML.`,
      );
    } catch (requestError) {
      console.error("Failed to import Excel:", requestError);
      setError("Не удалось импортировать файл Excel.");
    } finally {
      setIsImportingExcel(false);
      event.target.value = "";
    }
  }

  return (
    <div className="page-container">
      <PageHeader
        title="Товары и Ozon"
        description="Загрузка XML, сверка данных и массовое обновление Ozon ID."
      />

      {error ? (
        <Alert variant="error" onDismiss={() => setError(null)} className="mb-6">
          {error}
        </Alert>
      ) : null}

      {importInfo ? (
        <Alert variant="success" onDismiss={() => setImportInfo(null)} className="mb-6">
          {importInfo}
        </Alert>
      ) : null}

      <section className="card mb-8 space-y-4 p-6">
        <h2 className="text-lg font-semibold text-forest-950">Загрузка XML от Ozon</h2>
        <p className="text-sm text-sage-600">
          Пример имени файла из личного кабинета:{" "}
          <span className="font-mono text-forest-800">offers_12345678.xml</span>
        </p>

        <button
          type="button"
          onClick={() => xmlInputRef.current?.click()}
          disabled={isUploadingXml}
          className="btn-secondary"
        >
          {isUploadingXml ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
          Загрузить XML от Ozon
        </button>

        <input
          ref={xmlInputRef}
          type="file"
          accept=".xml"
          className="hidden"
          onChange={(event) => void handleXmlUpload(event)}
        />
      </section>

      <section>
        <div className="mb-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void handleDownloadTemplate()}
            disabled={isDownloadingExcel}
            className="btn-primary"
          >
            {isDownloadingExcel ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Download size={16} />
            )}
            Скачать шаблон Excel
          </button>

          <button
            type="button"
            onClick={() => excelInputRef.current?.click()}
            disabled={isImportingExcel}
            className="btn-secondary"
          >
            {isImportingExcel ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
            Импорт Excel (csv, xlsx)
          </button>

          <input
            ref={excelInputRef}
            type="file"
            accept=".csv,.xlsx"
            className="hidden"
            onChange={(event) => void handleImportExcel(event)}
          />
        </div>

        <div className="table-container">
          <table className="table-base min-w-full">
            <thead>
              <tr>
                <th>Артикул</th>
                <th>Наименование</th>
                <th>GTIN</th>
                <th>Ozon ID</th>
              </tr>
            </thead>
            <tbody>
              {!isTableVisible ? (
                <tr>
                  <td colSpan={4}>
                    <EmptyState
                      title="Загрузите XML"
                      description="Загрузите XML файл от Ozon, чтобы увидеть список товаров."
                    />
                  </td>
                </tr>
              ) : null}

              {isTableVisible && products.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-12 text-center text-sage-500">
                    В ответе нет данных по товарам.
                  </td>
                </tr>
              ) : null}

              {products.map((product) => (
                <tr key={`${product.article}-${product.gtin}`}>
                  <td>{product.article}</td>
                  <td>{product.name}</td>
                  <td>{product.gtin}</td>
                  <td>{product.ozonId || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
