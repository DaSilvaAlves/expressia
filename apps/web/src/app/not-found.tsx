import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8 text-center">
      <h1 className="text-4xl font-bold tracking-tight">404</h1>
      <p className="mt-2 text-lg">Página não encontrada</p>
      <p className="mt-1 max-w-prose text-sm text-muted-foreground">
        O endereço que procuras não existe ou foi removido.
      </p>
      <Link
        href="/"
        className="mt-6 inline-block rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted"
      >
        Voltar à página inicial
      </Link>
    </main>
  );
}
