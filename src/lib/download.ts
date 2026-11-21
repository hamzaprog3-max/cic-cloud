/**
 * Direct file download utility.
 * Guarantees direct download to the user's device disk without
 * opening a PDF preview tab in the browser.
 */
import { toast } from "sonner";

export async function downloadFileDirectly(url: string, filename: string): Promise<boolean> {
  const toastId = "direct-download";
  try {
    toast.loading("جاري بدء التحميل المباشر...", { id: toastId });

    // Fetch the file content
    const response = await fetch(url, { mode: "cors" });
    if (!response.ok) {
      throw new Error(`HTTP error ${response.status}`);
    }

    const blob = await response.blob();
    // Enforce octet-stream so the browser never opens an in-browser PDF preview
    const forcedDownloadBlob = new Blob([blob], {
      type: "application/octet-stream",
    });

    const blobUrl = URL.createObjectURL(forcedDownloadBlob);
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = filename || "download.pdf";
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(() => {
      URL.revokeObjectURL(blobUrl);
    }, 30_000);

    toast.success("تم بدء التحميل بنجاح 📥", { id: toastId });
    return true;
  } catch (err) {
    // Fallback: If CORS blocks direct fetch, use hidden anchor with download attribute
    try {
      const link = document.createElement("a");
      link.href = url;
      link.download = filename || "download.pdf";
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast.success("تم بدء التحميل 📥", { id: toastId });
      return true;
    } catch {
      toast.error("تعذر بدء التحميل المباشر", { id: toastId });
      return false;
    }
  }
}
