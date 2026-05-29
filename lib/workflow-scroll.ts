/** Scroll the advisor workflow main column to top (CRM embed pane or window). */
export function scrollWorkflowMainToTop(behavior: ScrollBehavior = "auto"): void {
  const main =
    document.getElementById("workflow-main") ??
    document.querySelector<HTMLElement>(".ap-legacy-embed .ap-app-bg > div.mx-auto");
  if (main) {
    main.scrollTo({ top: 0, behavior });
    return;
  }
  window.scrollTo({ top: 0, behavior });
}
