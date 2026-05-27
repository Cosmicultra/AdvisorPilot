"use client";

import dynamic from "next/dynamic";
import { WorkflowLoadingShell } from "@/components/workflow-loading-shell";

const LegacyAppShell = dynamic(() => import("./legacy-app-shell"), {
  loading: () => <WorkflowLoadingShell />,
});

export default LegacyAppShell;
