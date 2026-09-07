import { getSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { LandingPage } from "./LandingPage";

export default async function MarketingPage() {
  if (await getSession()) redirect("/studio");
  return <LandingPage />;
}
