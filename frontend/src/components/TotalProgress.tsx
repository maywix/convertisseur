import { Progress } from '@/components/ui/progress'

interface TotalProgressProps {
    completed: number
    total: number
    isProcessing: boolean
}

export function TotalProgress({ completed, total, isProcessing }: TotalProgressProps) {
    if (total === 0) return null

    const percentage = Math.round((completed / total) * 100)
    const isComplete = completed === total && !isProcessing

    return (
        <div className="fixed top-0 left-0 right-0 z-50 backdrop-blur-md bg-background/80 border-b border-border">
            <div className="max-w-6xl mx-auto px-4 py-3">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium">
                        {isComplete ? (
                            <span className="text-emerald-500">✓ Traitement terminé</span>
                        ) : isProcessing ? (
                            <span className="text-primary">⏳ Traitement en cours...</span>
                        ) : (
                            <span className="text-muted-foreground">⏸ En pause</span>
                        )}
                    </span>
                    <span className="text-sm font-semibold text-primary">
                        {completed}/{total} fichiers traités
                    </span>
                </div>
                <Progress
                    value={percentage}
                    className={`h-2 ${isComplete ? '[&>div]:bg-emerald-500' : ''}`}
                />
            </div>
        </div>
    )
}
