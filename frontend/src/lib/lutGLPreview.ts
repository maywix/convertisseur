// ──────────────────────────────────────────────────────────
// Live WebGL2 LUT preview: pulls frames from a <video>, applies a 3D LUT in
// a fragment shader, and paints to a <canvas>. Cheap on GPU even at 1080p.
//
// Usage:
//   const r = createLutRenderer(canvas, video)
//   r.setLut(lutData) // Lut3D or null
//   r.setExtraFilter({ exposure, contrast, saturation, ... })  // optional
//   r.start()  // begin rAF loop
//   r.stop()   // when component unmounts
// ──────────────────────────────────────────────────────────
import type { Lut3D } from './cubeLut'

export interface ExtraFilter {
    brightness: number  // additive on RGB, -1..1
    contrast: number    // multiplicative, 0..2 (1 = neutral)
    saturation: number  // 0..3 (1 = neutral)
    hueDeg: number      // -180..180
    vignette: number    // 0..1
}

const VS = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = vec2((a_pos.x + 1.0) * 0.5, 1.0 - (a_pos.y + 1.0) * 0.5);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`

const FS = `#version 300 es
precision highp float;
precision highp sampler3D;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_video;
uniform sampler3D u_lut;
uniform bool u_lutEnabled;
uniform float u_brightness;
uniform float u_contrast;
uniform float u_saturation;
uniform float u_hueDeg;
uniform float u_vignette;

vec3 applyHue(vec3 c, float deg) {
  float rad = radians(deg);
  float ca = cos(rad);
  float sa = sin(rad);
  // Rotation matrix for hue (luma-preserving).
  mat3 m = mat3(
    0.213 + ca * 0.787 - sa * 0.213, 0.715 - ca * 0.715 - sa * 0.715, 0.072 - ca * 0.072 + sa * 0.928,
    0.213 - ca * 0.213 + sa * 0.143, 0.715 + ca * 0.285 + sa * 0.140, 0.072 - ca * 0.072 - sa * 0.283,
    0.213 - ca * 0.213 - sa * 0.787, 0.715 - ca * 0.715 + sa * 0.715, 0.072 + ca * 0.928 + sa * 0.072
  );
  return clamp(m * c, 0.0, 1.0);
}

