// Minimal typings for the untyped encoders loaded on demand.
declare module 'utif' {
    const UTIF: { encodeImage(rgba: ArrayBuffer, width: number, height: number): ArrayBuffer }
    export default UTIF
}

declare module 'gifenc' {
    type Palette = number[][]
    export function GIFEncoder(): {
        writeFrame(index: Uint8Array, width: number, height: number, opts: { palette: Palette }): void
        finish(): void
        bytes(): Uint8Array
    }
    export function quantize(rgba: Uint8ClampedArray, maxColors: number): Palette
    export function applyPalette(rgba: Uint8ClampedArray, palette: Palette): Uint8Array
}
