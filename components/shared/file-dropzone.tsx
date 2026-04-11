"use client"

import * as React from "react"
import { X, UploadCloud } from "lucide-react"
import { toast } from "sonner"

import { Progress } from "@/components/ui/progress"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

// ── Types ──────────────────────────────────────────────────────────────────────

export interface FilePreview {
  id: string
  file: File
  previewUrl: string
  filename: string
  size: number
}

interface FileDropzoneProps {
  files: FilePreview[]
  onFilesChange: (files: FilePreview[]) => void
  maxFiles?: number
  accept?: string
  maxSizeMB?: number
  className?: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateId(): string {
  return Math.random().toString(36).slice(2, 10)
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ── Component ─────────────────────────────────────────────────────────────────

export function FileDropzone({
  files,
  onFilesChange,
  maxFiles = 10,
  accept = "image/*",
  maxSizeMB = 2,
  className,
}: FileDropzoneProps) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [isDragOver, setIsDragOver] = React.useState(false)
  const [progress, setProgress] = React.useState<number | null>(null)

  // Cleanup blob URLs on unmount
  React.useEffect(() => {
    return () => {
      files.forEach((f) => URL.revokeObjectURL(f.previewUrl))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const processFiles = React.useCallback(
    (incoming: File[]) => {
      const maxBytes = maxSizeMB * 1024 * 1024
      const remaining = maxFiles - files.length

      if (incoming.length === 0) return

      // Size validation
      const oversized = incoming.filter((f) => f.size > maxBytes)
      if (oversized.length > 0) {
        toast.error(
          `${oversized.length} file(s) exceed the ${maxSizeMB} MB limit and were not added.`,
        )
      }
      const valid = incoming.filter((f) => f.size <= maxBytes)

      // Count validation
      if (valid.length > remaining) {
        toast.error(`You can only add ${remaining} more file(s) (max ${maxFiles}).`)
      }
      const toAdd = valid.slice(0, remaining)
      if (toAdd.length === 0) return

      // Simulate progress (0 → 100 over 500 ms)
      setProgress(0)
      const startTime = Date.now()
      const duration = 500
      const tick = () => {
        const elapsed = Date.now() - startTime
        const pct = Math.min(100, Math.round((elapsed / duration) * 100))
        setProgress(pct)
        if (pct < 100) {
          requestAnimationFrame(tick)
        } else {
          setTimeout(() => setProgress(null), 200)
        }
      }
      requestAnimationFrame(tick)

      const newPreviews: FilePreview[] = toAdd.map((file) => ({
        id: generateId(),
        file,
        previewUrl: URL.createObjectURL(file),
        filename: file.name,
        size: file.size,
      }))

      onFilesChange([...files, ...newPreviews])
    },
    [files, maxFiles, maxSizeMB, onFilesChange],
  )

  const removeFile = React.useCallback(
    (id: string) => {
      const target = files.find((f) => f.id === id)
      if (target) URL.revokeObjectURL(target.previewUrl)
      onFilesChange(files.filter((f) => f.id !== id))
    },
    [files, onFilesChange],
  )

  // ── Drag-and-drop handlers ────────────────────────────────────────────────

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragOver(true)
  }

  const handleDragLeave = () => setIsDragOver(false)

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragOver(false)
    const dropped = Array.from(e.dataTransfer.files)
    processFiles(dropped)
  }

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files ?? [])
    processFiles(selected)
    // Reset input so the same file can be re-selected
    e.target.value = ""
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {/* Drop zone */}
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload files"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click()
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed px-6 py-10 transition-colors",
          isDragOver
            ? "border-primary bg-primary/5"
            : "border-border hover:border-primary/50 hover:bg-accent/50",
        )}
      >
        <UploadCloud className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Click to upload</span> or drag and drop
        </p>
        <p className="text-xs text-muted-foreground">
          {accept.replace("/*", " files")} &mdash; max {maxSizeMB} MB each
        </p>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple
          className="hidden"
          onChange={handleFileInput}
        />
      </div>

      {/* Upload progress */}
      {progress !== null && (
        <Progress value={progress} className="h-1.5" aria-label="Upload progress" />
      )}

      {/* File preview grid */}
      {files.length > 0 && (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
          {files.map((fp) => (
            <div key={fp.id} className="group relative">
              {/* Thumbnail */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={fp.previewUrl}
                alt={fp.filename}
                className="aspect-square w-full rounded-md border object-cover"
              />
              {/* Remove button */}
              <Button
                type="button"
                variant="destructive"
                size="icon"
                className="absolute right-1 top-1 h-5 w-5 opacity-0 transition-opacity group-hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation()
                  removeFile(fp.id)
                }}
                aria-label={`Remove ${fp.filename}`}
              >
                <X className="h-3 w-3" />
              </Button>
              {/* Filename + size */}
              <p
                className="mt-1 truncate text-xs text-muted-foreground"
                title={fp.filename}
              >
                {fp.filename}
              </p>
              <p className="text-xs text-muted-foreground">{formatBytes(fp.size)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
