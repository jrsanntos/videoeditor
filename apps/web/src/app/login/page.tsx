import { redirect } from "next/navigation";
import { currentUser } from "@/server/users";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export const metadata = { title: "Entrar — videoeditor" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ senha?: string; confirmacao?: string; modo?: string }> }) {
  if (await currentUser()) redirect("/app");
  const { senha, confirmacao, modo } = await searchParams;
  return (
    <LoginForm
      initialMode={modo === "cadastro" ? "signup" : "login"}
      notice={senha === "redefinida" ? "Senha alterada. Entre com a nova senha." : undefined}
      warning={confirmacao === "expirada" ? "Este link de confirmação expirou ou já foi usado. Entre com seu e-mail e senha para receber outro." : undefined}
    />
  );
}
