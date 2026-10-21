"use client";

import { useState, useRef, ChangeEvent, DragEvent } from "react";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { LoaderCircle, Video, UploadCloud, FileVideo, X, CheckCircle2 } from "lucide-react";
import { useImportProjectVideo } from "@/lib/mutations/projects";
import { useProjectInfo } from "@/providers/project-provider";
import { useSession } from "@/providers/session-provider";
import { useToast } from "@/hooks/use-toast";
import { useSearchParams } from "next/navigation";

const ALLOWED_EXTENSIONS = [".mp4", ".webm", ".mkv", ".mov"];
const ALLOWED_MIME_TYPES = [
  "video/mp4",
  "video/webm",
  "video/x-matroska",
  "video/quicktime",
];

export function ImportVideoDialog() {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number>(0);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { toast } = useToast();
  const searchParams = useSearchParams();
  const { _id: pid, version } = useProjectInfo();
  const session = useSession();

  const ownerId = searchParams.get("owner") ?? undefined;
  const shareId = searchParams.get("share") ?? undefined;

  const importVideo = useImportProjectVideo(
    session.user._id,
    pid as string,
    session.token,
    ownerId,
    shareId
  );

  function validateAndSetFile(selectedFile: File) {
    const ext = "." + selectedFile.name.split(".").pop()?.toLowerCase();
    const isAllowedExt = ALLOWED_EXTENSIONS.includes(ext);
    const isAllowedMime = ALLOWED_MIME_TYPES.includes(selectedFile.type);

    if (!isAllowedExt && !isAllowedMime) {
      toast({
        title: "Unsupported format",
        description: `Please select a valid video (${ALLOWED_EXTENSIONS.join(", ")}).`,
        variant: "destructive",
      });
      return;
    }

    setFile(selectedFile);
    setProgress(0);
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files.length > 0) {
      validateAndSetFile(e.target.files[0]);
    }
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      validateAndSetFile(e.dataTransfer.files[0]);
    }
  }

  function resetState() {
    setFile(null);
    setProgress(0);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function handleImport() {
    if (!file) return;

    importVideo.mutate(
      {
        file,
        projectVersion: version,
        onProgress: (percent) => {
          setProgress(percent);
        },
      },
      {
        onSuccess: () => {
          toast({
            title: "Video imported successfully",
            description: `${file.name} has been added to your project.`,
          });
          resetState();
          setOpen(false);
        },
        onError: (err: any) => {
          console.error("Error importing video:", err);
          const errorMsg =
            err.response?.data?.message ||
            err.response?.data ||
            err.message ||
            "Failed to import video.";
          toast({
            title: "Error importing video",
            description: String(errorMsg),
            variant: "destructive",
          });
        },
      }
    );
  }

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024 * 1024) {
      return (bytes / 1024).toFixed(1) + " KB";
    }
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!importVideo.isPending) {
          setOpen(nextOpen);
          if (!nextOpen) resetState();
        }
      }}
    >
      <DialogTrigger asChild>
        <Button className="inline-flex items-center gap-2" variant="outline">
          <Video className="size-4" /> Import Video
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Video className="size-5 text-primary" /> Import Video
          </DialogTitle>
          <DialogDescription>
            Import a video directly to SeaweedFS (S3) for conversion. Supported formats: MP4, WebM, MKV, MOV.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          {!file ? (
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-lg p-6 flex flex-col items-center justify-center cursor-pointer transition-colors ${
                isDragging
                  ? "border-primary bg-primary/10"
                  : "border-muted-foreground/30 hover:border-primary/60 hover:bg-muted/40"
              }`}
            >
              <UploadCloud className="size-10 text-muted-foreground mb-2" />
              <p className="text-sm font-medium text-center">
                Click or drag & drop video here
              </p>
              <p className="text-xs text-muted-foreground text-center mt-1">
                MP4, WebM, MKV, MOV (up to 1 GB)
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".mp4,.webm,.mkv,.mov,video/mp4,video/webm,video/x-matroska,video/quicktime"
                onChange={handleFileChange}
                className="hidden"
              />
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between p-3 border rounded-lg bg-muted/30">
                <div className="flex items-center gap-3 overflow-hidden">
                  <div className="p-2 rounded-md bg-primary/10 text-primary shrink-0">
                    <FileVideo className="size-6" />
                  </div>
                  <div className="overflow-hidden">
                    <p className="text-sm font-medium truncate" title={file.name}>
                      {file.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatFileSize(file.size)}
                    </p>
                  </div>
                </div>
                {!importVideo.isPending && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={resetState}
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-4" />
                  </Button>
                )}
              </div>

              {importVideo.isPending && (
                <div className="flex flex-col gap-1.5 pt-1">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Uploading to storage...</span>
                    <span>{progress}%</span>
                  </div>
                  <Progress value={progress} className="h-2" />
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="flex gap-2 justify-end">
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={importVideo.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={handleImport}
            disabled={!file || importVideo.isPending}
            className="inline-flex items-center gap-2"
          >
            {importVideo.isPending ? (
              <>
                <LoaderCircle className="size-4 animate-spin" />
                <span>Importing...</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="size-4" />
                <span>Import</span>
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
