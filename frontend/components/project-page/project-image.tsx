import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Download, Trash, Video, Play, Film } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import VideoConvertTool from "../toolbar/video-convert-tool";
import { ExportVideoDialog } from "./export-video-dialog";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import Image from "next/image";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useDeleteProjectImages,
  useDownloadProjectImage,
} from "@/lib/mutations/projects";
import { useProjectInfo } from "@/providers/project-provider";
import { useSession } from "@/providers/session-provider";
import { useToast } from "@/hooks/use-toast";
import type { ProjectImage } from "@/lib/projects";
import { useSearchParams } from "next/navigation";
import { getErrorMessage } from "@/lib/error-messages";

interface ImageItemProps {
  image: ProjectImage;
  animation?: boolean;
}

export function ProjectImage({ image, animation = true }: ImageItemProps) {
  const searchParams = useSearchParams();
  const mode = searchParams.get("mode") ?? "edit";

  const [loaded, setLoaded] = useState<boolean>(false);
  const [open, setOpen] = useState<boolean>(false);
  const [convertDialogOpen, setConvertDialogOpen] = useState<boolean>(false);
  const [exportDialogOpen, setExportDialogOpen] = useState<boolean>(false);

  const { _id: pid, version } = useProjectInfo();
  const session = useSession();
  const ownerId = searchParams.get("owner") ?? session.user._id;
  const shareId = searchParams.get("share") ?? undefined;

  const projectInfo = useProjectInfo(); // para ter version também
  const deleteImage = useDeleteProjectImages(
    session.user._id,
    pid as string,
    session.token,
    ownerId,
    shareId,
  );
  const downloadImage = useDownloadProjectImage(mode === "results");
  const { toast } = useToast();

  const isVideo =
    image.mediaType === "video" ||
    !!image.name?.match(/\.(mp4|webm|mkv|mov)$/i);

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
      <ContextMenu>
        <ContextMenuTrigger>
          <Card className="group relative overflow-hidden size-full">
            {isVideo ? (
              <div className="size-full relative flex items-center justify-center bg-zinc-950">
                {!animation ? (
                  <div className="size-full flex flex-col items-center justify-center relative">
                    <video
                      src={image.url}
                      controls
                      className="size-full object-contain z-30"
                      preload="metadata"
                    />
                    {mode !== "results" && (
                      <div className="absolute top-4 right-4 z-40 flex items-center gap-2">
                        <VideoConvertTool targetVideoId={image._id} />
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    <video
                      src={image.url}
                      className="size-full object-cover pointer-events-none opacity-80"
                      preload="metadata"
                      muted
                    />
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center transition-all group-hover:bg-black/20">
                      <div className="p-3 rounded-full bg-primary/90 text-primary-foreground shadow-lg group-hover:scale-110 transition-transform">
                        <Play className="size-6 fill-current ml-0.5" />
                      </div>
                    </div>
                    <div className="absolute top-2 left-2 px-2 py-0.5 rounded bg-black/70 text-white text-xs flex items-center gap-1 font-medium z-20">
                      <Video className="size-3" /> Video
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="size-full relative grid z-0 grid-cols-1 grid-rows-1">
                <Image
                  src={image.url}
                  unoptimized
                  height={500}
                  width={500}
                  alt={image.name}
                  className={cn(
                    "size-full object-contain row-start-1 col-start-1 z-30",
                    animation && "transition-all group-hover:scale-105",
                  )}
                  priority
                  onLoad={() => setLoaded(true)}
                />
                <Image
                  src={image.url}
                  unoptimized
                  width={500}
                  height={500}
                  className="object-cover row-start-1 col-start-1 size-full z-10"
                  alt={image.name + " blurred"}
                />
                <div className="row-start-1 col-start-1 backdrop-blur-sm size-full bg-black/30 z-20" />
                {!loaded && (
                  <>
                    <div className="row-start-1 col-start-1 z-40 bg-background size-full" />
                    <Skeleton className="size-full row-start-1 col-start-1 z-50" />
                  </>
                )}
              </div>
            )}
          </Card>
        </ContextMenuTrigger>
        <ContextMenuContent>
          {isVideo && mode !== "results" && (
            <ContextMenuItem
              className="flex justify-between cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                setConvertDialogOpen(true);
              }}
            >
              <span>Converter Vídeo</span>
              <Film className="size-4 text-indigo-500" />
            </ContextMenuItem>
          )}
          <DialogTrigger asChild onClick={(e) => e.stopPropagation()}>
            {mode !== "results" && (
              <ContextMenuItem
                className="flex justify-between"
                onClick={(e) => e.stopPropagation()}
              >
                <span>Delete</span>
                <Trash className="size-4" />
              </ContextMenuItem>
            )}
          </DialogTrigger>
          {isVideo ? (
            <ContextMenuItem
              className="flex justify-between cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                setExportDialogOpen(true);
              }}
            >
              <span>Exportar Vídeo</span>
              <Download className="size-4 text-emerald-500" />
            </ContextMenuItem>
          ) : (
            <ContextMenuItem
              className="flex justify-between"
              onClick={(e) => {
                e.stopPropagation();
                downloadImage.mutate(
                  {
                    imageUrl: image.url,
                    imageName: image.name,
                  },
                  {
                    onSuccess: () => {
                      toast({
                        title: `Image ${image.name} downloaded.`,
                      });
                    },
                    onError: (error) => {
                      const { title, description } = getErrorMessage("project-download", error);
                      toast({
                        title,
                        description,
                        variant: "destructive",
                      });
                    },
                  },
                );
              }}
            >
              <span>Download</span>
              <Download className="size-4" />
            </ContextMenuItem>
          )}
        </ContextMenuContent>
      </ContextMenu>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Are you sure?</DialogTitle>
          <DialogDescription>This action cannot be undone.</DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={(e) => {
              setOpen(false);
              e.stopPropagation();
            }}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={(e) => {
              deleteImage.mutate(
                {
                  imageIds: [image._id],
                  projectVersion: projectInfo.version,
                },
                {
                  onSuccess: () => {
                    toast({
                      title: `Image ${image.name} deleted successfully.`,
                    });
                  },
                  onError: (error) => {
                    const { title, description } = getErrorMessage("project-delete", error);
                    toast({
                      title,
                      description,
                      variant: "destructive",
                    });
                  },
                },
              );
              setOpen(false);
              e.stopPropagation();
            }}
          >
            Permanently Delete
          </Button>
        </div>
      </DialogContent>
    </Dialog>

    {isVideo && (
      <>
        <VideoConvertTool
          targetVideoId={image._id}
          open={convertDialogOpen}
          onOpenChange={setConvertDialogOpen}
          trigger={null}
        />
        <ExportVideoDialog
          video={image}
          open={exportDialogOpen}
          onOpenChange={setExportDialogOpen}
        />
      </>
    )}
    </>
  );
}
