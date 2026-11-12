import { redirect } from "next/navigation";
import { currentUser } from "@/server/users";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export const metadata = { title: "Entrar — videoeditor" };

export default async function LoginPage() {
  if (await currentUser()) redirect("/");
  return <LoginForm />;
}
