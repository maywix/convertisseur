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
