import { useState } from "react";
import * as XLSX from "xlsx";
import { PDFDocument } from "pdf-lib";
import { AiOutlineLoading3Quarters } from "react-icons/ai";

import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { excelSerialToDateString, generatePdfForGroup } from "../utils/utils";

const Files = () => {
  const [excelFile, setExcelFile] = useState<File | null>(null);
  const [groupedData, setGroupedData] = useState<GroupedData>({});
  const [groups, setGroups] = useState<string[]>([]);
  const [processing, setProcessing] = useState(false);
  const [currentProcessingFile, setCurrentProcessingFile] = useState("");
  const [ticketsPerPage, setTicketsPerPage] = useState(2);

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

      const normalizedRows: TicketRow[] = rawRows.map((r) => {
        const rawFecha = r["FECHA"];

        let fecha: string | null = null;
        if (typeof rawFecha === "number") {
          // viene como 45729 → lo convertimos
          fecha = excelSerialToDateString(rawFecha);
        } else if (rawFecha != null) {
          // ya viene como texto "13/03/2025"
          fecha = String(rawFecha);
        }

        return {
          n: r["N°"],
          num_pat: r["NUM PAT"],
          civ: r["CIV"],
          placa: r["PLACA"],
          num_serie: r["NUM SERIE"],
          marca: r["MARCA"],
          tipo: r["TIPO"],
          mod: r["MOD"],
          fecha: fecha,
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
        };
      });

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

        const pdfBytes = await generatePdfForGroup(
          groupKey,
          rows,
          ticketsPerPage
        );

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
        // 👉 Tauri: diálogo nativo y escritura con plugin-fs
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
        const blob = new Blob([mergedBytes.buffer], {
          type: "application/pdf",
        });
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
    <div className="w-full max-w-3xl mx-auto">
      <div className="bg-white rounded-3xl shadow-xl border border-gray-100 overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-8 py-10 text-center">
          <h1 className="text-4xl font-bold text-white mb-2">PegaTickets</h1>
          <p className="text-blue-100 text-lg">
            Genera documentos PDF desde archivos Excel
          </p>
        </div>

        {/* Content */}
        <div className="p-8">
          {/* Configuración */}
          <div className="mb-6 bg-gray-50 rounded-xl p-4 border border-gray-200">
            <div className="flex items-center justify-between">
              <label className="text-sm font-semibold text-gray-700">
                Tickets por página:
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="1"
                  max="3"
                  value={ticketsPerPage}
                  onChange={(e) => setTicketsPerPage(Number(e.target.value))}
                  className="w-16 px-3 py-2 text-center border-2 border-gray-300 rounded-lg font-semibold text-gray-900 focus:border-blue-500 focus:outline-none"
                  disabled={processing || groups.length > 0}
                />
                <span className="text-sm text-gray-500">tickets</span>
              </div>
            </div>
          </div>

          {!processing && (
            <form onSubmit={handleSubmit}>
              <div className="bg-gradient-to-br from-gray-50 to-blue-50 border-2 border-dashed border-blue-300 rounded-2xl p-12 text-center hover:border-blue-400 hover:bg-blue-50 transition-all duration-200">
                <label className="flex flex-col items-center justify-center cursor-pointer">
                  <div className="text-7xl mb-5">📄</div>
                  <span className="text-2xl font-bold text-gray-900 mb-3">
                    Seleccionar archivo Excel
                  </span>
                  <span className="text-base text-gray-600 mb-2">
                    Arrastra tu archivo aquí o haz clic para seleccionar
                  </span>
                  <span className="text-sm text-gray-400">
                    Formatos soportados: .xlsx, .xls
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
              </div>

              {excelFile && !processing && (
                <div className="mt-8 space-y-5">
                  <div className="flex items-center justify-between gap-4 p-6 bg-white rounded-2xl border-2 border-blue-300 shadow-md">
                    <div className="flex items-center gap-4 flex-1 min-w-0">
                      <div className="flex-shrink-0 w-14 h-14 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center shadow-lg">
                        <svg
                          className="w-7 h-7 text-white"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path
                            fillRule="evenodd"
                            d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z"
                            clipRule="evenodd"
                          />
                        </svg>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-lg font-bold text-gray-900 truncate">
                          {excelFile.name}
                        </p>
                        <p className="text-sm text-gray-500">
                          {(excelFile.size / 1024).toFixed(2)} KB
                        </p>
                      </div>
                    </div>
                    <div className="flex-shrink-0">
                      <svg
                        className="w-8 h-8 text-green-500"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path
                          fillRule="evenodd"
                          d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </div>
                  </div>
                  <button
                    type="submit"
                    className="w-full px-8 py-5 text-xl font-bold text-white bg-gradient-to-r from-blue-600 to-blue-700 rounded-2xl hover:from-blue-700 hover:to-blue-800 active:scale-95 transition-all duration-200 shadow-xl hover:shadow-2xl"
                  >
                    ▶️ Procesar archivo
                  </button>
                </div>
              )}
            </form>
          )}

          {groups.length > 0 && (
            <div className="bg-gradient-to-br from-green-50 to-blue-50 border-2 border-green-200 rounded-2xl p-8">
              <div className="flex flex-col items-center text-center">
                <div className="w-16 h-16 mb-4 rounded-full bg-gradient-to-br from-green-500 to-green-600 flex items-center justify-center shadow-lg">
                  <svg
                    className="w-8 h-8 text-white"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                </div>
                <h3 className="text-2xl font-bold text-gray-900 mb-2">
                  ¡Archivo procesado!
                </h3>
                <p className="text-gray-600 mb-6">
                  Se encontraron{" "}
                  <span className="font-bold text-blue-600">
                    {groups.length}
                  </span>{" "}
                  {groups.length === 1 ? "ticket" : "tickets"} para generar
                </p>
                <button
                  onClick={downloadMergedPdf}
                  disabled={processing}
                  className="w-full max-w-sm px-8 py-4 text-lg font-bold text-white bg-gradient-to-r from-blue-600 to-blue-700 rounded-xl hover:from-blue-700 hover:to-blue-800 active:scale-95 transition-all duration-200 shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                >
                  {processing
                    ? `Generando ticket ${currentProcessingFile} de ${groups.length}...`
                    : "⬇️ Descargar PDF"}
                </button>
                {processing && (
                  <div className="flex items-center gap-2 mt-4">
                    <AiOutlineLoading3Quarters className="w-5 h-5 text-blue-600 animate-spin" />
                    <span className="text-sm font-medium text-gray-600">
                      Procesando, por favor espera...
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Files;
