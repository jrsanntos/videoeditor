import { redirect } from "next/navigation";
import { currentUser } from "@/server/users";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export const metadata = { title: "Entrar — videoeditor" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ senha?: string }> }) {
  if (await currentUser()) redirect("/");
  const { senha } = await searchParams;
  return <LoginForm notice={senha === "redefinida" ? "Senha alterada. Entre com a nova senha." : undefined} />;
}
