import { useEffect, useState } from "react";

export function useDocumentVisibility(): boolean {
  const [visible, setVisible] = useState(() => document.visibilityState === "visible");

  useEffect(() => {
    const handleVisibility = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  return visible;
}
