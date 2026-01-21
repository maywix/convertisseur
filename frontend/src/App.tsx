import { useConverter } from '@/hooks/useConverter'
import { TotalProgress } from '@/components/TotalProgress'
import { ConfigPanel } from '@/components/ConfigPanel'
import { FileQueue } from '@/components/FileQueue'

function App() {
  const {
    queue,
    currentAction,
    convertSettings,
    compressSettings,
    isProcessing,
    completedCount,
    totalCount,
    hasCompletedFiles,
    canStart,
    addFiles,
    removeFile,
    clearAll,
    startProcessing,
    setCurrentAction,
    setCategory,
    setFormat,
    setConvertSettings,
    setCompressSettings,
  } = useConverter()

  return (
    <div className="dark min-h-screen bg-background text-foreground">
      {/* Total Progress Bar */}
      <TotalProgress
        completed={completedCount}
        total={totalCount}
        isProcessing={isProcessing}
      />

      {/* Main Content */}
      <div className={`max-w-6xl mx-auto px-4 py-6 ${totalCount > 0 ? 'pt-20' : ''}`}>
        {/* Header */}
        <header className="text-center mb-8">
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
            Agentic <span className="text-primary">Converter</span>
          </h1>
          <p className="text-muted-foreground mt-2">
            Traitement par lots • Compression avancée • Multiformat
          </p>
        </header>

        {/* App Container */}
        <div className="grid lg:grid-cols-[300px_1fr] gap-6 items-start">
          {/* Config Panel */}
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
              canStart={canStart}
              isProcessing={isProcessing}
              onStart={startProcessing}
            />
          </div>

          {/* File Queue */}
          <div className="order-1 lg:order-2">
            <FileQueue
              queue={queue}
              onFilesAdded={addFiles}
              onRemove={removeFile}
              onClearAll={clearAll}
              hasCompletedFiles={hasCompletedFiles}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

export default App
