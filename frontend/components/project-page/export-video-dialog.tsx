"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Download, Film, Sparkles, AlertCircle, LoaderCircle, CheckCircle2, ShieldAlert } from "lucide-react";
import { useProjectInfo } from "@/providers/project-provider";
import { useSession } from "@/providers/session-provider";
import { useExportProjectVideo, useCompleteProjectVideoExport } from "@/lib/mutations/projects";
import { useToast } from "@/hooks/use-toast";
import { useSearchParams, useRouter } from "next/navigation";
import type { ProjectImage } from "@/lib/projects";

interface ExportVideoDialogProps {
  video: ProjectImage;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ExportVideoDialog({ video, open, onOpenChange }: ExportVideoDialogProps) {
  const [loading, setLoading] = useState<boolean>(true);
  const [downloading, setDownloading] = useState<boolean>(false);
  const [videoData, setVideoData] = useState<{
    name: string;
    format: string;
    resolution: string;
    size: number;
    url: string;
    expiresInMinutes: number;
  } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isPremiumExclusive, setIsPremiumExclusive] = useState<boolean>(false);

  const { _id: pid } = useProjectInfo();
  const session = useSession();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { toast } = useToast();

  const ownerId = searchParams.get("owner") ?? session.user._id;
  const shareId = searchParams.get("share") ?? undefined;

  const exportVideo = useExportProjectVideo(
    session.user._id,
    pid as string,
    session.token,
    ownerId,
    shareId
  );

  const completeExport = useCompleteProjectVideoExport(
    session.user._id,
    pid as string,
    session.token,
    ownerId,
    shareId
  );

