import logoImg from "../assets/logo.png";
import marcaImg from "../assets/marca_vertical.png";
import { PDFDocument, PDFImage, PDFPage, StandardFonts, rgb } from "pdf-lib";

// Helper opcional para formatear valores
function formatValue(v: any): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toLocaleDateString();
  return String(v);
}

function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

function formatCurrency(value: number | string | undefined): string {
  if (value == null || value === "") return "";
  const num = typeof value === "string" ? parseFloat(value) : value;
  return num.toLocaleString("es-MX", {
    style: "currency",
    currency: "MXN",
  });
}

export function excelSerialToDateString(serial: number): string {
  // Excel cuenta días desde 1899-12-30
  const excelEpoch = new Date(1899, 11, 30);
  const ms = serial * 24 * 60 * 60 * 1000;
  const date = new Date(excelEpoch.getTime() + ms);

  // Ajusta el formato como lo quieres ver
  return date.toLocaleDateString("es-MX"); // dd/mm/aaaa
}

function addImageToPage(
  page: PDFPage,
  logoImage: PDFImage,
  marcaImage: PDFImage,
  margin: number,
  cursorY: number,
  width: number
) {
  // -------- Marca de agua --------
  const marcaWidth = width * 0.7;
  const marcaHeight = (marcaWidth / marcaImage.width) * marcaImage.height;

  page.drawImage(marcaImage, {
    x: width * 0.63 - marcaWidth / 2,
    y: 0,
    width: marcaWidth,
    height: marcaHeight,
    opacity: 0.08, // semitransparente
  });

  //add other to fill the page in vertical
  page.drawImage(marcaImage, {
    x: width * 0.63 - marcaWidth / 2,
    y: marcaHeight,
    width: marcaWidth,
    height: marcaHeight,
    opacity: 0.08, // semitransparente
  });

  // -------- Logo arriba --------
  const logoWidth = 150;
  const logoHeight = (logoWidth / logoImage.width) * logoImage.height;
  page.drawImage(logoImage, {
    x: margin,
    y: cursorY - logoHeight,
    width: logoWidth,
    height: logoHeight,
  });
}

