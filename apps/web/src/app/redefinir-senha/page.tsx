import { ResetForm } from "./ResetForm";

// O token está na URL: o navegador não deve repassá-la a outros sites nem a página ficar em cache.
export const metadata = { title: "Nova senha — videoeditor", referrer: "no-referrer" as const };
export const dynamic = "force-dynamic";

export default async function ResetPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return <ResetForm token={typeof token === "string" ? token : ""} />;
}
