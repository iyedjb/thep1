import { useEffect, useState } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { customFetch } from "@workspace/api-client-react";

interface StatusResponse {
  configured: boolean;
  status: "not_configured" | "connected" | "error";
  customerId: string | null;
  error: string | null;
}

export function GoogleAdsStatusBanner() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [checking, setChecking] = useState(false);

  const checkStatus = async () => {
    setChecking(true);
    try {
      const res = await customFetch<StatusResponse>("/api/status/google-ads");
      setStatus(res);
    } catch (err) {
      setStatus({
        configured: true,
        status: "error",
        customerId: "156-990-3086",
        error: "Falha ao se comunicar com o servidor da API."
      });
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    checkStatus();
  }, []);

  if (!status) return null;

  if (status.status === "connected") {
    return null; // Don't show anything if connection is successful
  }

  return (
    <div className="mx-8 mt-4 animate-in fade-in slide-in-from-top-4 duration-300">
      <div className="relative overflow-hidden rounded-2xl border border-amber-500/20 bg-amber-500/10 p-5 backdrop-blur-md shadow-lg flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        {/* Decorative background glow */}
        <div className="absolute -left-10 -top-10 h-32 w-32 rounded-full bg-amber-500/10 blur-2xl pointer-events-none" />
        
        <div className="flex gap-4 items-start relative z-10">
          <div className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/20 text-amber-600 dark:text-amber-400">
            <AlertCircle className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-semibold text-amber-800 dark:text-amber-300">
              Modo de Demonstração Ativo (Dados de SQLite Local)
            </h3>
            <p className="text-sm text-amber-700/90 dark:text-amber-400/90 mt-1">
              {status.status === "not_configured" ? (
                "As credenciais do Google Ads não estão configuradas no seu arquivo .env. O aplicativo está exibindo dados mockados/locais."
              ) : (
                <>
                  A conta do Google Ads <strong>{status.customerId}</strong> não pôde ser acessada e retornou:{" "}
                  <code className="px-1.5 py-0.5 rounded bg-amber-500/20 font-mono text-xs text-amber-950 dark:text-amber-200">
                    {status.error}
                  </code>
                  .
                </>
              )}
            </p>
            {status.status === "error" && status.error?.includes("can't be accessed") && (
              <div className="text-xs text-amber-800/80 dark:text-amber-400/80 mt-2 pl-4 border-l-2 border-amber-500/30 space-y-1">
                <p>💡 <strong>Como resolver no Google Ads:</strong></p>
                <ol className="list-decimal pl-4 space-y-0.5">
                  <li>Faça login no console do <strong>Google Ads</strong> com o e-mail associado.</li>
                  <li>Verifique se a conta <strong>{status.customerId}</strong> está ativa e possui o faturamento configurado.</li>
                  <li>Reative a conta caso ela tenha sido desativada ou cancelada por inatividade.</li>
                </ol>
              </div>
            )}
          </div>
        </div>

        <div className="shrink-0 flex items-center gap-2 relative z-10">
          <Button
            size="sm"
            variant="outline"
            className="border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/20 text-amber-800 dark:text-amber-300 rounded-xl"
            onClick={checkStatus}
            disabled={checking}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${checking ? "animate-spin" : ""}`} />
            {checking ? "Verificando..." : "Verificar Conexão"}
          </Button>
        </div>
      </div>
    </div>
  );
}