export async function generatePdfForGroup(
  groupKey: string | number,
  groupRows: TicketRow[],
  ticketsPerPage: number = 2
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const [logoBytes, marcaBytes] = await Promise.all([
    fetch(logoImg).then((res) => res.arrayBuffer()),
    fetch(marcaImg).then((res) => res.arrayBuffer()),
  ]);

  const logoImage = await pdfDoc.embedPng(logoBytes);
  const marcaImage = await pdfDoc.embedPng(marcaBytes);

  const A4: [number, number] = [595.28, 841.89];
  const marginX = 25;
  const marginTop = 40;
  const marginBottom = 30;

  const chunks = chunkArray(groupRows, ticketsPerPage);

  for (const chunk of chunks) {
    const page = pdfDoc.addPage(A4);
    const { width, height } = page.getSize();

    let cursorY = height - marginTop;
    addImageToPage(page, logoImage, marcaImage, marginX, cursorY, width);

    const logoWidth = 150;
    const logoHeight = (logoWidth / logoImage.width) * logoImage.height;

    cursorY -= logoHeight + 10;
    const first = groupRows[0];
    const headerLabels = [
      "FACTURA",
      "CIV",
      "PLACA",
      "SERIE",
      "MARCA",
      "MODELO",
    ];
    const headerValues = [
      formatValue(first?.folio),
      formatValue(first?.civ),
      formatValue(first?.placa),
      formatValue(first?.num_serie),
      formatValue(first?.marca),
      formatValue(first?.mod),
    ];
    const headerWeights = [0.17, 0.12, 0.12, 0.28, 0.19, 0.12];

    const tableWidth = width - marginX * 2;
    const headerLabelHeight = 18;
    const headerValueHeight = 18;

    const headerTop = cursorY;
    const labelsY = headerTop - headerLabelHeight; // fila gris
    const valuesY = labelsY - headerValueHeight; // fila blanca

    let currentX = marginX;

    for (let i = 0; i < headerLabels.length; i++) {
      const colWidth = tableWidth * headerWeights[i];

      // Fila gris (etiqueta)
      page.drawRectangle({
        x: currentX,
        y: labelsY,
        width: colWidth,
        height: headerLabelHeight,
        color: rgb(0.51, 0.51, 0.5),
        borderWidth: 0.5,
        borderColor: rgb(0.7, 0.7, 0.7),
      });

      page.drawText(headerLabels[i], {
        x: currentX + 4,
        y: labelsY + 4,
        size: 9,
        font: fontBold,
        color: rgb(1, 1, 1),
      });

      // Fila blanca (valor)
      page.drawRectangle({
        x: currentX,
        y: valuesY,
        width: colWidth,
        height: headerValueHeight,
        borderWidth: 0.5,
        borderColor: rgb(0.7, 0.7, 0.7),
      });

      page.drawText(headerValues[i] ?? "", {
        x: currentX + 4,
        y: valuesY + 4,
        size: 9,
        font,
        color: rgb(0, 0, 0),
      });

      currentX += colWidth;
    }

    const headerBottomY = valuesY - 8;
    cursorY = headerBottomY;

    // ---------- Cuerpos de tickets ----------
    const cols = chunk.length; // 1, 2 o 3 tickets en esta página
    const bodyTableWidth = width - marginX * 2;
    const bodyColWidth = bodyTableWidth / cols;

    const bodyTop = cursorY;
    const bodyBottom = marginBottom;
    const colHeight = bodyTop - bodyBottom;

    const infoBoxHeight = 55; // recuadro donde va DÍA/FOLIO/ODÓMETRO/CONSUMO

    for (let i = 0; i < cols; i++) {
      const ticket = chunk[i];
      const x = marginX + bodyColWidth * i;

      // Caja grande vacía (toda la columna)
      page.drawRectangle({
        x,
        y: bodyBottom,
        width: bodyColWidth,
        height: colHeight,
        borderWidth: 0.5,
        borderColor: rgb(0.8, 0.8, 0.8),
      });

      if (!ticket) continue;

      // Caja pequeña abajo donde va la info
      const infoBoxY = bodyBottom;
      page.drawRectangle({
        x,
        y: infoBoxY,
        width: bodyColWidth,
        height: infoBoxHeight,
        borderWidth: 0.5,
        borderColor: rgb(0.4, 0.4, 0.4),
      });

      let textY = infoBoxY + 8;
      const lineSpacing = 11;

      const dia = formatValue(ticket.fecha);
      const folioCarga = formatValue(ticket.num_folio);

      const rawOdom =
        (ticket as any).odometro ??
        (ticket as any).ODOMETRO ??
        (ticket as any)["ODÓMETRO"] ??
        (ticket as any)["ODOMETRO"] ??
        "";
      const odometro = formatValue(rawOdom);

      const consumo = formatValue(ticket.importe);

      // Orden correcto
      const pairs: { label: string; value: string }[] = [
        { label: "CONSUMO:", value: formatCurrency(consumo) },
        { label: "ODÓMETRO:", value: odometro },
        { label: "FOLIO:", value: folioCarga },
        { label: "DÍA:", value: dia },
      ];

      for (const { label, value } of pairs) {
        // ancho del label para poner el valor después
        const labelWidth = fontBold.widthOfTextAtSize(label + " ", 9);

        // label en negritas
        page.drawText(label, {
          x: x + 6,
          y: textY,
          size: 9,
          font: fontBold,
          color: rgb(0, 0, 0),
        });

        // valor normal, pegado al label
        page.drawText(value, {
          x: x + 6 + labelWidth,
          y: textY,
          size: 9,
          font,
          color: rgb(0, 0, 0),
        });

        textY += lineSpacing;
      }
    }

    // ---------- índice del grupo ----------
    page.drawText(String(groupKey), {
      x: width - marginX - 10,
      y: marginBottom / 2,
      size: 9,
      font: fontBold,
    });
  }

  return await pdfDoc.save();
}
