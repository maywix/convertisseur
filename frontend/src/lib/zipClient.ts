// Minimal ZIP builder — STORE method only (no compression). Enough for our
// use case since the files we bundle (WebP, JPEG, PNG, MP4, …) are already
// compressed. Avoids pulling in a dependency for ~80 lines of code.

const CRC_TABLE = (() => {
    const t = new Uint32Array(256)
    for (let i = 0; i < 256; i++) {
        let c = i
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
        t[i] = c >>> 0
    }
    return t
})()

function crc32(buf: Uint8Array): number {
    let c = 0xffffffff
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
}

function dosDateTime(d: Date): { time: number; date: number } {
    const time = ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((d.getSeconds() >> 1) & 0x1f)
    const date = (((d.getFullYear() - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0xf) << 5) | (d.getDate() & 0x1f)
    return { time, date }
}

function ensureUniqueName(name: string, used: Set<string>): string {
    if (!used.has(name)) { used.add(name); return name }
    const dot = name.lastIndexOf(".")
    const base = dot > 0 ? name.slice(0, dot) : name
    const ext = dot > 0 ? name.slice(dot) : ""
    let i = 1
    while (used.has(`${base} (${i})${ext}`)) i++
    const out = `${base} (${i})${ext}`
    used.add(out)
    return out
}

export async function buildZipFromBlobs(
    entries: { name: string; blob: Blob }[],
): Promise<Blob> {
    const now = new Date()
    const { time, date } = dosDateTime(now)
    const encoder = new TextEncoder()

    const localParts: Uint8Array[] = []
    const centralParts: Uint8Array[] = []
    let offset = 0
    let count = 0

    const usedNames = new Set<string>()

    for (const entry of entries) {
        const buf = new Uint8Array(await entry.blob.arrayBuffer())
        const crc = crc32(buf)
        const uniqueName = ensureUniqueName(entry.name, usedNames)
        const nameBytes = encoder.encode(uniqueName)

        // Local file header (30 bytes + name)
        const lh = new Uint8Array(30 + nameBytes.length)
        const dv = new DataView(lh.buffer)
        dv.setUint32(0, 0x04034b50, true)   // signature
        dv.setUint16(4, 20, true)            // version
        dv.setUint16(6, 0x0800, true)        // flag: UTF-8
        dv.setUint16(8, 0, true)             // method: STORE
        dv.setUint16(10, time, true)
        dv.setUint16(12, date, true)
        dv.setUint32(14, crc, true)
        dv.setUint32(18, buf.length, true)   // comp size
        dv.setUint32(22, buf.length, true)   // uncomp size
        dv.setUint16(26, nameBytes.length, true)
        dv.setUint16(28, 0, true)            // extra len
        lh.set(nameBytes, 30)

        // Central directory entry (46 bytes + name)
        const cd = new Uint8Array(46 + nameBytes.length)
        const cdv = new DataView(cd.buffer)
        cdv.setUint32(0, 0x02014b50, true)
        cdv.setUint16(4, 20, true)           // version made by
        cdv.setUint16(6, 20, true)           // version needed
        cdv.setUint16(8, 0x0800, true)
        cdv.setUint16(10, 0, true)
        cdv.setUint16(12, time, true)
        cdv.setUint16(14, date, true)
        cdv.setUint32(16, crc, true)
        cdv.setUint32(20, buf.length, true)
        cdv.setUint32(24, buf.length, true)
        cdv.setUint16(28, nameBytes.length, true)
        cdv.setUint16(30, 0, true)
        cdv.setUint16(32, 0, true)
        cdv.setUint16(34, 0, true)
        cdv.setUint16(36, 0, true)
        cdv.setUint32(38, 0, true)           // external attrs
        cdv.setUint32(42, offset, true)      // local header offset
        cd.set(nameBytes, 46)

        localParts.push(lh, buf)
        centralParts.push(cd)
        offset += lh.length + buf.length
        count++
    }

    const centralSize = centralParts.reduce((n, p) => n + p.length, 0)
    const centralOffset = offset

    // End of central directory (22 bytes)
    const eocd = new Uint8Array(22)
    const edv = new DataView(eocd.buffer)
    edv.setUint32(0, 0x06054b50, true)
    edv.setUint16(4, 0, true)                // disk
    edv.setUint16(6, 0, true)                // disk with CD
    edv.setUint16(8, count, true)
    edv.setUint16(10, count, true)
    edv.setUint32(12, centralSize, true)
    edv.setUint32(16, centralOffset, true)
    edv.setUint16(20, 0, true)               // comment len

    return new Blob(
        [...localParts, ...centralParts, eocd],
        { type: "application/zip" },
    )
}

export async function downloadZipFromItems(
    items: { url: string; name: string }[],
    zipName = "converted_files.zip",
): Promise<void> {
    const entries = await Promise.all(
        items.map(async (it) => ({
            name: it.name,
            blob: await (await fetch(it.url)).blob(),
        })),
    )
    const zipBlob = await buildZipFromBlobs(entries)
    const url = URL.createObjectURL(zipBlob)
    const link = document.createElement("a")
    link.href = url
    link.download = zipName
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    setTimeout(() => URL.revokeObjectURL(url), 5000)
}