  useEffect(() => {
    if (!open) {
      setVideoData(null);
      setErrorMsg(null);
      setIsPremiumExclusive(false);
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    setIsPremiumExclusive(false);

    exportVideo.mutate(
      { videoKey: video.name },
      {
        onSuccess: (data) => {
          setLoading(false);
          if (data.videos && data.videos.length > 0) {
            setVideoData(data.videos[0]);
          } else {
            // Fallback para os dados locais do vídeo
            const ext = video.name.split(".").pop()?.toUpperCase() || "MP4";
            const res = video.name.toLowerCase().includes("1080p")
              ? "1080p"
              : video.name.toLowerCase().includes("720p")
              ? "720p"
              : video.name.toLowerCase().includes("480p")
              ? "480p"
              : "720p";
            setVideoData({
              name: video.name,
              format: ext,
              resolution: res,
              size: 0,
              url: video.url,
              expiresInMinutes: 15,
            });
          }
        },
        onError: (err: any) => {
          setLoading(false);
          const errData = err.response?.data;
          const msg =
            (typeof errData === "string" ? errData : errData?.error || errData?.message) ||
            err.message ||
            "Não foi possível obter dados para exportação.";
          
          if (errData?.isPremiumExclusive || msg.includes("Premium") || err.response?.status === 403) {
            setIsPremiumExclusive(true);
          }
          setErrorMsg(msg);
        },
      }
    );
  }, [open, video.name]);

  const handleConfirmDownload = async () => {
    if (!videoData?.url) return;

    try {
      setDownloading(true);

      // 1. Iniciar download e obter dados do ficheiro (REQ-VID-EXP-011, A8)
      const res = await fetch(videoData.url);
      if (!res.ok) throw new Error("Falha ao transferir o ficheiro do servidor.");
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);

      // 2. Disparar o download direto com o nome do ficheiro
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = videoData.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);

      // 3. Registar conclusão e deduzir 1 operação da quota se for utilizador Registado (REQ-VID-EXP-014)
      await completeExport.mutateAsync();

      toast({
        title: "Exportação concluída com sucesso!",
        description: `O ficheiro ${videoData.name} foi descarregado para o seu dispositivo.`,
      });

      setDownloading(false);
      onOpenChange(false);
    } catch (err: any) {
      setDownloading(false);
      toast({
        title: "Erro ao descarregar vídeo",
        description: err.message || "Ocorreu uma falha durante o download.",
        variant: "destructive",
      });
    }
  };

  const isFreeUser = session.user?.type === "free" || !session.user?.type;

  return (
    <Dialog open={open} onOpenChange={(val) => !downloading && onOpenChange(val)}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Film className="size-5 text-emerald-600" /> Exportar Vídeo
          </DialogTitle>
          <DialogDescription>
            Descarregue o vídeo da sua biblioteca no seu formato original sem perda de qualidade (UC-VID-003).
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-10 flex flex-col items-center justify-center gap-3 text-muted-foreground">
            <LoaderCircle className="size-8 animate-spin text-emerald-600" />
            <p className="text-sm">A verificar características do vídeo e limites do plano...</p>
          </div>
        ) : isPremiumExclusive ? (
          <div className="flex flex-col gap-4 py-3">
            <div className="p-4 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 text-amber-900 dark:text-amber-200 flex flex-col gap-2">
              <div className="flex items-center gap-2 font-semibold">
                <ShieldAlert className="size-5 text-amber-600 shrink-0" />
                <span>Exclusivo para Utilizadores Premium</span>
              </div>
              <p className="text-xs leading-relaxed">
                {errorMsg ||
                  "O seu perfil Registado (gratuito) apenas permite exportações até 720p em formatos MP4 ou WebM. Para descarregar em 1080p, MKV ou MOV sem restrições, atualize a sua conta para Premium."}
              </p>
            </div>
          </div>
        ) : errorMsg ? (
          <div className="p-4 rounded-lg border border-destructive/40 bg-destructive/10 text-destructive text-sm flex items-center gap-2">
            <AlertCircle className="size-5 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        ) : videoData ? (
          <div className="flex flex-col gap-4 py-2">
            {/* Metadados do Ficheiro (REQ-VID-EXP-010, REQ-VID-EXP-022) */}
            <div className="grid grid-cols-2 gap-3 p-3 rounded-lg border bg-muted/30 text-xs">
              <div>
                <span className="text-muted-foreground block font-medium">Nome do Ficheiro:</span>
                <span className="font-semibold truncate block mt-0.5">{videoData.name}</span>
              </div>
              <div>
                <span className="text-muted-foreground block font-medium">Formato:</span>
                <Badge variant="outline" className="mt-0.5 font-bold uppercase">
                  {videoData.format}
                </Badge>
              </div>
              <div>
                <span className="text-muted-foreground block font-medium">Resolução:</span>
                <span className="font-semibold block mt-0.5">{videoData.resolution}</span>
              </div>
              <div>
                <span className="text-muted-foreground block font-medium">Validade do Link:</span>
                <span className="font-semibold block mt-0.5">{videoData.expiresInMinutes} minutos</span>
              </div>
            </div>

            {/* Quota Notice (RNG-02, REQ-VID-EXP-014) */}
            {isFreeUser && (
              <div className="p-3 rounded-lg border bg-blue-50/60 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800 text-blue-900 dark:text-blue-300 text-xs flex items-center gap-2">
                <Sparkles className="size-4 shrink-0 text-blue-600" />
                <span>
                  Plano Gratuito: esta exportação consumirá <strong>1 operação</strong> da sua quota diária de 5 operações após a conclusão.
                </span>
              </div>
            )}
          </div>
        ) : null}

        <DialogFooter className="flex gap-2 justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={downloading}
          >
            Cancelar
          </Button>

          {isPremiumExclusive ? (
            <Button
              onClick={() => {
                onOpenChange(false);
                router.push("/dashboard/account/upgrade");
              }}
              className="bg-amber-600 hover:bg-amber-500 text-white"
            >
              Fazer Upgrade para Premium
            </Button>
          ) : videoData && !errorMsg ? (
            <Button
              onClick={handleConfirmDownload}
              disabled={downloading || loading}
              className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white"
            >
              {downloading ? (
                <>
                  <LoaderCircle className="size-4 animate-spin" />
                  <span>A descarregar...</span>
                </>
              ) : (
                <>
                  <Download className="size-4" />
                  <span>Confirmar Download</span>
                </>
              )}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
