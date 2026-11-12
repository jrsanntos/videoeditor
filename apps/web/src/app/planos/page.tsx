import { redirect } from "next/navigation";
import { currentUser } from "@/server/users";
import { Plans } from "./Plans";

export const dynamic = "force-dynamic";
export const metadata = { title: "Planos e créditos — videoeditor" };

export default async function PlansPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  if (!(await currentUser())) redirect("/login");
  const { status } = await searchParams;
  return <Plans status={status === "sucesso" || status === "cancelado" ? status : undefined} />;
}
