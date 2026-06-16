import { ConfigPanel } from '@/components/ConfigPanel'
import { FileQueue } from '@/components/FileQueue'
import { TotalProgress } from '@/components/TotalProgress'
import { useConverter } from '@/hooks/useConverter'

function App() {
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
    backgroundEnabled,
    autoDownloadEnabled,
    addFiles,
    removeFile,
    clearAll,
    startProcessing,
    setOutputMode,
    setExportMode,
    setBackgroundEnabled,
    setAutoDownloadEnabled,
    setCurrentAction,
    setCategory,
    setFormat,
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

  const showProgress = hasStarted && totalCount > 0

  return (
    <div className="dark min-h-screen bg-[#0b0d12] text-foreground">
      {showProgress && (
        <TotalProgress
          completed={completedCount}
          total={totalCount}
          isProcessing={isProcessing}
        />
      )}

      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-white/8 bg-[#0b0d12]/95 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-primary-foreground font-bold text-sm">C</div>
            <div>
              <h1 className="text-base font-bold tracking-tight leading-none">Convertisseur Studio</h1>
              <p className="text-xs text-muted-foreground leading-none mt-0.5">Vidéo · Audio · Image</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {backgroundEnabled && (
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Arrière-plan actif
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className={`max-w-7xl mx-auto px-4 lg:px-6 py-4 ${showProgress ? 'pt-16' : ''}`}>
        <div className="grid lg:grid-cols-[380px_1fr] gap-4 items-start">
          {/* Settings panel (left / bottom on mobile) */}
          <div className="order-2 lg:order-1">
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

          {/* File queue (right / top on mobile) */}
          <div className="order-1 lg:order-2 lg:sticky lg:top-16 lg:max-h-[calc(100vh-5rem)] flex flex-col">
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
    </div>
  )
}

export default App
