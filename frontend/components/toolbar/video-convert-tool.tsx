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
import { Film, LoaderCircle, CheckCircle2, Video, Sparkles, X, AlertCircle } from "lucide-react";
import { useProjectInfo } from "@/providers/project-provider";
import { useSession } from "@/providers/session-provider";
import { useConvertProjectVideo, useCancelProjectVideoConvert } from "@/lib/mutations/projects";
import { useGetSocket } from "@/lib/queries/projects";
import { useToast } from "@/hooks/use-toast";
import { useRouter, useSearchParams } from "next/navigation";

const FORMAT_OPTIONS = [
  { value: "original", label: "Original (Manter formato atual)" },
  { value: "mp4", label: "MP4 (Universal)" },
  { value: "webm", label: "WebM (Otimizado Web)" },
  { value: "mkv", label: "MKV (Matroska)" },
  { value: "mov", label: "MOV (QuickTime)" },
];

const RESOLUTION_OPTIONS = [
  { value: "original", label: "Original (Manter resolução atual)" },
  { value: "144p", label: "144p (Muito Baixa)" },
  { value: "480p", label: "480p (SD)" },
  { value: "720p", label: "720p (HD)" },
  { value: "1080p", label: "1080p (Full HD)" },
];

interface VideoConvertToolProps {
  disabled?: boolean;
  targetVideoId?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: React.ReactNode | null;
}

export default function VideoConvertTool({
  disabled = false,
  targetVideoId,
  open: openProp,
  onOpenChange,
  trigger,
}: VideoConvertToolProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp : internalOpen;
  const setOpen = (val: boolean) => {
    if (onOpenChange) onOpenChange(val);
    if (!isControlled) setInternalOpen(val);
  };

  const [selectedVideoKey, setSelectedVideoKey] = useState<string>("");
  const [targetFormat, setTargetFormat] = useState<string>("original");
  const [targetResolution, setTargetResolution] = useState<string>("original");
  const [isConverting, setIsConverting] = useState(false);
  const [progress, setProgress] = useState<number>(0);
  const [progressStatus, setProgressStatus] = useState<string>("");
  const [currentJobId, setCurrentJobId] = useState<string>("");

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

  const cancelConvert = useCancelProjectVideoConvert(
    session.user._id,
    project._id,
    session.token,
    ownerParam,
    shareId
  );

  const handleCancelConversion = () => {
    if (currentJobId) {
      cancelConvert.mutate({ jobId: currentJobId });
    }
    setIsConverting(false);
    setProgress(0);
    setProgressStatus("");
    toast({
      title: "Conversão cancelada",
      description: "A operação de conversão foi interrompida.",
    });
  };

  const isVideoItem = (img: { name: string; mediaType?: string }) => {
    const ext = "." + img.name.split(".").pop()?.toLowerCase();
    return (
      img.mediaType === "video" ||
      [".mp4", ".webm", ".mkv", ".mov"].includes(ext)
    );
  };

  const projectVideos = project.imgs?.filter(isVideoItem) || [];

  useEffect(() => {
    if (projectVideos.length > 0) {
      if (targetVideoId) {
        const found = projectVideos.find((v) => v._id === targetVideoId);
        if (found) {
          setSelectedVideoKey(found.name);
          return;
        }
      }
      if (!selectedVideoKey) {
        setSelectedVideoKey(projectVideos[0].name);
      }
    }
  }, [projectVideos, targetVideoId, open]);

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
        onSuccess: (data: any) => {
          if (data?.jobId) {
            setCurrentJobId(data.jobId);
          }
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
          const errData = err.response?.data;
          const msg =
            (typeof errData === "string" ? errData : errData?.message || errData?.error) ||
            err.message ||
            "Não foi possível converter vídeo. Tente novamente.";
          
          toast({
            title: "Erro na conversão de vídeo",
            description: msg,
            variant: "destructive",
          });
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !isConverting && setOpen(v)}>
      {trigger === null ? null : trigger !== undefined ? (
        <DialogTrigger asChild>{trigger}</DialogTrigger>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <DialogTrigger asChild>
              <Button
                variant="outline"
                className="size-8 relative bg-indigo-50 hover:bg-indigo-100 border-indigo-200 dark:bg-indigo-950/40 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400"
                disabled={disabled}
              >
                <Film className="size-4" />
                <span className="sr-only">Converter Vídeo</span>
              </Button>
            </DialogTrigger>
          </TooltipTrigger>
          <TooltipContent className="ml-2 bg-indigo-600 text-white" side="right">
            Converter Vídeo (FFmpeg / RabbitMQ)
          </TooltipContent>
        </Tooltip>
      )}

      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Film className="size-5 text-indigo-600" /> Converter Vídeo
          </DialogTitle>
          <DialogDescription>
            Converter formato de contentor de vídeo e resolução através do worker Docker FFmpeg e RabbitMQ.
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

            {/* Apresentação do Formato e Resolução Atual (REQ-VID-FORMAT-001, REQ-VID-RES-001) */}
            {selectedVideoKey && (
              <div className="grid grid-cols-2 gap-2 p-2.5 rounded-md border bg-muted/30 text-xs">
                <div>
                  <span className="text-muted-foreground block text-[11px]">Formato Atual:</span>
                  <span className="font-semibold uppercase">
                    {selectedVideoKey.split(".").pop()?.toUpperCase() || "MP4"}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[11px]">Resolução Atual:</span>
                  <span className="font-semibold">
                    {selectedVideoKey.toLowerCase().includes("1080p")
                      ? "1080p (Full HD)"
                      : selectedVideoKey.toLowerCase().includes("720p")
                      ? "720p (HD)"
                      : selectedVideoKey.toLowerCase().includes("480p")
                      ? "480p (SD)"
                      : "1080p (Original)"}
                  </span>
                </div>
              </div>
            )}

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
          {isConverting ? (
            <Button
              type="button"
              variant="destructive"
              onClick={handleCancelConversion}
              className="inline-flex items-center gap-1.5"
            >
              <X className="size-4" />
              <span>Cancelar Conversão</span>
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
          )}

          {projectVideos.length > 0 && !isConverting && (
            <Button
              onClick={handleConvert}
              disabled={!selectedVideoKey}
              className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white"
            >
              <CheckCircle2 className="size-4" />
              <span>Convert Video</span>
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
