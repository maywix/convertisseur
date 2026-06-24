// ──────────────────────────────────────────────────────────
// .cube (Adobe 3D LUT) parser + trilinear interpolation applied to
// RGBA pixel buffers in the browser. Single-file, no deps.
//
// Spec recap:
//   - LUT_3D_SIZE N            (typical 16, 17, 25, 32, 33, 64)
//   - DOMAIN_MIN r g b         (default 0 0 0)
//   - DOMAIN_MAX r g b         (default 1 1 1)
//   - Then N*N*N lines of "R G B" floats, indexed [B][G][R] in standard order.
// ──────────────────────────────────────────────────────────

export interface Lut3D {
    size: number
    domainMin: [number, number, number]
    domainMax: [number, number, number]
    /** Flat array length 3 * size^3, stride = R + size*G + size*size*B. */
    data: Float32Array
}

export function parseCubeLut(text: string): Lut3D {
    const lines = text.split(/\r?\n/)
    let size = 0
    const domainMin: [number, number, number] = [0, 0, 0]
    const domainMax: [number, number, number] = [1, 1, 1]
    const tuples: number[] = []

    for (const raw of lines) {
        const line = raw.replace(/#.*$/, '').trim()
        if (!line) continue
        if (line.startsWith('TITLE')) continue
        if (line.startsWith('LUT_3D_SIZE')) {
            size = parseInt(line.split(/\s+/)[1] || '0', 10)
            continue
        }
        if (line.startsWith('LUT_1D_SIZE')) {
            throw new Error('LUT 1D non supporté (utilisez un LUT 3D)')
        }
        if (line.startsWith('DOMAIN_MIN')) {
            const parts = line.split(/\s+/).slice(1).map(parseFloat)
            domainMin[0] = parts[0] ?? 0
            domainMin[1] = parts[1] ?? 0
            domainMin[2] = parts[2] ?? 0
            continue
        }
        if (line.startsWith('DOMAIN_MAX')) {
            const parts = line.split(/\s+/).slice(1).map(parseFloat)
            domainMax[0] = parts[0] ?? 1
            domainMax[1] = parts[1] ?? 1
            domainMax[2] = parts[2] ?? 1
            continue
        }
        // Skip any other unknown header lines that start with a letter.
        if (/^[a-zA-Z]/.test(line)) continue
        const nums = line.split(/\s+/).map(parseFloat)
        if (nums.length >= 3 && nums.every(Number.isFinite)) {
            tuples.push(nums[0], nums[1], nums[2])
        }
    }

    if (size <= 0) throw new Error('LUT_3D_SIZE manquant dans le fichier .cube')
    const expected = size * size * size * 3
    if (tuples.length !== expected) {
        throw new Error(`LUT corrompu : ${tuples.length / 3} échantillons (attendu ${expected / 3})`)
    }
    return {
        size,
        domainMin,
        domainMax,
        data: new Float32Array(tuples),
    }
}

/**
 * Apply a 3D LUT in-place to RGBA bytes using trilinear interpolation.
 * Alpha channel is preserved untouched.
 */
export function applyLutInPlace(rgba: Uint8ClampedArray, lut: Lut3D): void {
    const { size, data, domainMin, domainMax } = lut
    const dr = domainMax[0] - domainMin[0]
    const dg = domainMax[1] - domainMin[1]
    const db = domainMax[2] - domainMin[2]
    const maxIdx = size - 1

    for (let i = 0; i < rgba.length; i += 4) {
        const a = rgba[i + 3]
        if (a === 0) continue

        // Normalised colour values mapped into LUT space.
        const r = ((rgba[i] / 255) - domainMin[0]) / dr * maxIdx
        const g = ((rgba[i + 1] / 255) - domainMin[1]) / dg * maxIdx
        const b = ((rgba[i + 2] / 255) - domainMin[2]) / db * maxIdx

        // Clamp into the grid.
        const rc = r < 0 ? 0 : r > maxIdx ? maxIdx : r
        const gc = g < 0 ? 0 : g > maxIdx ? maxIdx : g
        const bc = b < 0 ? 0 : b > maxIdx ? maxIdx : b

        const r0 = Math.floor(rc), r1 = Math.min(r0 + 1, maxIdx)
        const g0 = Math.floor(gc), g1 = Math.min(g0 + 1, maxIdx)
        const b0 = Math.floor(bc), b1 = Math.min(b0 + 1, maxIdx)
        const rd = rc - r0
        const gd = gc - g0
        const bd = bc - b0

        // Address into flat data (R + size*G + size*size*B) * 3 for the triplet.
        const stride = size
        const ss = size * size
        const idx = (rx: number, gx: number, bx: number) => (rx + gx * stride + bx * ss) * 3

        // 8 corners of the unit cube.
        const c000 = idx(r0, g0, b0)
        const c100 = idx(r1, g0, b0)
        const c010 = idx(r0, g1, b0)
        const c110 = idx(r1, g1, b0)
        const c001 = idx(r0, g0, b1)
        const c101 = idx(r1, g0, b1)
        const c011 = idx(r0, g1, b1)
        const c111 = idx(r1, g1, b1)

        // Trilinear blend, one channel at a time.
        for (let k = 0; k < 3; k++) {
            const v000 = data[c000 + k]
            const v100 = data[c100 + k]
            const v010 = data[c010 + k]
            const v110 = data[c110 + k]
            const v001 = data[c001 + k]
            const v101 = data[c101 + k]
            const v011 = data[c011 + k]
            const v111 = data[c111 + k]

            const v00 = v000 * (1 - rd) + v100 * rd
            const v10 = v010 * (1 - rd) + v110 * rd
            const v01 = v001 * (1 - rd) + v101 * rd
            const v11 = v011 * (1 - rd) + v111 * rd

            const v0 = v00 * (1 - gd) + v10 * gd
            const v1 = v01 * (1 - gd) + v11 * gd

            const v = v0 * (1 - bd) + v1 * bd

            const out = v * 255
            rgba[i + k] = out < 0 ? 0 : out > 255 ? 255 : out
        }
    }
}

export async function loadLutFromFile(file: File): Promise<Lut3D> {
    const text = await file.text()
    return parseCubeLut(text)
}
