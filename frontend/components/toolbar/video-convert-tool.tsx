"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Progress } from "@/components/ui/progress";
import { Film, LoaderCircle, CheckCircle2, Video, Sparkles } from "lucide-react";
import { useProjectInfo } from "@/providers/project-provider";
import { useSession } from "@/providers/session-provider";
import { useConvertProjectVideo } from "@/lib/mutations/projects";
import { useGetSocket } from "@/lib/queries/projects";
import { useToast } from "@/hooks/use-toast";
import { useRouter, useSearchParams } from "next/navigation";

const FORMAT_OPTIONS = [
  { value: "mp4", label: "MP4 (H.264 / AAC - Universal)" },
  { value: "webm", label: "WebM (VP9 - Web Optimized)" },
  { value: "mkv", label: "MKV (Matroska Container)" },
  { value: "mov", label: "MOV (QuickTime Video)" },
];

const RESOLUTION_OPTIONS = [
  { value: "original", label: "Original (Keep Source Resolution)" },
  { value: "1080p", label: "1080p (Full HD - 1920x1080)" },
  { value: "720p", label: "720p (HD - 1280x720)" },
  { value: "480p", label: "480p (SD - 854x480)" },
  { value: "360p", label: "360p (Low - 640x360)" },
];

export default function VideoConvertTool({
  disabled = false,
  targetVideoId,
}: {
  disabled?: boolean;
  targetVideoId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [selectedVideoKey, setSelectedVideoKey] = useState<string>("");
  const [targetFormat, setTargetFormat] = useState<string>("mp4");
  const [targetResolution, setTargetResolution] = useState<string>("original");
  const [isConverting, setIsConverting] = useState(false);
  const [progress, setProgress] = useState<number>(0);
  const [progressStatus, setProgressStatus] = useState<string>("");

  const project = useProjectInfo();
  const session = useSession();
  const socket = useGetSocket(session.token);
  const { toast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();

  const ownerParam = searchParams.get("owner") ?? session.user._id;
  const shareId = searchParams.get("share") ?? undefined;

  const convertVideo = useConvertProjectVideo(
    session.user._id,
    project._id,
    session.token,
    ownerParam,
    shareId
  );

  const isVideoItem = (img: { name: string; mediaType?: string }) => {
    const ext = "." + img.name.split(".").pop()?.toLowerCase();
    return (
      img.mediaType === "video" ||
      [".mp4", ".webm", ".mkv", ".mov"].includes(ext)
    );
  };

  const projectVideos = project.imgs?.filter(isVideoItem) || [];

  useEffect(() => {
    if (projectVideos.length > 0 && !selectedVideoKey) {
      if (targetVideoId) {
        const found = projectVideos.find((v) => v._id === targetVideoId);
        if (found) {
          setSelectedVideoKey(found.name);
          return;
        }
      }
      setSelectedVideoKey(projectVideos[0].name);
    }
  }, [projectVideos, targetVideoId, selectedVideoKey]);

  useEffect(() => {
    if (!socket.data) return;

    const handleProgress = (data: any) => {
      try {
        const parsed = typeof data === "string" ? JSON.parse(data) : data;
        if (parsed.type === "video-convert-progress" || parsed.progress !== undefined) {
          const p = Math.round(parsed.progress || 0);
          setProgress(p);
          if (parsed.status) {
            setProgressStatus(parsed.status);
          }
        }
      } catch (e) {
        console.error("Error parsing progress:", e);
      }
    };

    socket.data.on("video-convert-progress", handleProgress);

    return () => {
      socket.data?.off("video-convert-progress", handleProgress);
    };
  }, [socket.data]);

  const handleConvert = () => {
    if (!selectedVideoKey) return;

    setIsConverting(true);
    setProgress(5);
    setProgressStatus("Dispatching job to RabbitMQ queue...");

    convertVideo.mutate(
      {
        inputKey: selectedVideoKey,
        targetFormat,
        targetResolution,
        projectVersion: project.version,
      },
      {
        onSuccess: () => {
          setProgress(100);
          setProgressStatus("Conversion finished!");
          toast({
            title: "Conversion started via RabbitMQ",
            description: `Converting ${selectedVideoKey} to ${targetFormat.toUpperCase()} (${targetResolution}).`,
          });

          setTimeout(() => {
            setIsConverting(false);
            setOpen(false);
            const params = new URLSearchParams(searchParams.toString());
            params.set("mode", "results");
            router.push(`?${params.toString()}`);
          }, 1500);
        },
        onError: (err: any) => {
          console.error("Video conversion error:", err);
          setIsConverting(false);
          toast({
            title: "Error starting video conversion",
            description:
              err.response?.data?.message ||
              err.response?.data ||
              err.message ||
              "Could not start conversion.",
            variant: "destructive",
          });
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !isConverting && setOpen(v)}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button
              variant="outline"
              className="size-8 relative bg-indigo-50 hover:bg-indigo-100 border-indigo-200 dark:bg-indigo-950/40 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400"
              disabled={disabled}
            >
              <Film className="size-4" />
              <span className="sr-only">Convert Video</span>
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent className="ml-2 bg-indigo-600 text-white" side="right">
          Convert Video (FFmpeg / RabbitMQ)
        </TooltipContent>
      </Tooltip>

      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Film className="size-5 text-indigo-600" /> Convert Video
          </DialogTitle>
          <DialogDescription>
            Convert video container format and resolution using Docker FFmpeg worker and RabbitMQ.
          </DialogDescription>
        </DialogHeader>

        {projectVideos.length === 0 ? (
          <div className="py-6 flex flex-col items-center justify-center text-center gap-2">
            <Video className="size-10 text-muted-foreground" />
            <p className="text-sm font-medium">No videos found in this project</p>
            <p className="text-xs text-muted-foreground">
              Please upload a video (MP4, WebM, MKV, MOV) using the "Upload Media" button first.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-4 py-2">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Select Video to Convert
              </label>
              <Select
                value={selectedVideoKey}
                onValueChange={setSelectedVideoKey}
                disabled={isConverting}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Choose video" />
                </SelectTrigger>
                <SelectContent>
                  {projectVideos.map((vid) => (
                    <SelectItem key={vid._id} value={vid.name}>
                      {vid.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Target Format
                </label>
                <Select
                  value={targetFormat}
                  onValueChange={setTargetFormat}
                  disabled={isConverting}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Format" />
                  </SelectTrigger>
                  <SelectContent>
                    {FORMAT_OPTIONS.map((f) => (
                      <SelectItem key={f.value} value={f.value}>
                        {f.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Target Resolution
                </label>
                <Select
                  value={targetResolution}
                  onValueChange={setTargetResolution}
                  disabled={isConverting}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Resolution" />
                  </SelectTrigger>
                  <SelectContent>
                    {RESOLUTION_OPTIONS.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="p-3 rounded-lg border bg-muted/40 text-xs text-muted-foreground flex items-center gap-2">
              <Sparkles className="size-4 text-indigo-500 shrink-0" />
              <span>
                Job will be queued in RabbitMQ (`video_convert_queue`) and processed asynchronously by the Docker FFmpeg microservice.
              </span>
            </div>

            {isConverting && (
              <div className="flex flex-col gap-1.5 pt-1">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span className="capitalize">{progressStatus || "Processing..."}</span>
                  <span>{progress}%</span>
                </div>
                <Progress value={progress} className="h-2" />
              </div>
            )}
          </div>
        )}

        <DialogFooter className="flex gap-2 justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={isConverting}
          >
            Cancel
          </Button>
          {projectVideos.length > 0 && (
            <Button
              onClick={handleConvert}
              disabled={isConverting || !selectedVideoKey}
              className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white"
            >
              {isConverting ? (
                <>
                  <LoaderCircle className="size-4 animate-spin" />
                  <span>Converting...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="size-4" />
                  <span>Convert Video</span>
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