void main() {
  vec4 src = texture(u_video, v_uv);
  vec3 col = src.rgb;

  if (u_lutEnabled) {
    // sampler3D handles trilinear with linear filtering.
    col = texture(u_lut, col).rgb;
  }

  // Brightness (additive).
  col += u_brightness;

  // Contrast around 0.5.
  col = (col - 0.5) * u_contrast + 0.5;

  // Saturation (mix toward luma).
  float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(luma), col, u_saturation);

  // Hue.
  if (abs(u_hueDeg) > 0.01) col = applyHue(col, u_hueDeg);

  // Vignette.
  if (u_vignette > 0.001) {
    vec2 c = v_uv - 0.5;
    float dist = length(c);
    float vig = smoothstep(0.4, 0.9, dist) * u_vignette;
    col *= (1.0 - vig * 0.85);
  }

  fragColor = vec4(clamp(col, 0.0, 1.0), src.a);
}
`

function createShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
    const s = gl.createShader(type)!
    gl.shaderSource(s, src)
    gl.compileShader(s)
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(s)
        gl.deleteShader(s)
        throw new Error(`shader compile error: ${log}`)
    }
    return s
}

function createProgram(gl: WebGL2RenderingContext): WebGLProgram {
    const vs = createShader(gl, gl.VERTEX_SHADER, VS)
    const fs = createShader(gl, gl.FRAGMENT_SHADER, FS)
    const p = gl.createProgram()!
    gl.attachShader(p, vs)
    gl.attachShader(p, fs)
    gl.linkProgram(p)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        const log = gl.getProgramInfoLog(p)
        throw new Error(`program link error: ${log}`)
    }
    return p
}

export interface LutRenderer {
    setLut(lut: Lut3D | null): void
    setExtraFilter(f: Partial<ExtraFilter>): void
    start(): void
    stop(): void
    resize(): void
}

const DEFAULT_FILTER: ExtraFilter = {
    brightness: 0, contrast: 1, saturation: 1, hueDeg: 0, vignette: 0,
}

export function createLutRenderer(canvas: HTMLCanvasElement, video: HTMLVideoElement): LutRenderer | null {
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, antialias: true })
    if (!gl) {
        console.warn('[lut-preview] WebGL2 indisponible — preview LUT live désactivée')
        return null
    }

    const program = createProgram(gl)
    gl.useProgram(program)

    // Full-screen triangle (we use 2 tris for simplicity).
    const vao = gl.createVertexArray()!
    gl.bindVertexArray(vao)
    const buf = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const aPos = gl.getAttribLocation(program, 'a_pos')
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)

    // Video texture (refreshed each frame).
    const videoTex = gl.createTexture()!
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, videoTex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

    // LUT 3D texture, allocated lazily when a LUT is set.
    let lutTex: WebGLTexture | null = null
    let lutEnabled = false

    // Uniforms
    const uVideo = gl.getUniformLocation(program, 'u_video')
    const uLut = gl.getUniformLocation(program, 'u_lut')
    const uLutEn = gl.getUniformLocation(program, 'u_lutEnabled')
    const uBri = gl.getUniformLocation(program, 'u_brightness')
    const uCon = gl.getUniformLocation(program, 'u_contrast')
    const uSat = gl.getUniformLocation(program, 'u_saturation')
    const uHue = gl.getUniformLocation(program, 'u_hueDeg')
    const uVig = gl.getUniformLocation(program, 'u_vignette')
    gl.uniform1i(uVideo, 0)
    gl.uniform1i(uLut, 1)

    let extra: ExtraFilter = { ...DEFAULT_FILTER }
    let rafId = 0
    let running = false

    function uploadLut(lut: Lut3D) {
        const { size, data } = lut
        if (!lutTex) {
            lutTex = gl!.createTexture()!
        }
        gl!.activeTexture(gl!.TEXTURE1)
        gl!.bindTexture(gl!.TEXTURE_3D, lutTex)
        gl!.texParameteri(gl!.TEXTURE_3D, gl!.TEXTURE_MIN_FILTER, gl!.LINEAR)
        gl!.texParameteri(gl!.TEXTURE_3D, gl!.TEXTURE_MAG_FILTER, gl!.LINEAR)
        gl!.texParameteri(gl!.TEXTURE_3D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE)
        gl!.texParameteri(gl!.TEXTURE_3D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE)
        gl!.texParameteri(gl!.TEXTURE_3D, gl!.TEXTURE_WRAP_R, gl!.CLAMP_TO_EDGE)
        // Pack to RGBA32F (RGB32F isn't always renderable but OK for sampling here).
        gl!.texImage3D(
            gl!.TEXTURE_3D, 0, gl!.RGB32F,
            size, size, size, 0,
            gl!.RGB, gl!.FLOAT, data,
        )
    }

    function resize() {
        const dpr = Math.min(2, window.devicePixelRatio || 1)
        const w = Math.floor(canvas.clientWidth * dpr)
        const h = Math.floor(canvas.clientHeight * dpr)
        if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w
            canvas.height = h
            gl!.viewport(0, 0, w, h)
        }
    }

    function render() {
        if (!running) return
        try {
            if (video.readyState >= 2 && video.videoWidth > 0) {
                gl!.activeTexture(gl!.TEXTURE0)
                gl!.bindTexture(gl!.TEXTURE_2D, videoTex)
                gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGB, gl!.RGB, gl!.UNSIGNED_BYTE, video)

                resize()

                gl!.useProgram(program)
                gl!.uniform1i(uLutEn, lutEnabled ? 1 : 0)
                gl!.uniform1f(uBri, extra.brightness)
                gl!.uniform1f(uCon, extra.contrast)
                gl!.uniform1f(uSat, extra.saturation)
                gl!.uniform1f(uHue, extra.hueDeg)
                gl!.uniform1f(uVig, extra.vignette)

                gl!.bindVertexArray(vao)
                gl!.drawArrays(gl!.TRIANGLES, 0, 3)
            }
        } catch (e) {
            // Some browsers throw on certain video frame states — skip & retry next frame.
            console.warn('[lut-preview] frame skip:', e)
        }
        rafId = requestAnimationFrame(render)
    }

    return {
        setLut(lut: Lut3D | null) {
            if (lut) {
                uploadLut(lut)
                lutEnabled = true
            } else {
                lutEnabled = false
            }
        },
        setExtraFilter(f: Partial<ExtraFilter>) {
            extra = { ...extra, ...f }
        },
        start() {
            if (running) return
            running = true
            render()
        },
        stop() {
            running = false
            if (rafId) cancelAnimationFrame(rafId)
        },
        resize,
    }
}

// Helpers to convert our generic Grade values into the small filter shader uniforms.
export function gradeToExtraFilter(g: {
    exposure: number; contrast: number; saturation: number; hue: number; tint: number; vignette: number;
}): ExtraFilter {
    return {
        brightness: g.exposure * 0.25,
        contrast: Math.max(0, Math.min(2, 1 + g.contrast / 100)),
        saturation: Math.max(0, Math.min(3, 1 + g.saturation / 100)),
        hueDeg: g.hue + g.tint * 0.45,
        vignette: Math.max(0, Math.min(1, g.vignette / 100)),
    }
}
