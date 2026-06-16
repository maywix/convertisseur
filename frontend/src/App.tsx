import { useEffect, useState } from 'react'
import { ConfigPanel, VideoColorSampler } from '@/components/ConfigPanel'
import { FileQueue } from '@/components/FileQueue'
import { SimpleConverter } from '@/components/SimpleConverter'
import { TotalProgress } from '@/components/TotalProgress'
import { IconMoon, IconSun } from '@/components/icons'
import { useConverter } from '@/hooks/useConverter'
import { getFileType } from '@/types'

const LS_THEME = 'converter_theme'

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
        <div className="mx-auto max-w-[1500px] px-4 lg:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-foreground flex items-center justify-center text-background font-bold text-sm shadow-sm">C</div>
            <div>
              <h1 className="text-[15px] font-semibold tracking-tight leading-none">Convertisseur Studio</h1>
              <p className="text-xs text-muted-foreground leading-none mt-1">Vidéo · Audio · Image · Document · 3D</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <div className="inline-flex items-center rounded-lg border border-border bg-card p-0.5 shadow-sm">
              <button
                type="button"
                onClick={() => setUiMode('simple')}
                className={`inline-flex h-8 items-center rounded-md px-3 text-xs font-semibold transition-colors ${uiMode === 'simple' ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'}`}
              >
                Simple
              </button>
              <button
                type="button"
                onClick={() => setUiMode('pro')}
                className={`inline-flex h-8 items-center rounded-md px-3 text-xs font-semibold transition-colors ${uiMode === 'pro' ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'}`}
              >
                Pro
              </button>
            </div>
            <button
              type="button"
              onClick={() => setTheme((value) => value === 'dark' ? 'light' : 'dark')}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-muted"
              aria-label={theme === 'dark' ? 'Passer au thème clair' : 'Passer au thème sombre'}
            >
              {theme === 'dark' ? <IconSun size={15} /> : <IconMoon size={15} />}
              <span className="hidden sm:inline">{theme === 'dark' ? 'Clair' : 'Sombre'}</span>
            </button>
          </div>
        </div>
      </header>

      {uiMode === 'simple' ? (
        <div key="simple" className={`animate-in fade-in slide-in-from-bottom-3 duration-300 ease-out fill-mode-both ${showProgress ? 'pt-16' : ''}`}>
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
          />
        </div>
      ) : (
      <div key="pro" className={`max-w-[1500px] mx-auto px-4 lg:px-6 py-5 ${showProgress ? 'pt-16' : ''}`}>
        <div className="grid lg:grid-cols-[390px_minmax(0,1fr)] gap-5 items-start">
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

          <div className="order-1 lg:order-2 lg:sticky lg:top-[76px] lg:max-h-[calc(100vh-6rem)] flex flex-col gap-4 animate-in fade-in slide-in-from-right-6 duration-500 delay-100 ease-out fill-mode-both">
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
        <div className="fixed bottom-4 right-4 z-50 flex items-center gap-1.5 rounded-full border border-border bg-card/95 px-3 py-1.5 text-xs text-muted-foreground shadow-lg backdrop-blur">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
          Arrière-plan actif
        </div>
      )}
    </div>
  )
}

export default App
