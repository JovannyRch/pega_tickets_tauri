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
    <div className="max-w-2xl p-6 mx-auto my-8 bg-white rounded-md shadow-md">
      <h1 className="mb-4 text-2xl font-semibold text-center text-gray-700">
        Generar PegaTickets
      </h1>

      {!processing && (
        <form onSubmit={handleSubmit} className="mb-6">
          <div className="flex items-center justify-center">
            <label className="flex flex-col items-center w-full px-4 py-6 tracking-wide text-blue-500 uppercase transition duration-300 ease-in-out bg-white border border-blue-500 rounded-lg shadow-lg cursor-pointer hover:bg-blue-500 hover:text-white">
              <span className="mt-2 text-base leading-normal">
                Selecciona archivo Excel
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
            <>
              <h1 className="mt-4 mb-2 text-2xl font-bold text-gray-700">
                {excelFile.name}
              </h1>
              <button
                type="submit"
                disabled={!excelFile}
                className="w-full px-4 py-2 mt-4 font-semibold text-white transition duration-300 ease-in-out bg-blue-500 rounded-lg shadow-md hover:bg-blue-600"
              >
                Procesar Archivo
              </button>
            </>
          )}
        </form>
      )}

      {groups.length > 0 && (
        <>
          <div className="flex justify-center mb-4">
            <button
              onClick={downloadMergedPdf}
              disabled={processing}
              className="px-3 py-1 text-sm font-medium text-white transition duration-300 ease-in-out bg-green-500 rounded-md hover:bg-green-600"
            >
              {processing
                ? `Generando pega ticket ${currentProcessingFile} de ${groups.length}`
                : `Descargar ${groups.length} pega tickets`}
            </button>
          </div>
          <div className="flex justify-center mb-4">
            {processing && (
              <AiOutlineLoading3Quarters className="inline-block w-6 h-6 ml-2 animate-spin" />
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default Files;
