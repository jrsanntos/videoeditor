import { redirect } from "next/navigation";
import { googleEnabled } from "@/server/google";
import { currentUser } from "@/server/users";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export const metadata = { title: "Entrar — videoeditor" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ senha?: string; confirmacao?: string; modo?: string; google?: string }> }) {
  if (await currentUser()) redirect("/app");
  const { senha, confirmacao, modo, google } = await searchParams;
  const googleWarning =
    google === "suspensa" ? "Esta conta foi suspensa. Fale com o suporte." : google === "indisponivel" ? "O login com Google não está disponível no momento. Use e-mail e senha." : google === "erro" ? "Não foi possível entrar com o Google. Tente de novo." : undefined;
  return (
    <LoginForm
      initialMode={modo === "cadastro" ? "signup" : "login"}
      notice={senha === "redefinida" ? "Senha alterada. Entre com a nova senha." : undefined}
      warning={confirmacao === "expirada" ? "Este link de confirmação expirou ou já foi usado. Entre com seu e-mail e senha para receber outro." : googleWarning}
      google={await googleEnabled()}
    />
  );
}
