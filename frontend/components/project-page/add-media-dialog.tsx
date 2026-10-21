"use client";

import { useState } from "react";
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
import ImageSubmissionArea from "../image-submission-area";
import { LoaderCircle, Plus, UploadCloud } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { useAddProjectImages, useImportProjectVideo } from "@/lib/mutations/projects";
import { useProjectInfo } from "@/providers/project-provider";
import { useSession } from "@/providers/session-provider";
import { useToast } from "@/hooks/use-toast";
import { useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";

export function AddMediaDialog() {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progressMsg, setProgressMsg] = useState<string>("");
  const [progressVal, setProgressVal] = useState<number>(0);

  const { toast } = useToast();
  const searchParams = useSearchParams();
  const { _id: pid, version } = useProjectInfo();
  const session = useSession();
  const qc = useQueryClient();

  const ownerId = searchParams.get("owner") ?? undefined;
  const shareId = searchParams.get("share") ?? undefined;

  const addImages = useAddProjectImages(
    session.user._id,
    pid as string,
    session.token,
    ownerId,
    shareId
  );

  const importVideo = useImportProjectVideo(
    session.user._id,
    pid as string,
    session.token,
    ownerId,
    shareId
  );

  const isVideo = (f: File) => {
    const ext = "." + f.name.split(".").pop()?.toLowerCase();
    return (
      f.type.startsWith("video/") ||
      [".mp4", ".webm", ".mkv", ".mov"].includes(ext)
    );
  };

  async function handleUpload() {
    if (files.length === 0) return;

    setUploading(true);
    setProgressVal(10);
    setProgressMsg("Starting upload...");

    const imageFiles = files.filter((f) => !isVideo(f));
    const videoFiles = files.filter((f) => isVideo(f));

    let currentVersion = version;

    try {
      // 1. Upload images se houver
      if (imageFiles.length > 0) {
        setProgressMsg(`Uploading ${imageFiles.length} image(s)...`);
        setProgressVal(30);
        const lastVersion = await addImages.mutateAsync({
          images: imageFiles,
          projectVersion: currentVersion,
        });
        if (lastVersion) currentVersion = Number(lastVersion);
      }

      // 2. Upload videos via presigned S3 PUT se houver
      for (let i = 0; i < videoFiles.length; i++) {
        const v = videoFiles[i];
        setProgressMsg(`Uploading video ${i + 1}/${videoFiles.length}: ${v.name}...`);
        const res = await importVideo.mutateAsync({
          file: v,
          projectVersion: currentVersion,
          onProgress: (percent) => {
            setProgressVal(Math.min(95, 30 + Math.round((percent * 65) / 100)));
          },
        });
        if (res?.version) currentVersion = Number(res.version);
      }

      setProgressVal(100);
      setProgressMsg("Complete!");

      toast({
        title: "Media uploaded successfully",
        description: `Added ${files.length} item(s) to your project.`,
      });

      setFiles([]);
      setOpen(false);

      const projectKey = ["project", session.user._id, pid, session.token, ownerId, shareId];
      qc.invalidateQueries({ queryKey: projectKey, refetchType: "all" });
      qc.invalidateQueries({
        queryKey: ["projectImages", session.user._id, pid, session.token, ownerId, shareId],
        refetchType: "all",
      });
    } catch (err: any) {
      console.error("Upload media error:", err);
      toast({
        title: "Error uploading media",
        description: err.message || "Failed to upload one or more files.",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
      setProgressVal(0);
      setProgressMsg("");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !uploading && setOpen(v)}>
      <DialogTrigger asChild>
        <Button className="inline-flex items-center gap-1.5" variant="outline">
          <UploadCloud className="size-4" /> Upload Media
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Upload Media</DialogTitle>
          <DialogDescription>
            Add images (PNG, JPEG) or videos (MP4, WebM, MKV, MOV) to your project.
          </DialogDescription>
        </DialogHeader>

        <ImageSubmissionArea onDrop={(newFiles) => setFiles(newFiles)} />

        {uploading && (
          <div className="flex flex-col gap-1.5 py-2">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{progressMsg}</span>
              <span>{progressVal}%</span>
            </div>
            <Progress value={progressVal} className="h-2" />
          </div>
        )}

        <DialogFooter className="flex gap-2 justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={uploading}
          >
            Cancel
          </Button>
          <Button
            onClick={handleUpload}
            disabled={files.length === 0 || uploading}
            className="inline-flex items-center gap-1.5"
          >
            {uploading ? (
              <>
                <LoaderCircle className="size-4 animate-spin" />
                <span>Uploading...</span>
              </>
            ) : (
              <>
                <Plus className="size-4" />
                <span>Upload</span>
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
