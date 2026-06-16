import React from 'react'

type StrokeLinecap = 'inherit' | 'round' | 'butt' | 'square'
type StrokeLinejoin = 'inherit' | 'round' | 'miter' | 'bevel'

interface IconProps
    extends Omit<React.SVGProps<SVGSVGElement>, 'strokeLinecap' | 'strokeLinejoin'> {
    size?: number
    strokeLinecap?: StrokeLinecap
    strokeLinejoin?: StrokeLinejoin
}

function svgProps({
    size = 20,
    className,
    strokeLinecap = 'round',
    strokeLinejoin = 'round',
    ...rest
}: IconProps) {
    return {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.5,
        strokeLinecap,
        strokeLinejoin,
        className,
        ...rest,
    }
}

export function IconX(props: IconProps) {
    return (
        <svg {...svgProps(props)}>
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
        </svg>
    )
}

export function IconDownload(props: IconProps) {
    return (
        <svg {...svgProps(props)}>
            <path d="M12 3v12" />
            <path d="m8 11 4 4 4-4" />
            <path d="M5 19h14" />
        </svg>
    )
}

export function IconTrash(props: IconProps) {
    return (
        <svg {...svgProps(props)}>
            <path d="M6 7h12" />
            <path d="M10 11v6" />
            <path d="M14 11v6" />
            <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
            <path d="M6 7v11a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7" />
        </svg>
    )
}

export function IconFolder(props: IconProps) {
    return (
        <svg {...svgProps(props)}>
            <path d="M3 7.25A1.75 1.75 0 0 1 4.75 5.5h3.36a1.75 1.75 0 0 1 1.24.51l1.28 1.28c.33.33.78.51 1.25.51h7.41A1.75 1.75 0 0 1 21 9.55V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
        </svg>
    )
}

export function IconVideo(props: IconProps) {
    return (
        <svg {...svgProps(props)}>
            <rect x="4" y="6" width="12" height="12" rx="2" />
            <path d="m16 10 4-3v10l-4-3" />
        </svg>
    )
}

export function IconAudio(props: IconProps) {
    return (
        <svg {...svgProps(props)}>
            <path d="M9 18V6l8-2v12" />
            <path d="M5 9v6" />
            <path d="M19 11v2" />
            <circle cx="5" cy="15" r="1.5" />
            <circle cx="19" cy="13" r="1.5" />
        </svg>
    )
}

export function IconImage(props: IconProps) {
    return (
        <svg {...svgProps(props)}>
            <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
            <circle cx="9.5" cy="10" r="1.5" />
            <path d="m7 16 3.5-3 2.5 2 3-3 2 2" />
        </svg>
    )
}

export function IconArrowDown(props: IconProps) {
    return (
        <svg {...svgProps(props)}>
            <path d="M12 4v16" />
            <path d="m6 14 6 6 6-6" />
        </svg>
    )
}

export function IconHourglass(props: IconProps) {
    return (
        <svg {...svgProps(props)}>
            <path d="M7 3h10" />
            <path d="M7 21h10" />
            <path d="M7 3c0 3 4 5 4 9s-4 6-4 9" />
            <path d="M17 3c0 3-4 5-4 9s4 6 4 9" />
        </svg>
    )
}

export function IconChevronDown(props: IconProps) {
    return (
        <svg {...svgProps(props)}>
            <path d="m6 9 6 6 6-6" />
        </svg>
    )
}

export function IconChevronUp(props: IconProps) {
    return (
        <svg {...svgProps(props)}>
            <path d="m18 15-6-6-6 6" />
        </svg>
    )
}

export function IconPlay(props: IconProps) {
    return (
        <svg {...svgProps(props)}>
            <polygon points="6 3 20 12 6 21 6 3" />
        </svg>
    )
}

export function IconSettings(props: IconProps) {
    return (
        <svg {...svgProps(props)}>
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
            <circle cx="12" cy="12" r="3" />
        </svg>
    )
}

export function IconSliders(props: IconProps) {
    return (
        <svg {...svgProps(props)}>
            <line x1="4" x2="4" y1="21" y2="14" />
            <line x1="4" x2="4" y1="6" y2="3" />
            <line x1="12" x2="12" y1="21" y2="12" />
            <line x1="12" x2="12" y1="4" y2="3" />
            <line x1="20" x2="20" y1="21" y2="16" />
            <line x1="20" x2="20" y1="8" y2="3" />
            <line x1="2" x2="6" y1="14" y2="14" />
            <line x1="10" x2="14" y1="12" y2="12" />
            <line x1="18" x2="22" y1="16" y2="16" />
        </svg>
    )
}

export function IconRotate(props: IconProps) {
    return (
        <svg {...svgProps(props)}>
            <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
            <path d="M21 3v5h-5" />
        </svg>
    )
}

export function IconCrop(props: IconProps) {
    return (
        <svg {...svgProps(props)}>
            <path d="M6 2v14a2 2 0 0 0 2 2h14" />
            <path d="M18 22V8a2 2 0 0 0-2-2H2" />
        </svg>
    )
}

export function IconVolume(props: IconProps) {
    return (
        <svg {...svgProps(props)}>
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
        </svg>
    )
}

export function IconCheck(props: IconProps) {
    return (
        <svg {...svgProps(props)}>
            <path d="M20 6 9 17l-5-5" />
        </svg>
    )
}

export function IconSequence(props: IconProps) {
    return (
        <svg {...svgProps(props)}>
            <rect x="2" y="6" width="6" height="8" rx="1" />
            <rect x="9" y="6" width="6" height="8" rx="1" />
            <rect x="16" y="6" width="6" height="8" rx="1" />
            <path d="M5 14v2" />
            <path d="M12 14v2" />
            <path d="M19 14v2" />
        </svg>
    )
}

export function IconRefresh(props: IconProps) {
    return (
        <svg {...svgProps(props)}>
            <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
            <path d="M21 3v5h-5" />
            <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
            <path d="M8 16H3v5" />
        </svg>
    )
}

export function IconTerminal(props: IconProps) {
    return (
        <svg {...svgProps(props)}>
            <polyline points="4 17 10 11 4 5" />
            <line x1="12" x2="20" y1="19" y2="19" />
        </svg>
    )
}

export function IconWand(props: IconProps) {
    return (
        <svg {...svgProps(props)}>
            <path d="M15 4V2" />
            <path d="M15 16v-2" />
            <path d="M8 9h2" />
            <path d="M20 9h2" />
            <path d="M17.8 11.8 19 13" />
            <path d="M15 9h.01" />
            <path d="M17.8 6.2 19 5" />
            <path d="m3 21 9-9" />
            <path d="M12.2 6.2 11 5" />
        </svg>
    )
}
