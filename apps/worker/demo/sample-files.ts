import { decodeBase64 } from "@std/encoding/base64"

/** A sample file the demo attaches to a note: its bytes and type. */
export interface SampleFile {
  bytes: Uint8Array<ArrayBuffer>
  contentType: string
}

/** A 64 × 48 blue PNG: small, and a real image the store's check accepts. */
const PNG = decodeBase64(
  `iVBORw0KGgoAAAANSUhEUgAAAEAAAAAwCAIAAAAuKetIAAAAQ0lEQVR42u3PQQkAAAgEsGtoJYvZzQp+hcEKLNXzWgQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQErhYrBJEPMfa1qAAAAABJRU5ErkJggg==`,
)

/** A one-page PDF that says `title`. */
function pdf(title: string): Uint8Array<ArrayBuffer> {
  const text = title.replace(/[()\\]/g, ``).slice(0, 60)
  const stream = `BT /F1 18 Tf 72 720 Td (${text}) Tj ET`
  const objects = [
    `<< /Type /Catalog /Pages 2 0 R >>`,
    `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R ` +
    `/Resources << /Font << /F1 5 0 R >> >> >>`,
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`,
  ]
  let body = `%PDF-1.4\n`
  const offsets: number[] = []
  objects.forEach((object, index) => {
    offsets.push(body.length)
    body += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = body.length
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  body += offsets.map((offset) => `${String(offset).padStart(10, `0`)} 00000 n \n`).join(``)
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new TextEncoder().encode(body)
}

/** The bytes of a sample file of `kind`; a PDF names `title` on its page. */
export function sampleFile(kind: `png` | `pdf`, title: string): SampleFile {
  return kind === `png`
    ? { bytes: PNG.slice(), contentType: `image/png` }
    : { bytes: pdf(title), contentType: `application/pdf` }
}
