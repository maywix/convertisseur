import type { Grade } from './grade'

/** Color Lab state, kept in App so it survives switching tabs. */
export interface LabState {
    grades: Record<string, Grade>
    lutScope: 'global' | 'per-file'
    globalLut: File | null
    videoFormat: string
    imageFormat: string
    /** Settings signature of each item's last export (see ColorLab). */
    exported: Record<string, string>
}

export const INITIAL_LAB_STATE: LabState = {
    grades: {},
    lutScope: 'global',
    globalLut: null,
    videoFormat: 'mp4',
    imageFormat: 'jpg',
    exported: {},
}
