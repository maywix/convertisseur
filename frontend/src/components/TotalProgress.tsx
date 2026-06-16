import { Progress } from '@/components/ui/progress'

interface TotalProgressProps {
    completed: number
    total: number
    isProcessing: boolean
}

export function TotalProgress({ completed, total, isProcessing }: TotalProgressProps) {
    const percentage = Math.round((completed / total) * 100)
    const isComplete = completed === total && !isProcessing

    return (
        <div className="fixed top-0 left-0 right-0 z-50 backdrop-blur-xl bg-background/90 border-b border-border">
            <div className="max-w-[1500px] mx-auto px-4 lg:px-6 py-3">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold">
                        {isComplete ? (
                            <span className="text-emerald-600 dark:text-emerald-400">Traitement terminé</span>
                        ) : isProcessing ? (
                            <span className="text-primary">Traitement en cours...</span>
                        ) : (
                            <span className="text-muted-foreground">En pause</span>
                        )}
                    </span>
                    <span className="text-sm font-semibold text-foreground">
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
