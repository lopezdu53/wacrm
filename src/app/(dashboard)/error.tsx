"use client";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-lg font-semibold text-foreground">
        No se pudo cargar esta página
      </h1>
      <p className="max-w-md text-sm text-muted-foreground">
        {error.message || "Error inesperado"}
      </p>
      <button
        type="button"
        onClick={reset}
        className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
      >
        Reintentar
      </button>
    </div>
  );
}
