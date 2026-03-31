import { Button } from '@/components/ui/button'
import { ConfigPanel } from '@/components/ConfigPanel'
import { FileQueue } from '@/components/FileQueue'
import { TotalProgress } from '@/components/TotalProgress'
import { useConverter } from '@/hooks/useConverter'
import { useState } from 'react'

function App() {
  const [settingsOpen, setSettingsOpen] = useState(true)
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
    backgroundEnabled,
    autoDownloadEnabled,
    addFiles,
    removeFile,
    clearAll,
    startProcessing,
    setOutputMode,
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
  } = useConverter()

  // Show progress bar only after the user has started at least once
  const showProgress = hasStarted && totalCount > 0

  return (
    <div className="dark min-h-screen bg-[#0b0d12] text-foreground">
      {/* Total Progress Bar */}
      {showProgress && (
        <TotalProgress
          completed={completedCount}
          total={totalCount}
          isProcessing={isProcessing}
        />
      )}

      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#0b0d12]/90 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl md:text-3xl font-black tracking-tight">Convertisseur Studio</h1>
            <p className="text-xs text-muted-foreground">Style pro sombre • lot global ou fichier par fichier</p>
          </div>
          <Button variant="outline" onClick={() => setSettingsOpen((v) => !v)}>
            {settingsOpen ? 'Masquer paramètres' : 'Afficher paramètres'}
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <div className={`max-w-7xl mx-auto px-4 lg:px-8 py-6 ${showProgress ? 'pt-20' : ''}`}>
        <div className="grid lg:grid-cols-[minmax(320px,420px)_1fr] gap-6 items-start">
          <div className={`${settingsOpen ? 'block' : 'hidden'} order-2 lg:order-1`}>
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
              onApplySuggestedConvert={applySuggestedConvert}
              onApplySuggestedCompress={applySuggestedCompress}
              canStart={canStart}
              isProcessing={isProcessing}
              onStart={startProcessing}
            />
          </div>

          <div className="order-1 lg:order-2">
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
            />
          </div>
        </div>
      </div>
    </div>
  )
}

export default App
