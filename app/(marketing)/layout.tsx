import type { Metadata } from "next";
import styles from "./landing.module.css";

export const metadata: Metadata = {
  title: "CRM Studio — Built around your business",
  description: "Describe the way you work. Build a CRM around it with AI. Custom pipelines, connected data, and a workspace that evolves with your business.",
};

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return <div data-density="site" data-theme="dark" className={styles.site}>{children}</div>;
}
