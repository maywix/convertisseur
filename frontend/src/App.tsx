import { useEffect, useState } from 'react'
import { ColorLab, type Grade } from '@/components/ColorLab'
import { ConfigPanel, VideoColorSampler } from '@/components/ConfigPanel'
import { FileQueue } from '@/components/FileQueue'
import { SimpleConverter } from '@/components/SimpleConverter'
import { TotalProgress } from '@/components/TotalProgress'
import { IconMenu, IconMoon, IconSun, IconX } from '@/components/icons'
import { useConverter } from '@/hooks/useConverter'
import { getFileType } from '@/types'

const LS_THEME = 'converter_theme'
const LS_PROC_MODE = 'converter_processing_mode'

export type ProcessingMode = 'frontend' | 'backend'

function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      const stored = localStorage.getItem(LS_THEME)
      if (stored === 'light' || stored === 'dark') return stored
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    } catch {
      return 'light'
    }
  })

  const [processingMode, setProcessingModeState] = useState<ProcessingMode>(() => {
    try {
      const stored = localStorage.getItem(LS_PROC_MODE)
      return stored === 'backend' ? 'backend' : 'frontend'
    } catch {
      return 'frontend'
    }
  })

  const setProcessingMode = (m: ProcessingMode) => {
    try { localStorage.setItem(LS_PROC_MODE, m) } catch { void 0 }
    setProcessingModeState(m)
  }

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    try { localStorage.setItem(LS_THEME, theme) } catch { void 0 }
  }, [theme])

  const {
    queue,
    currentAction,
    convertSettings,
    compressSettings,
    isProcessing,
    hasStarted,
    completedCount,
    totalCount,
    hasCompletedFiles,
    canStart,
    detectedTypes,
    outputMode,
    exportMode,
    uiMode,
    backgroundEnabled,
    autoDownloadEnabled,
    addFiles,
    removeFile,
    clearAll,
    startProcessing,
    setOutputMode,
    setExportMode,
    setUiMode,
    setBackgroundEnabled,
    setAutoDownloadEnabled,
    setCurrentAction,
    setCategory,
    setFormat,
    setSimpleFormat,
    setItemTargetFormat,
    setItemCustomAction,
    setItemCustomCompressSettings,
    setItemOutputMode,
    applyGlobalFormatToAll,
    requeueItem,
    setConvertSettings,
    setCompressSettings,
    applySuggestedConvert,
    applySuggestedCompress,
    exportCompletedFiles,
  } = useConverter()

  // Reflect conversion progress in the browser tab title (e.g. "1/3 · 60% — …")
  useEffect(() => {
    const base = 'Convertisseur Studio'
    const anyActive = queue.some(
      (item) =>
        item.status === 'uploading' ||
        item.status === 'queued' ||
        item.status === 'processing',
    )
    if (!anyActive) {
      document.title = base
      return
    }
    const total = queue.length
    const overall = Math.round(
      queue.reduce((sum, item) => {
        if (item.status === 'done') return sum + 100
        if (item.status === 'processing') return sum + (item.progress ?? 0)
        return sum
      }, 0) / Math.max(1, total),
    )
    document.title = `${completedCount}/${total} · ${overall}% — ${base}`
  }, [queue, completedCount])

  const showProgress = hasStarted && totalCount > 0
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  // Close the mobile menu whenever the user changes mode or theme.
  useEffect(() => { setMobileMenuOpen(false) }, [uiMode, processingMode, theme])

  // Color Lab state lifted here so it survives mode switches (Simple ↔ Pro ↔ Color Lab).
  const [colorLabGrades, setColorLabGrades] = useState<Record<string, Grade>>({})
  const [colorLabLutScope, setColorLabLutScope] = useState<'global' | 'per-file'>('global')
  const [colorLabGlobalLutFile, setColorLabGlobalLutFile] = useState<File | null>(null)
  const colorPickerVideoFile =
    queue.find((item) => {
      const kind = item.mediaKind || getFileType(item.file.name)
      return kind === 'video' && item.file.size > 0
    })?.file || null
  const showVideoColorSampler =
    convertSettings.colorRemoveEnabled &&
    (convertSettings.category === 'video' || convertSettings.category === 'sequence')

  return (
    <div className="min-h-screen bg-background text-foreground">
      {showProgress && (
        <TotalProgress
          completed={completedCount}
          total={totalCount}
          isProcessing={isProcessing}
        />
      )}

      <header className="sticky top-0 z-40 border-b border-border/80 bg-background/90 backdrop-blur-xl">
        <div className="mx-auto max-w-[1500px] px-3 sm:px-4 lg:px-6 py-2.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 shrink-0 rounded-lg bg-foreground flex items-center justify-center text-background font-bold text-sm shadow-sm">C</div>
            <div className="min-w-0">
              <h1 className="text-[15px] font-semibold tracking-tight leading-none truncate">Convertisseur Studio</h1>
              <p className="hidden xs:block text-xs text-muted-foreground leading-none mt-1">Vidéo · Audio · Image · Document · 3D</p>
            </div>
          </div>

          {/* ── Desktop controls (md+) ── */}
          <div className="hidden md:flex items-center gap-2 text-xs text-muted-foreground">
            <div
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-2 py-1 shadow-sm"
              title={processingMode === 'frontend'
                ? "Conversion en local dans le navigateur"
                : "Conversion sur le serveur avec FFmpeg / Pillow"}
            >
              <span className={`text-[10px] font-semibold uppercase ${processingMode === 'frontend' ? 'text-primary' : 'text-muted-foreground'}`}>Front</span>
              <button
                type="button"
                role="switch"
                aria-checked={processingMode === 'backend'}
                onClick={() => setProcessingMode(processingMode === 'frontend' ? 'backend' : 'frontend')}
                className="relative inline-flex h-5 w-9 items-center rounded-full bg-muted transition-colors"
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-background shadow transition-transform ${processingMode === 'backend' ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </button>
              <span className={`text-[10px] font-semibold uppercase ${processingMode === 'backend' ? 'text-primary' : 'text-muted-foreground'}`}>Back</span>
            </div>

            <div className="inline-flex items-center rounded-lg border border-border bg-card p-0.5 shadow-sm">
              <button type="button" onClick={() => setUiMode('simple')} className={`inline-flex h-8 items-center rounded-md px-3 text-xs font-semibold transition-colors ${uiMode === 'simple' ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'}`}>Simple</button>
              <button type="button" onClick={() => setUiMode('pro')} className={`inline-flex h-8 items-center rounded-md px-3 text-xs font-semibold transition-colors ${uiMode === 'pro' ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'}`}>Pro</button>
              <button type="button" onClick={() => setUiMode('color-lab')} className={`inline-flex h-8 items-center rounded-md px-3 text-xs font-semibold transition-colors ${uiMode === 'color-lab' ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'}`}>Color Lab</button>
            </div>
            <button
              type="button"
              onClick={() => setTheme((value) => value === 'dark' ? 'light' : 'dark')}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-muted"
              aria-label={theme === 'dark' ? 'Passer au thème clair' : 'Passer au thème sombre'}
            >
              {theme === 'dark' ? <IconSun size={15} /> : <IconMoon size={15} />}
              <span className="hidden lg:inline">{theme === 'dark' ? 'Clair' : 'Sombre'}</span>
            </button>
          </div>

          {/* ── Mobile hamburger ── */}
          <button
            type="button"
            onClick={() => setMobileMenuOpen((v) => !v)}
            className="md:hidden inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-foreground shadow-sm hover:bg-muted"
            aria-label={mobileMenuOpen ? 'Fermer le menu' : 'Ouvrir le menu'}
            aria-expanded={mobileMenuOpen}
          >
            {mobileMenuOpen ? <IconX size={18} /> : <IconMenu size={18} />}
          </button>
        </div>

        {/* ── Mobile menu panel ── */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-border bg-background/95 backdrop-blur-xl animate-in fade-in slide-in-from-top-2 duration-200">
            <div className="px-4 py-4 space-y-3">
              <div>
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Mode d'affichage</p>
                <div className="grid grid-cols-3 gap-1 rounded-lg border border-border bg-card p-0.5 shadow-sm">
                  {(['simple','pro','color-lab'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setUiMode(m)}
                      className={`h-9 rounded-md text-xs font-semibold transition-colors ${uiMode === m ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'}`}
                    >
                      {m === 'simple' ? 'Simple' : m === 'pro' ? 'Pro' : 'Color Lab'}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Lieu de conversion</p>
                <div className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-card p-0.5 shadow-sm">
                  <button type="button" onClick={() => setProcessingMode('frontend')} className={`h-9 rounded-md text-xs font-semibold transition-colors ${processingMode === 'frontend' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'}`}>Front (navigateur)</button>
                  <button type="button" onClick={() => setProcessingMode('backend')} className={`h-9 rounded-md text-xs font-semibold transition-colors ${processingMode === 'backend' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'}`}>Back (serveur)</button>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setTheme((v) => v === 'dark' ? 'light' : 'dark')}
                className="flex w-full items-center justify-between rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-foreground shadow-sm"
              >
                <span>Thème</span>
                <span className="inline-flex items-center gap-1.5">
                  {theme === 'dark' ? <IconSun size={14} /> : <IconMoon size={14} />}
                  {theme === 'dark' ? 'Clair' : 'Sombre'}
                </span>
              </button>
            </div>
          </div>
        )}
      </header>

      {uiMode === 'color-lab' ? (
        <div key="color-lab" className={`animate-in fade-in duration-300 ease-out fill-mode-both ${showProgress ? 'pb-24' : ''}`}>
          <ColorLab
            processingMode={processingMode}
            queue={queue}
            onFilesAdded={addFiles}
            onRemove={removeFile}
            onClearAll={clearAll}
            gradesMap={colorLabGrades}
            setGradesMap={setColorLabGrades}
            lutScope={colorLabLutScope}
            setLutScope={setColorLabLutScope}
            globalLutFile={colorLabGlobalLutFile}
            setGlobalLutFile={setColorLabGlobalLutFile}
          />
        </div>
      ) : uiMode === 'simple' ? (
        <div key="simple" className={`animate-in fade-in slide-in-from-bottom-3 duration-300 ease-out fill-mode-both ${showProgress ? 'pb-24' : ''}`}>
          <SimpleConverter
            queue={queue}
            canStart={canStart}
            isProcessing={isProcessing}
            currentAction={currentAction}
            onFilesAdded={addFiles}
            onRemove={removeFile}
            onRequeue={requeueItem}
            onClearAll={clearAll}
            onStart={startProcessing}
            onSetFormat={setSimpleFormat}
            onSetCurrentAction={setCurrentAction}
            onSetCompressSettings={setCompressSettings}
            onExportCompleted={exportCompletedFiles}
          />
        </div>
      ) : (
      <div key="pro" className={`max-w-[1600px] mx-auto px-4 lg:px-8 py-6 ${showProgress ? 'pb-24' : ''}`}>
        <div className="grid lg:grid-cols-[440px_minmax(0,1fr)] gap-8 items-start">
          <div className="order-2 lg:order-1 animate-in fade-in slide-in-from-left-6 duration-500 ease-out fill-mode-both">
            <ConfigPanel
              currentAction={currentAction}
              onActionChange={setCurrentAction}
              convertSettings={convertSettings}
              compressSettings={compressSettings}
              onConvertSettingsChange={setConvertSettings}
              onCompressSettingsChange={setCompressSettings}
              onCategoryChange={setCategory}
              onFormatChange={setFormat}
              detectedTypes={detectedTypes}
              outputMode={outputMode}
              onOutputModeChange={setOutputMode}
              backgroundEnabled={backgroundEnabled}
              onBackgroundEnabledChange={setBackgroundEnabled}
              autoDownloadEnabled={autoDownloadEnabled}
              onAutoDownloadEnabledChange={setAutoDownloadEnabled}
              exportMode={exportMode}
              onExportModeChange={setExportMode}
              onApplySuggestedConvert={applySuggestedConvert}
              onApplySuggestedCompress={applySuggestedCompress}
              canStart={canStart}
              isProcessing={isProcessing}
              onStart={startProcessing}
            />
          </div>

          <div className="order-1 lg:order-2 lg:sticky lg:top-[76px] lg:h-[calc(100vh-6rem)] flex flex-col gap-4 min-h-0 animate-in fade-in slide-in-from-right-6 duration-500 delay-100 ease-out fill-mode-both">
            {showVideoColorSampler && (
              <VideoColorSampler
                file={colorPickerVideoFile}
                color={convertSettings.colorRemoveColor}
                onColorPicked={(pickedColor) =>
                  setConvertSettings({ ...convertSettings, colorRemoveColor: pickedColor })
                }
                className="bg-card p-4 shadow-sm"
              />
            )}
            <FileQueue
              queue={queue}
              currentAction={currentAction}
              outputMode={outputMode}
              defaultFormat={convertSettings.format}
              onFilesAdded={addFiles}
              onRemove={removeFile}
              onClearAll={clearAll}
              onSetItemTargetFormat={setItemTargetFormat}
              onSetItemCustomAction={setItemCustomAction}
              onSetItemCustomCompressSettings={setItemCustomCompressSettings}
              onSetItemOutputMode={setItemOutputMode}
              onApplyGlobalOutput={applyGlobalFormatToAll}
              onRequeue={requeueItem}
              hasCompletedFiles={hasCompletedFiles}
              exportMode={exportMode}
              onExportCompleted={exportCompletedFiles}
            />
          </div>
        </div>
      </div>
      )}

      {backgroundEnabled && (
        <div className={`fixed right-4 z-[60] flex items-center gap-1.5 rounded-full border border-border bg-card/95 px-3 py-1.5 text-xs text-muted-foreground shadow-lg backdrop-blur ${showProgress ? 'bottom-24' : 'bottom-4'}`}>
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
          Arrière-plan actif
        </div>
      )}
    </div>
  )
}

export default App
