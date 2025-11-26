import { useState } from "react";
import * as XLSX from "xlsx";
import { PDFDocument } from "pdf-lib";
import { AiOutlineLoading3Quarters } from "react-icons/ai";

import { generatePdfForGroup } from "../utils/utils";

const Files = () => {
  const [excelFile, setExcelFile] = useState<File | null>(null);
  const [groupedData, setGroupedData] = useState<GroupedData>({});
  const [groups, setGroups] = useState<string[]>([]);
  const [processing, setProcessing] = useState(false);
  const [currentProcessingFile, setCurrentProcessingFile] = useState("");

  // ========== 1) Leer Excel y hacer groupBy('n') ==========

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!excelFile) return;

    try {
      const data = await excelFile.arrayBuffer();
      const workbook = XLSX.read(data, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];

      // Convierte la hoja a objetos usando la primera fila como headers
      const rawRows = XLSX.utils.sheet_to_json<RawRow>(sheet, {
        defval: null, // no borrar campos vacíos
      });

      const normalizedRows: TicketRow[] = rawRows.map((r) => ({
        n: r["N°"],
        num_pat: r["NUM PAT"],
        civ: r["CIV"],
        placa: r["PLACA"],
        num_serie: r["NUM SERIE"],
        marca: r["MARCA"],
        tipo: r["TIPO"],
        mod: r["MOD"],
        fecha: r["FECHA"],
        num_folio: r["NUM FOLIO"],
        odometro:
          r["ODOMETRO"] ??
          r["ODÓMETRO"] ??
          r[" ODOMETRO"] ??
          r["ODOMETRO "] ??
          r["ODOMETRO"],
        importe: r[" IMPORTE "] ?? r["IMPORTE"] ?? r["  IMPORTE  "],
        combustible: r["COMBUSTIBLE"],
        chofer: r["CHOFER"],
        recorrido: r["RECORRIDO"],
        observacion: r["OBSERVACION"],
        folio: r["FOLIO"],
        folio_fiscal: r["FOLIO FISCAL"],
      }));

      // groupBy('n') como en Laravel
      const grouped: GroupedData = {};
      for (const row of normalizedRows) {
        const key = row.n;
        if (key == null || key === "") continue;
        const keyStr = String(key);
        if (!grouped[keyStr]) grouped[keyStr] = [];
        grouped[keyStr].push(row);
      }

      setGroupedData(grouped);
      setGroups(Object.keys(grouped));
    } catch (error) {
      console.error("Error al procesar el archivo:", error);
      alert("Hubo un error leyendo el Excel. Revisa la consola.");
    }
  };

  // ========== 3) Unir PDFs de todos los grupos ==========

  async function mergePdfs(pdfBytesArray: Uint8Array[]): Promise<Uint8Array> {
    const merged = await PDFDocument.create();

    for (const pdfBytes of pdfBytesArray) {
      const pdf = await PDFDocument.load(pdfBytes);
      const copiedPages = await merged.copyPages(pdf, pdf.getPageIndices());
      copiedPages.forEach((p) => merged.addPage(p));
    }

    return await merged.save();
  }

  // ========== 4) Generar pega tickets de todos los grupos y descargar ==========

  async function downloadMergedPdf() {
    if (groups.length === 0) {
      alert("Primero procesa un archivo para generar los grupos.");
      return;
    }

    setProcessing(true);

    try {
      const allPdfBytes: Uint8Array[] = [];
      let index = 1;

      for (const groupKey of groups) {
        setCurrentProcessingFile(String(index));

        const rows = groupedData[groupKey];
        if (!rows) {
          index++;
          continue;
        }

        // 👈 AQUÍ va la llamada CORRECTA con 2 parámetros,
        // igual que en tu versión que ya funcionaba:
        const pdfBytes = await generatePdfForGroup(groupKey, rows);

        allPdfBytes.push(pdfBytes);
        index++;
      }

      if (allPdfBytes.length === 0) {
        alert("No se generó ningún PDF. Revisa la consola.");
        return;
      }

      const mergedBytes = await mergePdfs(allPdfBytes);

      //timestamp para nombre único
      const timestamp = new Date().toISOString().replace(/[:.-]/g, "");

      const defaultName = excelFile?.name.split(".")[0] || "pega_tickets";
      const fileName = `${defaultName}_${timestamp}.pdf`;

      // Detectar si estamos dentro de Tauri
      const isTauri =
        "__TAURI_IPC__" in window || "__TAURI_INTERNALS__" in window;

      if (isTauri) {
        const [{ save }, { writeFile }] = await Promise.all([
          import("@tauri-apps/plugin-dialog"),
          import("@tauri-apps/plugin-fs"),
        ]);

        const filePath = await save({
          defaultPath: fileName,
          filters: [
            {
              name: "PDF",
              extensions: ["pdf"],
            },
          ],
        });

        if (!filePath) {
          setProcessing(false);
          return;
        }

        // mergedBytes es Uint8Array → writeFile lo acepta directo
        await writeFile(filePath, mergedBytes);
        alert("PDF guardado correctamente.");
      } else {
        // 👉 Modo navegador: Blob + <a download> como respaldo
        const blob = new Blob([mergedBytes], { type: "application/pdf" });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.URL.revokeObjectURL(url);

        //open in a new tab
        /*  window.open(url, "_blank"); */
      }
    } catch (error) {
      alert("Hubo un error al generar o guardar el PDF. Revisa la consola.");
    } finally {
      setProcessing(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="w-full max-w-xl p-6 bg-white border border-slate-100 rounded-2xl shadow-md">
        {/* Header */}
        <div className="text-center mb-6">
          <h1 className="text-2xl font-semibold text-slate-900">
            Generar PegaTickets
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Sube un archivo de Excel y genera un PDF listo para imprimir.
          </p>
        </div>

        {/* Formulario de carga */}
        {!processing && (
          <form onSubmit={handleSubmit} className="space-y-4 mb-6">
            <label className="flex flex-col items-center justify-center w-full px-4 py-6 border-2 border-dashed border-sky-300 rounded-xl bg-sky-50/40 text-sky-700 cursor-pointer transition hover:bg-sky-50">
              <span className="text-sm font-medium">
                Selecciona archivo Excel
              </span>
              <span className="mt-1 text-xs text-slate-500">
                Formatos permitidos: .xlsx, .xls
              </span>
              <input
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0] || null;
                  setExcelFile(file);
                  setGroupedData({});
                  setGroups([]);
                }}
                required
              />
            </label>

            {excelFile && !processing && (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-slate-800 truncate">
                    {excelFile.name}
                  </span>
                </div>

                <button
                  type="submit"
                  disabled={!excelFile}
                  className="w-full inline-flex items-center justify-center px-4 py-2.5 text-sm font-semibold text-white bg-sky-600 rounded-lg shadow-sm hover:bg-sky-700 disabled:bg-sky-300 disabled:cursor-not-allowed transition"
                >
                  Procesar archivo
                </button>
              </div>
            )}
          </form>
        )}

        {/* Zona de descarga */}
        {groups.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>
                {groups.length} pega ticket
                {groups.length !== 1 && "s"} listo
                {groups.length !== 1 && "s"} para generar
              </span>
            </div>

            <button
              onClick={downloadMergedPdf}
              disabled={processing}
              className="w-full inline-flex items-center justify-center px-4 py-2.5 text-sm font-semibold text-white bg-sky-600 rounded-lg shadow-sm hover:bg-sky-700 disabled:bg-sky-300 disabled:cursor-not-allowed transition"
            >
              {processing ? (
                <>
                  Generando pega ticket {currentProcessingFile} de{" "}
                  {groups.length}
                  <AiOutlineLoading3Quarters className="ml-2 h-4 w-4 animate-spin" />
                </>
              ) : (
                <>Descargar {groups.length} pega ticket(s)</>
              )}
            </button>
          </div>
        )}

        {/* Spinner centrado si está procesando y aún no se muestra botón */}
        {processing && groups.length === 0 && (
          <div className="mt-6 flex justify-center">
            <AiOutlineLoading3Quarters className="h-6 w-6 text-sky-600 animate-spin" />
          </div>
        )}
      </div>
    </div>
  );
};

export default Files;
